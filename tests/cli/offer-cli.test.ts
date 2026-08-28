import { join } from 'node:path';

import { InvalidArgumentError } from 'commander';
import { beforeAll, describe, expect, it } from 'vitest';

import { serializeProfile } from '../../src/artifact';
import {
  EXIT_DATA_ERROR,
  EXIT_FAILURE,
  EXIT_OK,
  describeLimits,
  formatMatchSummary,
  formatTrimReport,
  hasLimits,
  offerName,
  parseLimit,
  readStream,
  resolveLimits,
  runCli,
  type CliContext,
} from '../../src/cli';
import { JobRequirementsSchema } from '../../src/core/keywords';
import type { MatchSummary } from '../../src/core/scoring';
import { NodeFileSystem, defaultSourceParsers, loadDataset } from '../../src/parsers';
import { MemoryFileSystem, type MemoryEntry } from '../helpers/memory-file-system';
import { BACKEND_OFFER } from '../fixtures/offer';
import { selectionProfile } from '../fixtures/selection';

interface Harness {
  readonly context: CliContext;
  readonly fs: MemoryFileSystem;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

let artifact = '';

beforeAll(async () => {
  const dataset = await loadDataset(join(__dirname, '../fixtures/dataset'), { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
  if (!dataset.ok) {
    throw new Error(JSON.stringify(dataset.errors));
  }
  artifact = serializeProfile(dataset.profile);
});

/** Artefacto del dataset de ejemplo ya compilado, fuentes más antiguas y la oferta de docs/scoring.md §6. */
function compiled(extra: Record<string, string | MemoryEntry> = {}, overrides: Partial<CliContext> = {}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const fs = new MemoryFileSystem({
    '/work/data/sources/profile.md': { kind: 'file', content: '---\nfullName: Ada\n---\n', mtimeMs: 100 },
    '/work/data/dist/profile.json': { kind: 'file', content: artifact, mode: 0o600, mtimeMs: 500 },
    '/work/offers/acme-backend.txt': BACKEND_OFFER,
    ...extra,
  });
  const context: CliContext = {
    cwd: '/work',
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
    stdin: () => Promise.resolve(''),
    datasetFileSystem: fs,
    artifactFileSystem: fs,
    parsers: defaultSourceParsers(),
    ...overrides,
  };
  return { context, fs, stdout: () => out.join(''), stderr: () => err.join('') };
}

const OFFER = ['-f', 'offers/acme-backend.txt'];

describe('cv generate-cv --from-job-offer', () => {
  it('afina el CV con la oferta: selección virtual, logros y skills reordenados, nombre con sufijo de oferta', async () => {
    const h = compiled();
    expect(await runCli(['generate-cv', ...OFFER], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe('CV escrito en /work/output/cv-ada-ejemplo-acme-backend.md\n');
    expect(h.stderr()).toBe('');
    const cv = h.fs.file('/work/output/cv-ada-ejemplo-acme-backend.md')?.content ?? '';
    expect(cv).toContain('**Ingeniera de software**');
    expect(cv.indexOf('Reduje la latencia p95')).toBeLessThan(cv.indexOf('Lideré la migración a Kubernetes'));
    expect(cv).not.toContain('contract testing');
    expect(cv).toContain('### Tech Lead · Startup Ejemplo');
    expect(cv).not.toContain('Chameleon CLI');
    expect(cv).toContain('- **Lenguajes:** PHP\n- **Frameworks:** Symfony\n- **Plataformas:** Kubernetes\n- **Competencias:** Liderazgo técnico');
    expect(cv).not.toContain('C++');
  });

  it('con --specialty la especialidad elige la versión y la oferta la afina', async () => {
    const h = compiled();
    expect(await runCli(['generate-cv', ...OFFER, '-s', 'backend'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe('CV escrito en /work/output/cv-ada-ejemplo-backend-acme-backend.md\n');
    expect(h.fs.file('/work/output/cv-ada-ejemplo-backend-acme-backend.md')?.content).toContain('**Senior Backend Engineer**');
  });

  it('recorta con --top-n y --max-skills y lo explica con --explain', async () => {
    const h = compiled();
    expect(await runCli(['generate-cv', ...OFFER, '--top-n', '1', '--max-skills', '2', '--explain', '--stdout'], h.context)).toBe(EXIT_OK);
    const cv = h.stdout();
    expect(cv).toContain('Reduje la latencia p95');
    expect(cv).not.toContain('Lideré la migración a Kubernetes');
    expect(cv).toContain('- **Frameworks:** Symfony\n- **Plataformas:** Kubernetes');
    expect(cv).not.toContain('**Lenguajes:**');
    const explain = h.stderr();
    expect(explain).toContain('Especialidad «offer»');
    expect(explain).toContain('Oferta: 7 requisitos reconocidos, 5 años exigidos · carencias: rendimiento, observabilidad, aws, gcp');
    expect(explain).toContain('Recortes (--top-n 1, --max-skills 2): 3 ítems fuera\n  exp-acme: exp-acme-k8s (2.00)\n  skills: skill-1 PHP (2.50), skill-5 Liderazgo técnico (0.50)\n');
  });

  it('--compact aplica el preset y los límites explícitos prevalecen', async () => {
    const preset = compiled();
    expect(await runCli(['generate-cv', ...OFFER, '--compact', '--explain', '--stdout'], preset.context)).toBe(EXIT_OK);
    expect(preset.stderr()).toContain('Recortes (--top-n 4, --max-skills 12, --max-projects 4, --max-certifications 5): ninguno\n');
    const overridden = compiled();
    expect(await runCli(['generate-cv', ...OFFER, '--compact', '-n', '1', '--explain', '--stdout'], overridden.context)).toBe(EXIT_OK);
    expect(overridden.stderr()).toContain('Recortes (--top-n 1, --max-skills 12, --max-projects 4, --max-certifications 5): 1 ítem fuera\n  exp-acme: exp-acme-k8s (2.00)\n');
  });

  it('sin oferta, --top-n recorta en orden de documento (todos puntúan 0)', async () => {
    const h = compiled();
    expect(await runCli(['generate-cv', '--top-n', '1', '--explain', '--stdout'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain('Sin especialidad: se genera el CV completo, sin selección\n');
    expect(h.stderr()).toContain('Recortes (--top-n 1): 3 ítems fuera\n  exp-acme: exp-acme-k8s (0.00), exp-acme-3 (0.00)\n  achievements: ach-2 Mentora de 5 personas en un programa de ejemplo. (0.00)\n');
    expect(h.stdout()).toContain('Reduje la latencia p95');
    expect(h.stdout()).not.toContain('Lideré la migración');
  });

  it('lee la oferta de la entrada estándar con «-»', async () => {
    const h = compiled({}, { stdin: () => Promise.resolve(BACKEND_OFFER) });
    expect(await runCli(['generate-cv', '-f', '-'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe('CV escrito en /work/output/cv-ada-ejemplo-oferta.md\n');
  });

  it('explica los problemas con la oferta y los límites', async () => {
    const missing = compiled();
    expect(await runCli(['generate-cv', '-f', 'offers/nope.txt'], missing.context)).toBe(EXIT_FAILURE);
    expect(missing.stderr()).toMatch(/^No se pudo leer la oferta «\/work\/offers\/nope\.txt»: ENOENT/);

    const directory = compiled();
    expect(await runCli(['generate-cv', '-f', 'offers'], directory.context)).toBe(EXIT_FAILURE);
    expect(directory.stderr()).toBe('La oferta «/work/offers» no es un fichero\n');

    const empty = compiled({ '/work/offers/vacia.txt': '  \n\n' });
    expect(await runCli(['generate-cv', '-f', 'offers/vacia.txt'], empty.context)).toBe(EXIT_DATA_ERROR);
    expect(empty.stderr()).toBe('La oferta está vacía\n');

    const huge = compiled({ '/work/offers/grande.txt': 'x'.repeat(1024 * 1024 + 1) });
    expect(await runCli(['generate-cv', '-f', 'offers/grande.txt'], huge.context)).toBe(EXIT_FAILURE);
    expect(huge.stderr()).toBe('La oferta «/work/offers/grande.txt» supera el máximo de 1 MiB\n');

    const invalidLimit = compiled();
    expect(await runCli(['generate-cv', '--top-n', 'x'], invalidLimit.context)).toBe(EXIT_FAILURE);
    expect(invalidLimit.stderr()).toContain("error: option '-n, --top-n <n>' argument 'x' is invalid. debe ser un entero mayor o igual que 0");

    const unknown = compiled();
    expect(await runCli(['generate-cv', ...OFFER, '-s', 'devops'], unknown.context)).toBe(EXIT_DATA_ERROR);
    expect(unknown.stderr()).toBe('Especialidad desconocida: «devops» (disponibles: backend, engineering-manager)\n');
  });
});

describe('cv analyze-offer', () => {
  it('imprime el resumen de adecuación sin escribir nada', async () => {
    const h = compiled();
    expect(await runCli(['analyze-offer', 'offers/acme-backend.txt'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toBe('');
    const lines = h.stdout().split('\n');
    expect(lines[0]).toBe('Oferta acme-backend · 7 requisitos reconocidos · 5 años de experiencia exigidos');
    expect(lines[1]).toBe('Adecuación: 6 de 7 requisitos demostrados (86 %) · imprescindibles: 4 de 4');
    expect(lines).toContain('Demostrados');
    expect(lines).toContain('  php            required ×2   1.25  ← exp-acme, exp-acme-1, skill-1, skill-2, cert-2');
    expect(lines).toContain('  tech lead      desirable     0.50  ← exp-startup, skill-5, ach-2');
    expect(lines).toContain('No demostrados');
    expect(lines).toContain('  kafka          desirable     0.50   (si lo tienes, etiquétalo o añade un alias en skills.csv)');
    expect(lines).toContain('Carencias (la oferta lo pide y el perfil no lo tiene etiquetado)');
    expect(lines).toContain('  rendimiento · observabilidad · aws · gcp');
    expect(lines).toContain('Mejores evidencias');
    expect(lines).toContain('  1. exp-acme · ACME Corp — Senior Backend Engineer (7.75)');
    expect(lines).toContain('  2. skill-2 · Symfony (3.75)');
    await expect(h.fs.stat('/work/output')).rejects.toThrow('ENOENT');
  });

  it('--explain añade la auditoría por ítem y --specialty usa la especialidad real', async () => {
    const h = compiled();
    expect(await runCli(['analyze-offer', 'offers/acme-backend.txt', '--explain', '-s', 'engineering-manager'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('Especialidad «engineering-manager»');
    expect(h.stdout()).toContain('Oferta: 7 requisitos reconocidos');
    expect(h.stdout()).toContain('  tech lead      desirable     0.50  ← exp-startup, skill-5, ach-2');
  });

  it('--json produce solo la estructura, con la oferta validable contra el esquema', async () => {
    const h = compiled();
    expect(await runCli(['analyze-offer', 'offers/acme-backend.txt', '--json'], h.context)).toBe(EXIT_OK);
    const parsed = JSON.parse(h.stdout()) as {
      offer: { source: string } & Record<string, unknown>;
      summary: Record<string, number>;
      coverage: Record<string, string[]>;
      decisions: unknown[];
      ranking: Array<{ id: string; score: number }>;
    };
    const { source, ...requirements } = parsed.offer;
    expect(source).toBe('acme-backend');
    expect(JobRequirementsSchema.safeParse(requirements).success).toBe(true);
    expect(parsed.summary).toEqual({ recognized: 7, demonstrated: 6, ratio: 6 / 7, requiredTotal: 4, requiredDemonstrated: 4 });
    expect(parsed.coverage['kafka']).toEqual([]);
    expect(parsed.decisions).toHaveLength(16);
    expect(parsed.ranking[0]).toMatchObject({ id: 'exp-acme', score: 7.75 });
  });

  it('avisa si el artefacto está obsoleto y falla con claridad sin artefacto o con especialidad desconocida', async () => {
    const stale = compiled();
    stale.fs.touch('/work/data/sources/profile.md', 900);
    expect(await runCli(['analyze-offer', 'offers/acme-backend.txt'], stale.context)).toBe(EXIT_OK);
    expect(stale.stderr()).toBe('Aviso: profile.md es más reciente que el artefacto; ejecuta «cv build-profile» para regenerarlo\n');

    const broken = compiled({ '/work/data/sources/notas.md': '' });
    expect(await runCli(['analyze-offer', 'offers/acme-backend.txt'], broken.context)).toBe(EXIT_OK);
    expect(broken.stderr()).toContain('Aviso: no se pudo comprobar si el artefacto está al día');

    const missing = compiled();
    await missing.fs.remove('/work/data/dist/profile.json');
    expect(await runCli(['analyze-offer', 'offers/acme-backend.txt'], missing.context)).toBe(EXIT_DATA_ERROR);
    expect(missing.stderr()).toContain('No existe el artefacto');

    const unknown = compiled();
    expect(await runCli(['analyze-offer', 'offers/acme-backend.txt', '-s', 'devops'], unknown.context)).toBe(EXIT_DATA_ERROR);
    expect(unknown.stderr()).toBe('Especialidad desconocida: «devops» (disponibles: backend, engineering-manager)\n');

    const empty = compiled({ '/work/offers/vacia.txt': '' });
    expect(await runCli(['analyze-offer', 'offers/vacia.txt'], empty.context)).toBe(EXIT_DATA_ERROR);
    expect(empty.stderr()).toBe('La oferta está vacía\n');
  });
});

describe('utilidades de oferta y límites', () => {
  it('parseLimit acepta enteros ≥ 0 y rechaza el resto', () => {
    expect(parseLimit('3')).toBe(3);
    expect(parseLimit(' 0 ')).toBe(0);
    for (const invalid of ['x', '-1', '1.5', '']) {
      expect(() => parseLimit(invalid)).toThrow(InvalidArgumentError);
    }
  });

  it('resolveLimits combina preset y límites explícitos; hasLimits y describeLimits los describen', () => {
    expect(resolveLimits({ compact: false })).toEqual({ achievementsPerContainer: undefined, achievements: undefined, skills: undefined, projects: undefined, certifications: undefined });
    expect(hasLimits(resolveLimits({ compact: false }))).toBe(false);
    expect(resolveLimits({ compact: true, topN: 2 })).toEqual({ achievementsPerContainer: 2, achievements: 2, skills: 12, projects: 4, certifications: 5 });
    expect(resolveLimits({ compact: false, maxProjects: 1, maxCertifications: 0 })).toMatchObject({ projects: 1, certifications: 0 });
    expect(describeLimits({ achievementsPerContainer: 1, certifications: 0 })).toBe('--top-n 1, --max-certifications 0');
  });

  it('offerName y readStream', async () => {
    expect(offerName('ofertas/Acme Backend.TXT')).toBe('acme-backend');
    expect(offerName('-')).toBe('oferta');
    expect(offerName('***.txt')).toBe('oferta');
    async function* chunks(): AsyncGenerator<Buffer | string> {
      yield Buffer.from('ho', 'utf8');
      yield 'la';
    }
    expect(await readStream(chunks())).toBe('hola');
  });

  it('formatTrimReport y formatMatchSummary cubren los casos vacíos', () => {
    const profile = selectionProfile();
    expect(formatTrimReport([], { skills: 3 }, profile)).toBe('Recortes (--max-skills 3): ninguno\n');
    expect(formatTrimReport([{ section: 'skills', id: 'skill-php', score: 1 }], { skills: 0 }, profile)).toBe('Recortes (--max-skills 0): 1 ítem fuera\n  skills: skill-php PHP (1.00)\n');
    const empty: MatchSummary = { recognized: 0, demonstrated: 0, ratio: 0, requiredTotal: 0, requiredDemonstrated: 0, terms: [], gaps: [], experienceYears: undefined, topEvidence: [] };
    expect(formatMatchSummary(empty, 'x')).toBe(
      'Oferta x · 0 requisitos reconocidos\nAdecuación: la oferta no menciona nada del vocabulario del perfil (etiqueta tu contenido o añade alias en skills.csv)\n\nCarencias (la oferta lo pide y el perfil no lo tiene etiquetado)\n  ninguna detectada\n',
    );
  });
});
