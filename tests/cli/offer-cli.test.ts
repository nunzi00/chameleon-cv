import { join } from 'node:path';

import { InvalidArgumentError } from 'commander';
import { beforeAll, describe, expect, it } from 'vitest';

import { defaultAssets } from '../../src/shared/assets';
import { serializeProfile } from '../../src/artifact';
import {
  EXIT_DATA_ERROR,
  EXIT_FAILURE,
  EXIT_OK,
  describeLimits,
  formatMatchSummary,
  formatTrimReport,
  hasLimits,
  isPdfSource,
  offerName,
  parseLimit,
  pdfExitCode,
  readStream,
  resolveLimits,
  runCli,
  type CliContext,
} from '../../src/cli';
import { JobRequirementsSchema } from '../../src/core/keywords';
import type { MatchSummary } from '../../src/core/scoring';
import { NodeFileSystem, defaultSourceParsers, loadDataset } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import { renderTypstCv } from '../../src/renderers/typst';
import { installTypst, typstStatus } from '../../src/typst';
import { MemoryLlmCache, llmStatus } from '../../src/llm';
import { MemoryFileSystem, type MemoryEntry } from '../helpers/memory-file-system';
import { makePdf } from '../helpers/pdf';
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
    pdfExtractor: (bytes) => extractPdfText(bytes),
    typstRenderer: (profile, options) => renderTypstCv(profile, options),
    typstInstall: (options, report) => installTypst(options, report),
    typstStatus: (options) => typstStatus(options),
    llmStatus: (options) => llmStatus(options),
    llmProvider: () => Promise.resolve({ ok: false as const, message: 'sin proveedor en las pruebas' }),
    llmCache: new MemoryLlmCache(),
    assets: defaultAssets(),
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
    expect(await runCli(['generate-cv', ...OFFER, '--top-n', '1', '--max-skills', '2', '--explain', '--no-keep-evidence', '--stdout'], h.context)).toBe(EXIT_OK);
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
    expect(await runCli(['generate-cv', ...OFFER, '--compact', '--explain', '--no-keep-evidence', '--stdout'], preset.context)).toBe(EXIT_OK);
    expect(preset.stderr()).toContain('Recortes (--top-n 4, --max-skills 12, --max-projects 4, --max-certifications 5): ninguno\n');
    const overridden = compiled();
    expect(await runCli(['generate-cv', ...OFFER, '--compact', '-n', '1', '--explain', '--no-keep-evidence', '--stdout'], overridden.context)).toBe(EXIT_OK);
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

describe('cv analyze-offer --copilot (T-9.10)', () => {
  const respuesta = (json: unknown) => ({
    id: 'ollama' as const,
    kind: 'local' as const,
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen3:8b',
    complete: () => Promise.resolve({ ok: true as const, json, raw: JSON.stringify(json), model: 'qwen3:8b', usage: {}, elapsedMs: 4 }),
    health: () => Promise.resolve({ ok: true as const, version: undefined, models: ['qwen3:8b'], modelAvailable: true }),
  });

  it('enseña lo que el modelo añadió CON su evidencia, y cuántas descartó el código', async () => {
    // Enseñar la evidencia no es un adorno: el código puede verificar que la frase está en la oferta, pero no
    // que sostenga la etiqueta. Verla es la única forma de juzgarlo.
    const h = compiled({}, {
      llmProvider: () =>
        Promise.resolve({
          ok: true as const,
          provider: respuesta({
            mappings: [
              // El caso que justifica el motor: la oferta habla de «sistemas de mensajería» y el perfil etiqueta
              // «arquitectura». El emparejado literal no los une; el modelo sí, y el código verifica la frase.
              { tag: 'arquitectura', emphasis: 'desirable', evidence: 'sistemas de mensajería' },
              // Y una etiqueta que el perfil NO tiene: el código la descarta.
              { tag: 'inventada', evidence: 'sistemas de mensajería' },
            ],
          }),
        }),
    });
    expect(await runCli(['analyze-offer', 'offers/acme-backend.txt', '--copilot', '--yes'], h.context)).toBe(EXIT_OK);
    const aviso = h.stderr();
    expect(aviso).toContain('El co-piloto');
    expect(aviso).toContain('arquitectura (desirable) ← «sistemas de mensajería»');
    expect(aviso).toContain('descartó 1');
  });

  it('sin descartes, el aviso es limpio', async () => {
    const h = compiled({}, {
      llmProvider: () => Promise.resolve({ ok: true as const, provider: respuesta({ mappings: [{ tag: 'arquitectura', evidence: 'sistemas de mensajería' }] }) }),
    });
    expect(await runCli(['analyze-offer', 'offers/acme-backend.txt', '--copilot', '--yes'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain('añadió 1 etiqueta(s)');
    expect(h.stderr()).not.toContain('descartó');
  });

  it('cuando el código descarta todo, lo dice: ninguna etiqueta añadida', async () => {
    const h = compiled({}, {
      llmProvider: () => Promise.resolve({ ok: true as const, provider: respuesta({ mappings: [{ tag: 'inventada', evidence: 'sistemas de mensajería' }] }) }),
    });
    expect(await runCli(['analyze-offer', 'offers/acme-backend.txt', '--copilot', '--yes'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain('no añadió ninguna etiqueta');
    expect(h.stderr()).toContain('1 propuesta(s) descartadas');

    // Y cuando el modelo no propone nada, no hay descartes de los que hablar.
    const vacio = compiled({}, { llmProvider: () => Promise.resolve({ ok: true as const, provider: respuesta({ mappings: [] }) }) });
    expect(await runCli(['analyze-offer', 'offers/acme-backend.txt', '--copilot', '--yes'], vacio.context)).toBe(EXIT_OK);
    expect(vacio.stderr()).toContain('no añadió ninguna etiqueta\n');
    expect(vacio.stderr()).not.toContain('descartadas');
  });

  it('--save-aliases cierra el bucle: la frase que el modelo tendió queda como alias y la próxima vez no hace falta', async () => {
    // «c++» es de UNA skill del banco y la oferta no la nombra, así que el puente que tiende el modelo tiene
    // dueño claro. La fila de esa skill viene entrecomillada en el CSV: se comprueba que se respeta.
    const skills = ['name,category,level,years,aliases,tags', 'PHP,language,expert,10,,php|backend', '"C++",language,intermediate,3,cpp,c++', ''].join('\n');
    const h = compiled({ '/work/data/sources/skills.csv': skills }, {
      llmProvider: () => Promise.resolve({ ok: true as const, provider: respuesta({ mappings: [{ tag: 'c++', evidence: 'alto rendimiento' }] }) }),
    });
    expect(await runCli(['analyze-offer', 'offers/acme-backend.txt', '--copilot', '--save-aliases', '--yes'], h.context)).toBe(EXIT_OK);
    const lines = (h.fs.file('/work/data/sources/skills.csv')?.content ?? '').split('\n');
    expect(lines[2]).toBe('"C++",language,intermediate,3,cpp|alto rendimiento,c++');
    expect(lines[0]).toBe('name,category,level,years,aliases,tags');
    expect(lines[1]).toBe('PHP,language,expert,10,,php|backend');
    expect(h.stderr()).toContain('alias guardado en C++: «alto rendimiento» (c++)');
    expect(h.stderr()).toContain('se reconocerá sin modelo');
  });

  it('una etiqueta que no es de ninguna skill se explica en vez de guardarse a medias', async () => {
    // «arquitectura» está en el vocabulario del perfil por una especialidad, no por una skill: el alias no tiene
    // dueño y no se inventa uno.
    const skills = ['name,category,level,years,aliases,tags', '"C++",language,intermediate,3,cpp,c++', ''].join('\n');
    const h = compiled({ '/work/data/sources/skills.csv': skills }, {
      llmProvider: () => Promise.resolve({ ok: true as const, provider: respuesta({ mappings: [{ tag: 'arquitectura', evidence: 'alto rendimiento' }] }) }),
    });
    expect(await runCli(['analyze-offer', 'offers/acme-backend.txt', '--copilot', '--save-aliases', '--yes'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain('alias no guardado «alto rendimiento»: ninguna skill lleva la etiqueta «arquitectura»');
    expect(h.fs.file('/work/data/sources/skills.csv')?.content).toBe(skills);
  });

  it('si skills.csv no está donde debe, --save-aliases lo dice en vez de callarse', async () => {
    const h = compiled({}, {
      llmProvider: () => Promise.resolve({ ok: true as const, provider: respuesta({ mappings: [{ tag: 'c++', evidence: 'alto rendimiento' }] }) }),
    });
    expect(await runCli(['analyze-offer', 'offers/acme-backend.txt', '--copilot', '--save-aliases', '--yes'], h.context)).not.toBe(EXIT_OK);
    expect(h.stderr()).toContain('skills.csv');
  });

  it('con terminal pregunta uno a uno, y lo que no confirmas no se guarda', async () => {
    const skills = ['name,category,level,years,aliases,tags', '"C++",language,intermediate,3,cpp,c++', ''].join('\n');
    const preguntas: string[] = [];
    const h = compiled({ '/work/data/sources/skills.csv': skills }, {
      llmProvider: () => Promise.resolve({ ok: true as const, provider: respuesta({ mappings: [{ tag: 'c++', evidence: 'alto rendimiento' }] }) }),
      confirm: (question: string) => {
        preguntas.push(question);
        return Promise.resolve(false);
      },
    });
    // Sin --yes: el modelo propone y decide la persona, una a una.
    expect(await runCli(['analyze-offer', 'offers/acme-backend.txt', '--copilot', '--save-aliases'], h.context)).toBe(EXIT_OK);
    expect(preguntas[0]).toContain('¿Guardar «alto rendimiento» como alias de tu etiqueta «c++»?');
    expect(h.stderr()).toContain('No se guardó ningún alias.');
    expect(h.fs.file('/work/data/sources/skills.csv')?.content).toBe(skills);
  });

  it('sin --save-aliases no se toca skills.csv', async () => {
    const skills = ['name,category,level,years,aliases,tags', '"C++",language,intermediate,3,cpp,c++', ''].join('\n');
    const h = compiled({ '/work/data/sources/skills.csv': skills }, {
      llmProvider: () => Promise.resolve({ ok: true as const, provider: respuesta({ mappings: [{ tag: 'c++', evidence: 'alto rendimiento' }] }) }),
    });
    expect(await runCli(['analyze-offer', 'offers/acme-backend.txt', '--copilot', '--yes'], h.context)).toBe(EXIT_OK);
    expect(h.fs.file('/work/data/sources/skills.csv')?.content).toBe(skills);
  });

  it('con un proveedor remoto avisa del coste antes de enviar y aborta sin confirmación (C11)', async () => {
    const h = compiled({}, {
      llmProvider: () =>
        Promise.resolve({
          ok: true as const,
          provider: { ...respuesta({ mappings: [] }), id: 'groq' as const, kind: 'remote' as const, baseUrl: 'https://api.groq.com/openai', complete: () => Promise.reject(new Error('no debe enviarse')) },
        }),
    });
    expect(await runCli(['analyze-offer', 'offers/acme-backend.txt', '--copilot'], h.context)).not.toBe(EXIT_OK);
    expect(h.stderr()).toContain('Aviso de coste: 1 petición a groq');
    expect(h.stderr()).toContain('no se envió nada');
  });

  it('sin proveedor no se envía nada y se explica', async () => {
    const h = compiled({}, { llmProvider: () => Promise.resolve({ ok: false as const, message: 'sin proveedor en las pruebas' }) });
    expect(await runCli(['analyze-offer', 'offers/acme-backend.txt', '--copilot', '--yes'], h.context)).not.toBe(EXIT_OK);
    expect(h.stderr()).toContain('sin proveedor');
  });
});

describe('cv analyze-offer: una oferta que no declara sus requisitos', () => {
  it('avisa con el enlace en vez de dar una adecuación del 100 % sobre un solo requisito', async () => {
    // Caso real (1-sep-2026): una oferta de 545 palabras cuyo stack vive en un enlace («check our careers
    // repository: …»). Reconocía 2 términos y presumía de 1/1 imprescindibles: un 100 % que engaña.
    const relleno = 'Buscamos talento con pasión y compromiso para crear producto de calidad en un gran ambiente. '.repeat(20);
    const h = compiled({
      '/work/offers/sin-requisitos.txt': `Senior Backend Developer\n\n${relleno}\nMás detalle del stack en https://example.org/careers/openings/backend.md\n${relleno}`,
    });
    expect(await runCli(['analyze-offer', 'offers/sin-requisitos.txt'], h.context)).toBe(EXIT_OK);
    const aviso = h.stderr();
    expect(aviso).toContain('solo se reconocen');
    expect(aviso).toContain('https://example.org/careers/openings/backend.md');
  });
});

describe('cv analyze-offer', () => {
  it('imprime el resumen de adecuación sin escribir ningún CV (solo anota el historial)', async () => {
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
    expect(h.fs.file('/work/output/historial-ofertas.json')?.mode).toBe(0o600);
    expect(h.fs.file('/work/output/cv-ada-ejemplo-backend-acme-backend.md')).toBeUndefined();
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
    expect(stale.stderr()).toBe('Aviso: profile.md es más reciente que el artefacto; ejecuta «cv build» para regenerarlo\n');

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

describe('ofertas en PDF (T-2.5)', () => {
  let offerPdf: Buffer;

  beforeAll(async () => {
    offerPdf = await makePdf([BACKEND_OFFER.split('\n')]);
  });

  it('analyze-offer y generate-cv aceptan un PDF por la misma puerta, con el mismo resultado que el texto', async () => {
    const analysis = compiled({ '/work/offers/acme-backend.pdf': { kind: 'file', content: '', bytes: offerPdf } });
    expect(await runCli(['analyze-offer', 'offers/acme-backend.pdf'], analysis.context)).toBe(EXIT_OK);
    const lines = analysis.stdout().split('\n');
    expect(lines[0]).toBe('Oferta acme-backend · 7 requisitos reconocidos · 5 años de experiencia exigidos');
    expect(lines[1]).toBe('Adecuación: 6 de 7 requisitos demostrados (86 %) · imprescindibles: 4 de 4');
    const generation = compiled({ '/work/offers/acme-backend.pdf': { kind: 'file', content: '', bytes: offerPdf } });
    expect(await runCli(['generate-cv', '-f', 'offers/acme-backend.pdf'], generation.context)).toBe(EXIT_OK);
    expect(generation.stdout()).toBe('CV escrito en /work/output/cv-ada-ejemplo-acme-backend.md\n');
  });

  it('un PDF corrupto es un error de datos; uno demasiado grande o un tiempo agotado, del entorno', async () => {
    const corrupt = compiled({ '/work/offers/rota.pdf': { kind: 'file', content: '', bytes: Buffer.from('no soy un pdf', 'utf8') } });
    expect(await runCli(['analyze-offer', 'offers/rota.pdf'], corrupt.context)).toBe(EXIT_DATA_ERROR);
    expect(corrupt.stderr()).toBe('No se pudo extraer el texto de «/work/offers/rota.pdf»: Invalid PDF structure.\n');

    const huge = compiled({ '/work/offers/grande.pdf': { kind: 'file', content: '', bytes: new Uint8Array(10 * 1024 * 1024 + 1) } });
    expect(await runCli(['analyze-offer', 'offers/grande.pdf'], huge.context)).toBe(EXIT_FAILURE);
    expect(huge.stderr()).toBe('La oferta «/work/offers/grande.pdf» supera el máximo de 10 MiB\n');

    const slow = compiled(
      { '/work/offers/lenta.pdf': { kind: 'file', content: '', bytes: offerPdf } },
      { pdfExtractor: () => Promise.resolve({ ok: false, code: 'timeout', message: 'La extracción superó los 20000 ms permitidos' }) },
    );
    expect(await runCli(['generate-cv', '-f', 'offers/lenta.pdf'], slow.context)).toBe(EXIT_FAILURE);
    expect(slow.stderr()).toBe('No se pudo extraer el texto de «/work/offers/lenta.pdf»: La extracción superó los 20000 ms permitidos\n');

    const blank = compiled({ '/work/offers/blanca.pdf': { kind: 'file', content: '', bytes: await makePdf([['']]) } });
    expect(await runCli(['analyze-offer', 'offers/blanca.pdf'], blank.context)).toBe(EXIT_DATA_ERROR);
    expect(blank.stderr()).toBe('La oferta está vacía\n');
  });

  it('isPdfSource y pdfExitCode', () => {
    expect(isPdfSource('ofertas/x.PDF')).toBe(true);
    expect(isPdfSource('ofertas/x.txt')).toBe(false);
    expect(pdfExitCode('invalid')).toBe(EXIT_DATA_ERROR);
    expect(pdfExitCode('too-many-pages')).toBe(EXIT_DATA_ERROR);
    expect(pdfExitCode('timeout')).toBe(EXIT_FAILURE);
    expect(pdfExitCode('failed')).toBe(EXIT_FAILURE);
  });
});

describe('generate-cv --format pdf (T-2.6)', () => {
  it('escribe un PDF con permisos 0600 y nombre por defecto .pdf, también con oferta', async () => {
    const harness = compiled();
    expect(await runCli(['generate-cv', '-s', 'backend', '--format', 'pdf'], harness.context)).toBe(EXIT_OK);
    expect(harness.stdout()).toBe('CV escrito en /work/output/cv-ada-ejemplo-backend.pdf\n');
    const written = harness.fs.file('/work/output/cv-ada-ejemplo-backend.pdf');
    expect(written?.mode).toBe(0o600);
    expect(Buffer.from(written?.bytes ?? []).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const extracted = await extractPdfText(written?.bytes ?? new Uint8Array());
    expect(extracted).toMatchObject({ ok: true, pages: 1 });
    expect(extracted.ok && extracted.text).toContain('Ada Ejemplo');

    const withOffer = compiled({ '/work/offers/acme-backend.txt': BACKEND_OFFER });
    expect(await runCli(['generate-cv', '-f', 'offers/acme-backend.txt', '--format', 'PDF', '-o', 'salida/cv.pdf'], withOffer.context)).toBe(EXIT_OK);
    expect(withOffer.stdout()).toBe('CV escrito en /work/salida/cv.pdf\n');
    expect(withOffer.fs.file('/work/salida/cv.pdf')?.mode).toBe(0o600);
  });

  it('--stdout y --template son incompatibles con pdf, y un formato desconocido es un error de uso', async () => {
    const stdout = compiled();
    expect(await runCli(['generate-cv', '--format', 'pdf', '--stdout'], stdout.context)).toBe(EXIT_FAILURE);
    expect(stdout.stderr()).toBe('«--stdout» solo admite «--format md»: el PDF es binario y se escribe siempre en un fichero (--output)\n');
    expect(stdout.fs.log).toEqual([]);

    const template = compiled();
    expect(await runCli(['generate-cv', '--format', 'pdf', '-t', 'mi.hbs'], template.context)).toBe(EXIT_FAILURE);
    expect(template.stderr()).toBe('«--template» solo aplica a «--format md» o a «--engine typst»: pdfkit no usa plantilla\n');

    const unknown = compiled();
    expect(await runCli(['generate-cv', '--format', 'docx'], unknown.context)).toBe(EXIT_FAILURE);
    expect(unknown.stderr()).toContain("error: option '--format <fmt>' argument 'docx' is invalid. formatos admitidos: md, pdf");

    const failing = compiled();
    failing.fs.failures.add('writeFile');
    expect(await runCli(['generate-cv', '--format', 'pdf'], failing.context)).toBe(EXIT_FAILURE);
    expect(failing.stderr()).toBe('No se pudo escribir el CV en «/work/output/cv-ada-ejemplo.pdf»: fallo simulado en writeFile\n');
  });
});

describe('cv analyze-offer --build (T-2.7)', () => {
  it('recompila el artefacto desde las fuentes antes de analizar y elimina el aviso de obsolescencia', async () => {
    const stale = compiled();
    stale.fs.touch('/work/data/sources/profile.md', 900);
    expect(await runCli(['analyze-offer', 'offers/acme-backend.txt', '--build'], stale.context)).toBe(EXIT_OK);
    expect(stale.stderr()).toBe('');
    expect(stale.stdout()).toContain('Adecuación: la oferta no menciona nada del vocabulario del perfil');

    const invalid = compiled({ '/work/data/sources/notas.md': '' });
    expect(await runCli(['analyze-offer', 'offers/acme-backend.txt', '--build'], invalid.context)).toBe(EXIT_DATA_ERROR);
    expect(invalid.stdout()).toBe('');
    expect(invalid.stderr()).toMatch(/\d+ problemas? en \/work\/data\/sources\n$/);
  });
});

describe('generar con la adecuación de la oferta (T-8.9)', () => {
  it('con oferta, las evidencias que demuestran requisitos no se recortan por --top-n y --explain lo dice; --no-keep-evidence lo desactiva', async () => {
    const kept = compiled();
    expect(await runCli(['generate-cv', ...OFFER, '--top-n', '1', '--max-skills', '1', '--explain'], kept.context)).toBe(EXIT_OK);
    const explained = kept.stderr();
    expect(explained).toMatch(/evidencias conservadas por la oferta \(no se recortan\): .*skill-2/);
    const cv = kept.fs.file('/work/output/cv-ada-ejemplo-acme-backend.md')?.content ?? '';
    expect(cv).toContain('Symfony');
    expect(cv).toContain('Kubernetes');

    const plain = compiled();
    expect(await runCli(['generate-cv', ...OFFER, '--top-n', '1', '--max-skills', '1', '--explain', '--no-keep-evidence'], plain.context)).toBe(EXIT_OK);
    expect(plain.stderr()).not.toContain('evidencias conservadas por la oferta');
    const trimmed = plain.fs.file('/work/output/cv-ada-ejemplo-acme-backend.md')?.content ?? '';
    expect(trimmed.length).toBeLessThan(cv.length);
  });

  it('analyze-offer imprime la especialidad sugerida y --json la incluye', async () => {
    const h = compiled();
    expect(await runCli(['analyze-offer', 'offers/acme-backend.txt'], h.context)).toBe(EXIT_OK);
    const lines = h.stdout().split('\n');
    expect(lines[2]).toMatch(/^Especialidad sugerida: backend \(.*; cubre \d+ de \d+ requisitos con peso\)$/);
    const json = compiled();
    expect(await runCli(['analyze-offer', 'offers/acme-backend.txt', '--json'], json.context)).toBe(EXIT_OK);
    const payload = JSON.parse(json.stdout()) as { suggestedSpecialty?: { id: string; covered: number; total: number } };
    expect(payload.suggestedSpecialty?.id).toBe('backend');
    expect(payload.suggestedSpecialty?.covered).toBeGreaterThan(0);
  });
});
