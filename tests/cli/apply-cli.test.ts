import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultAssets } from '../../src/shared/assets';
import { serializeProfile } from '../../src/artifact';
import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK, backupPath, buildSourceIndex, isSafeSourcePath, runCli, summarySource, type CliContext } from '../../src/cli';
import { MemoryLlmCache, fingerprint, formatReview, type LlmProvider, type LlmRequest, type ReviewHeader, type ReviewItem } from '../../src/llm';
import { NodeFileSystem, defaultSourceParsers, loadDataset } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import { renderTypstCv } from '../../src/renderers/typst';
import { installTypst, typstStatus } from '../../src/typst';
import { BACKEND_OFFER } from '../fixtures/offer';
import { MemoryFileSystem, type MemoryEntry } from '../helpers/memory-file-system';

interface Harness {
  readonly context: CliContext;
  readonly fs: MemoryFileSystem;
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly reset: () => void;
  /** Mueve el reloj del contexto: el histórico de fuentes fecha (y nombra) sus entradas con él. */
  readonly setNow: (at: Date) => void;
}

const NOW = new Date('2026-08-29T10:00:00.000Z');
const FIXTURE = join(__dirname, '../fixtures/dataset');
const SOURCES = '/work/data/sources';
const REVIEW = '/work/output/revision-improve-2026-08-29.md';
const ORIGINAL_1 = 'Reduje la latencia p95 del checkout un **40 %** rediseñando la capa de caché.';
const ORIGINAL_K8S = 'Lideré la migración a Kubernetes sin ventana de parada.';
const FAITHFUL_SUMMARY = 'Senior Backend Engineer con 3 años de experiencia en plataformas de pago con PHP, Symfony y Kubernetes; reduje la latencia p95 del checkout un 40 %.\n\nCertificada CKA.';

let tree: Record<string, MemoryEntry> | undefined;
let artifact = '';

/** El dataset de la fixture, tal cual, en el sistema de ficheros en memoria, más su artefacto compilado. */
const fixtureText = new Map<string, string>();

async function workspace(): Promise<Record<string, string | MemoryEntry>> {
  if (tree === undefined) {
    const entries = await readdir(FIXTURE, { recursive: true, withFileTypes: true });
    const built: Record<string, MemoryEntry> = {};
    for (const entry of entries) {
      if (entry.isFile()) {
        const absolute = join(entry.parentPath, entry.name);
        const content = await readFile(absolute, 'utf8');
        fixtureText.set(`${SOURCES}/${relative(FIXTURE, absolute)}`, content);
        built[`${SOURCES}/${relative(FIXTURE, absolute)}`] = { kind: 'file', content, mtimeMs: 100 };
      }
    }
    const dataset = await loadDataset(FIXTURE, { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
    if (!dataset.ok) {
      throw new Error('dataset');
    }
    artifact = serializeProfile(dataset.profile);
    tree = built;
  }
  return { ...tree, '/work/data/dist/profile.json': { kind: 'file', content: artifact, mode: 0o600, mtimeMs: 500 }, '/work/offers/acme-backend.txt': BACKEND_OFFER };
}

function fakeProvider(task: 'improve' | 'summarize'): LlmProvider {
  return {
    id: 'ollama',
    kind: 'local',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'fake',
    complete: (request: LlmRequest) => {
      const input = JSON.parse(request.messages[1]?.content ?? '{}') as { text?: string };
      const faithful = task === 'improve' ? `Logré: ${(input.text ?? '').replace(/\*\*/g, '')}` : FAITHFUL_SUMMARY;
      const json = { proposals: [{ text: faithful, rationale: 'fiel' }, { text: `${faithful} con Terraform y 99 %`, rationale: 'inventa' }] };
      return Promise.resolve({ ok: true, json, raw: JSON.stringify(json), model: 'fake', usage: {}, elapsedMs: 3 });
    },
    health: () => Promise.resolve({ ok: true, version: undefined, models: ['fake'], modelAvailable: true }),
  };
}

async function harness(task: 'improve' | 'summarize' = 'improve', extra: Record<string, string | MemoryEntry> = {}): Promise<Harness> {
  const out: string[] = [];
  const err: string[] = [];
  let clock = NOW;
  const fs = new MemoryFileSystem({ ...(await workspace()), ...extra });
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
    llmStatus: () => Promise.reject(new Error('no usado')),
    llmProvider: () => Promise.resolve({ ok: true as const, provider: fakeProvider(task) }),
    llmCache: new MemoryLlmCache(),
    assets: defaultAssets(),
    now: () => clock,
  };
  return {
    context,
    fs,
    stdout: () => out.join(''),
    stderr: () => err.join(''),
    reset: () => {
      out.length = 0;
      err.length = 0;
    },
    setNow: (at: Date) => {
      clock = at;
    },
  };
}

/** Marca `[x]` la propuesta `number` del ítem `id` en la revisión escrita en el sistema de ficheros. */
async function mark(h: Harness, path: string, id: string, number: number): Promise<void> {
  const content = h.fs.file(path)?.content ?? '';
  const start = content.indexOf(`## ${id} ·`);
  const line = `- [ ] Propuesta ${number}:`;
  const at = content.indexOf(line, start);
  if (start === -1 || at === -1) {
    throw new Error(`no hay propuesta ${number} en ${id}`);
  }
  await h.fs.writeFile(path, `${content.slice(0, at)}- [x] Propuesta ${number}:${content.slice(at + line.length)}`, 0o600);
}

const HEADER: ReviewHeader = { task: 'summarize', generatedAt: NOW.toISOString(), dataDir: 'data/sources', provider: { id: 'ollama', baseUrl: 'u', model: 'm' }, promptVersion: 'summarize.v1', temperature: 0, seed: 7 };

function handmade(h: Harness, path: string, header: ReviewHeader, items: readonly ReviewItem[], checked = true): Promise<void> {
  const text = formatReview(header, items);
  return h.fs.writeFile(path, checked ? text.replace('- [ ] Propuesta 1:', '- [x] Propuesta 1:') : text, 0o600);
}

const OK = { accepted: true, violations: [] } as const;
const item = (id: string, original: string, text: string, source: ReviewItem['source'], location = 'x'): ReviewItem => ({ id, location, original, source, proposals: [{ text, rationale: 'r', verdict: OK }], fromCache: false, elapsedMs: 1, usage: {} });

describe('cv improve apply (T-4.7): ciclo completo improve → marcar → aplicar → build', () => {
  it('aplica solo lo marcado, cambia únicamente el texto del logro, crea la copia de seguridad y el dataset sigue compilando', async () => {
    const h = await harness();
    expect(await runCli(['improve', '--only', 'exp-acme-1,exp-acme-k8s'], h.context)).toBe(EXIT_OK);
    const review = h.fs.file(REVIEW)?.content ?? '';
    expect(review).toContain('- fuentes: data/sources\n');
    expect(review).toContain(`Fuente: experience/acme.md:15 · sha256 ${fingerprint(ORIGINAL_1)}\n`);
    expect(review).toContain(`Fuente: experience/acme.md:18 · sha256 ${fingerprint(ORIGINAL_K8S)}\n`);
    expect(h.stderr()).not.toContain('Aviso');
    await mark(h, REVIEW, 'exp-acme-1', 1);
    await mark(h, REVIEW, 'exp-acme-k8s', 1);
    h.reset();

    const before = h.fs.file(`${SOURCES}/experience/acme.md`)?.content ?? '';
    // `--no-archive` para poder seguir aplicándola por su ruta: el archivado automático tiene su propia prueba.
    expect(await runCli(['improve', 'apply', 'output/revision-improve-2026-08-29.md', '--no-archive'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe(`Aplicado en ${SOURCES}/experience/acme.md (versión anterior guardada en /work/output/historial-fuentes/20260829T100000000Z-revision-improve-2026-08-29/experience/acme.md): exp-acme-1, exp-acme-k8s\n`);
    expect(h.stderr()).toBe('2 cambios aplicados en 1 fichero · recompila el artefacto con «cv build»\n');
    const after = h.fs.file(`${SOURCES}/experience/acme.md`);
    expect(after?.mode).toBe(0o600);
    expect(after?.content).toBe(
      before
        .replace(ORIGINAL_1, 'Logré: Reduje la latencia p95 del checkout un 40 % rediseñando la capa de caché.')
        .replace(ORIGINAL_K8S, 'Logré: Lideré la migración a Kubernetes sin ventana de parada.'),
    );
    expect(after?.content).toContain('- Logré: Reduje la latencia p95 del checkout un 40 % rediseñando la capa de caché. #performance #php\n  - impact: -40 % p95\n  - date: 2023-05\n- Logré: Lideré la migración a Kubernetes sin ventana de parada. #kubernetes #devops\n  - id: exp-acme-k8s\n- Introduje contract testing');
    const backup = h.fs.file('/work/output/historial-fuentes/20260829T100000000Z-revision-improve-2026-08-29/experience/acme.md');
    expect(backup?.content).toBe(before);
    expect(backup?.mode).toBe(0o600);
    expect(h.fs.file(`${SOURCES}/experience/acme.md.bak`)).toBeUndefined();
    expect(h.fs.file('/work/output/historial-fuentes/index.json')?.content).toContain('"origin": "revision-improve-2026-08-29.md"');
    expect(h.fs.file(REVIEW)).toBeDefined();
    expect(h.fs.file(`${SOURCES}/experience/startup.md`)?.content).toBe(fixtureText.get(`${SOURCES}/experience/startup.md`));

    // El histórico vive en output/: no molesta al compilador y el artefacto recoge el cambio.
    h.reset();
    expect(await runCli(['build'], h.context)).toBe(EXIT_OK);
    expect(h.fs.file('/work/data/dist/profile.json')?.content).toContain('Logré: Reduje la latencia p95');

    // Aplicar dos veces la misma revisión no sobrescribe nada, y —esto es lo que se corrigió el 1-sep, tras
    // encontrárselo el PO— lo dice como lo que es: YA APLICADA. Antes se trataba como un error de datos y el
    // mensaje culpaba al usuario («¿editado a mano?») del caso más probable, que es haberla aplicado ya.
    h.reset();
    expect(await runCli(['improve', 'apply', 'output/revision-improve-2026-08-29.md', '--no-archive'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain('2 propuestas ya aplicadas (exp-acme-1, exp-acme-k8s)');
    expect(h.stderr()).toContain('cv improve undo output/revision-improve-2026-08-29.md');
    // Y no se toca el fichero: ni copia, ni reescritura idéntica, ni entrada nueva en el histórico.
    expect(h.fs.file(`${SOURCES}/experience/acme.md.bak`)).toBeUndefined();
    expect(h.stderr()).not.toContain('cambios aplicados');
  });

  it('en la raíz del dataset una copia .bak antigua se respeta y la versión anterior va al histórico; --delete-review borra la revisión', async () => {
    const h = await harness('improve', { [`${SOURCES}/achievements.md.bak`]: 'copia antigua' });
    expect(await runCli(['improve', '--only', 'ach-1'], h.context)).toBe(EXIT_OK);
    await mark(h, REVIEW, 'ach-1', 1);
    h.reset();
    expect(await runCli(['improve', 'apply', 'output/revision-improve-2026-08-29.md', '--delete-review'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe(`Aplicado en ${SOURCES}/achievements.md (versión anterior guardada en /work/output/historial-fuentes/20260829T100000000Z-revision-improve-2026-08-29/achievements.md): ach-1\nRevisión eliminada: ${REVIEW}\n`);
    expect(h.fs.file(`${SOURCES}/achievements.md.bak`)?.content).toBe('copia antigua');
    expect(h.fs.file(`${SOURCES}/achievements.md`)?.content).toContain('- Logré: Ponente en una conferencia de ejemplo sobre sistemas distribuidos. #comunidad\n');
    expect(h.fs.file(REVIEW)).toBeUndefined();
    h.reset();
    expect(await runCli(['build'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toBe('');
    expect(await backupPath(h.context, `${SOURCES}/achievements.md`)).toBe(`${SOURCES}/achievements.md.bak.1`);
  });

  it('--dry-run muestra el plan sin tocar nada y -d permite otro directorio de fuentes', async () => {
    const h = await harness();
    expect(await runCli(['improve', '--only', 'exp-acme-1'], h.context)).toBe(EXIT_OK);
    await mark(h, REVIEW, 'exp-acme-1', 1);
    h.reset();
    expect(await runCli(['improve', 'apply', 'output/revision-improve-2026-08-29.md', '--dry-run'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe(`${SOURCES}/experience/acme.md: exp-acme-1 → Logré: Reduje la latencia p95 del checkout un 40 % rediseñando la capa de caché.\n`);
    expect(h.stderr()).toBe('Ejecución en seco: no se ha modificado nada\n');
    expect(h.fs.file(`${SOURCES}/experience/acme.md`)?.content).toContain(ORIGINAL_1);
    expect(h.fs.file(`${SOURCES}/experience/acme.md.bak`)).toBeUndefined();
    h.reset();
    expect(await runCli(['improve', 'apply', 'output/revision-improve-2026-08-29.md', '-d', 'otras/fuentes'], h.context)).toBe(EXIT_DATA_ERROR);
    expect(h.stderr()).toContain('«exp-acme-1»: no se pudo leer /work/otras/fuentes/experience/acme.md: ');
  });

  it('se niega si no hay marcas, si hay más de una por ítem, si la fuente cambió o si la revisión apunta a otro logro', async () => {
    const h = await harness();
    expect(await runCli(['improve', '--only', 'exp-acme-1,exp-acme-k8s'], h.context)).toBe(EXIT_OK);
    h.reset();
    expect(await runCli(['improve', 'apply', REVIEW], h.context)).toBe(EXIT_DATA_ERROR);
    expect(h.stderr()).toBe(`Nada que aplicar: ninguna propuesta marcada con [x] en ${REVIEW}\n`);

    await mark(h, REVIEW, 'exp-acme-1', 1);
    const twice = (h.fs.file(REVIEW)?.content ?? '').replace('- ~~Propuesta 2: Logré: Reduje', '- [x] Propuesta 2: Logré: Reduje');
    await h.fs.writeFile(REVIEW, twice, 0o600);
    h.reset();
    expect(await runCli(['improve', 'apply', REVIEW], h.context)).toBe(EXIT_DATA_ERROR);
    expect(h.stderr()).toBe('«exp-acme-1»: hay 2 propuestas marcadas con [x]; marca solo una\nNo se ha modificado ningún fichero\n');

    await h.fs.writeFile(REVIEW, twice.replace('- [x] Propuesta 2: Logré: Reduje', '- ~~Propuesta 2: Logré: Reduje'), 0o600);
    const source = h.fs.file(`${SOURCES}/experience/acme.md`)?.content ?? '';
    await h.fs.writeFile(`${SOURCES}/experience/acme.md`, source.replace(ORIGINAL_1, 'Editado a mano después de la revisión.'), 0o600);
    h.reset();
    expect(await runCli(['improve', 'apply', REVIEW], h.context)).toBe(EXIT_DATA_ERROR);
    expect(h.stderr()).toBe('«exp-acme-1»: el logro original no está tal cual en experience/acme.md (¿editado a mano?)\nNo se ha modificado ningún fichero\n');
    expect(h.fs.file(`${SOURCES}/experience/acme.md.bak`)).toBeUndefined();

    // La revisión, editada para señalar otro logro existente: la huella no coincide y no se toca nada.
    await h.fs.writeFile(`${SOURCES}/experience/acme.md`, source, 0o600);
    const redirected = (h.fs.file(REVIEW)?.content ?? '').replace(`Original: ${ORIGINAL_1}`, 'Original: Introduje contract testing entre el monolito y 4 microservicios.');
    await h.fs.writeFile(REVIEW, redirected, 0o600);
    h.reset();
    expect(await runCli(['improve', 'apply', REVIEW], h.context)).toBe(EXIT_DATA_ERROR);
    expect(h.stderr()).toBe(`«exp-acme-1»: el original cambió desde la revisión (huella ${fingerprint('Introduje contract testing entre el monolito y 4 microservicios.')} ≠ ${fingerprint(ORIGINAL_1)})\nNo se ha modificado ningún fichero\n`);
  });

  it('explica una revisión ilegible o ajena, ítems sin fuente, rutas no admitidas, propuestas vacías y fallos de escritura', async () => {
    const h = await harness();
    expect(await runCli(['improve', 'apply', 'output/no-existe.md'], h.context)).toBe(EXIT_DATA_ERROR);
    expect(h.stderr()).toContain('No se pudo leer la revisión «/work/output/no-existe.md»: ');
    await h.fs.writeFile('/work/output/otro.md', '# Otra cosa\n', 0o600);
    h.reset();
    expect(await runCli(['improve', 'apply', 'output/otro.md'], h.context)).toBe(EXIT_DATA_ERROR);
    expect(h.stderr()).toBe('/work/output/otro.md: no es un fichero de revisión de «cv improve» ni de «cv summarize» (falta su cabecera)\n');

    const improveHeader: ReviewHeader = { ...HEADER, task: 'improve', promptVersion: 'improve.v1' };
    await handmade(h, '/work/output/r.md', improveHeader, [
      item('sin-fuente', 'x', 'y', undefined),
      item('fuera', 'x', 'y', { file: '../../etc/passwd', line: 1, hash: 'abc' }),
      item('absoluta', 'x', 'y', { file: '/etc/passwd', line: 1, hash: 'abc' }),
      item('vacia', ORIGINAL_1, '   ', { file: 'experience/acme.md', line: 15, hash: fingerprint(ORIGINAL_1) }),
    ]);
    const content = (h.fs.file('/work/output/r.md')?.content ?? '').replace(/- \[ \] Propuesta 1:/g, '- [x] Propuesta 1:');
    await h.fs.writeFile('/work/output/r.md', content, 0o600);
    h.reset();
    expect(await runCli(['improve', 'apply', 'output/r.md'], h.context)).toBe(EXIT_DATA_ERROR);
    expect(h.stderr()).toBe(
      [
        '«vacia»: la propuesta 1 marcada está vacía',
        '«sin-fuente»: la revisión no registra su fuente (se generó con fuentes inválidas u obsoletas, o el resumen no tiene destino); cópiala a mano',
        '«fuera»: ruta de fuente no admitida «../../etc/passwd»',
        '«absoluta»: ruta de fuente no admitida «/etc/passwd»',
        'No se ha modificado ningún fichero',
        '',
      ].join('\n'),
    );
    expect(isSafeSourcePath('experience/acme.md')).toBe(true);
    expect(isSafeSourcePath('a\\b.md')).toBe(false);
    expect(isSafeSourcePath('./a.md')).toBe(false);
    expect(isSafeSourcePath('a//b.md')).toBe(false);

    await handmade(h, '/work/output/ok.md', improveHeader, [item('exp-acme-1', ORIGINAL_1, 'Nuevo texto.', { file: 'experience/acme.md', line: 15, hash: fingerprint(ORIGINAL_1) })]);
    h.fs.failures.add('writeFile');
    h.reset();
    expect(await runCli(['improve', 'apply', 'output/ok.md'], h.context)).toBe(EXIT_FAILURE);
    expect(h.stderr()).toMatch(/^No se pudo guardar el histórico en \/work\/output\/historial-fuentes\/[^:]+: fallo simulado en writeFile\n$/);
    expect(h.fs.file(`${SOURCES}/experience/acme.md`)?.content).toContain(ORIGINAL_1);
    // Si el histórico se guarda pero la fuente no se puede escribir, se dice y la fuente queda intacta.
    h.fs.failures.delete('writeFile');
    h.reset();
    const sourceFails: CliContext = {
      ...h.context,
      artifactFileSystem: {
        ...h.context.artifactFileSystem,
        mkdir: (path: string) => h.context.artifactFileSystem.mkdir(path),
        readFile: (path: string) => h.context.artifactFileSystem.readFile(path),
        remove: (path: string) => h.context.artifactFileSystem.remove(path),
        writeFile: async (path: string, content: string, mode: number) => {
          if (path.startsWith(`${SOURCES}/`)) {
            throw new Error('fuente de solo lectura');
          }
          await h.context.artifactFileSystem.writeFile(path, content, mode);
        },
      },
    };
    expect(await runCli(['improve', 'apply', 'output/ok.md'], sourceFails)).toBe(EXIT_FAILURE);
    expect(h.stderr()).toBe(`No se pudo escribir ${SOURCES}/experience/acme.md: fuente de solo lectura\n`);
    expect(h.fs.file(`${SOURCES}/experience/acme.md`)?.content).toContain(ORIGINAL_1);
    expect(h.fs.file('/work/output/historial-fuentes/index.json')).toBeDefined();
  });
});

describe('cv improve apply con revisiones de cv summarize', () => {
  it('sustituye el resumen de la especialidad (ciclo completo) y el de profile.md, e inserta uno donde no lo había', async () => {
    const h = await harness('summarize');
    expect(await runCli(['summarize', '-s', 'backend', '--redact-companies'], h.context)).toBe(EXIT_OK);
    const path = '/work/output/revision-summarize-2026-08-29-backend.md';
    expect(h.fs.file(path)?.content).toContain(`Fuente: specialties/backend.md:6 · sha256 ${fingerprint('APIs y sistemas distribuidos para esta especialidad.')}\n`);
    await mark(h, path, 'summary', 1);
    h.reset();
    expect(await runCli(['improve', 'apply', path], h.context)).toBe(EXIT_OK);
    // Un resumen es un solo ítem: aplicarlo no deja nada pendiente y la revisión se archiva sola (T-9.24).
    expect(h.stdout()).toMatch(
      /^Aplicado en \/work\/data\/sources\/specialties\/backend\.md \(versión anterior guardada en \/work\/output\/historial-fuentes\/20260829T100000000Z-revision-summarize[^)]*\/specialties\/backend\.md\): summary\nRevisión archivada \(ya no deja nada pendiente\): \/work\/output\/revisiones-archivadas\/revision-summarize-2026-08-29-backend\.md\n$/,
    );
    expect(h.fs.file(`${SOURCES}/specialties/backend.md`)?.content).toBe(`---\ntitle: Senior Backend Engineer\ntags: [php, symfony, kubernetes, kafka]\n---\n\n${FAITHFUL_SUMMARY}\n`);
    expect(h.fs.file('/work/output/historial-fuentes/20260829T100000000Z-revision-summarize-2026-08-29-backend/specialties/backend.md')?.content).toBe(fixtureText.get(`${SOURCES}/specialties/backend.md`));

    const profileSummary = 'Ingeniera de software con **10 años** construyendo plataformas de pago.\n\nResumen por defecto en dos párrafos.';
    await handmade(h, '/work/output/p.md', HEADER, [item('summary', profileSummary, 'Perfil nuevo.\n\nCon dos párrafos.', { file: 'profile.md', line: 23, hash: fingerprint(profileSummary) })]);
    h.reset();
    expect(await runCli(['improve', 'apply', 'output/p.md'], h.context)).toBe(EXIT_OK);
    const profile = h.fs.file(`${SOURCES}/profile.md`)?.content ?? '';
    expect(profile).toContain('  - { name: Inglés, level: C1 }\n---\n\nPerfil nuevo.\n\nCon dos párrafos.\n');
    expect(profile).not.toContain('Resumen por defecto');

    await handmade(h, '/work/output/em.md', { ...HEADER, specialty: 'engineering-manager', dataDir: undefined }, [item('summary', '(sin resumen actual)', 'Resumen nuevo para EM.', { file: 'specialties/engineering-manager.md', line: 1, hash: fingerprint('') })]);
    h.reset();
    expect(await runCli(['improve', 'apply', 'output/em.md'], h.context)).toBe(EXIT_OK);
    expect(h.fs.file(`${SOURCES}/specialties/engineering-manager.md`)?.content).toBe('---\ntitle: Engineering Manager\ntags: [liderazgo, gestion, agile]\n---\n\nResumen nuevo para EM.\n');
    h.reset();
    expect(await runCli(['build'], h.context)).toBe(EXIT_OK);

    await handmade(h, '/work/output/bad.md', { ...HEADER, specialty: 'backend' }, [item('summary', 'x', 'y', { file: 'specialties/backend.md', line: 6, hash: fingerprint('APIs y sistemas distribuidos para esta especialidad.') })]);
    h.reset();
    expect(await runCli(['improve', 'apply', 'output/bad.md'], h.context)).toBe(EXIT_DATA_ERROR);
    expect(h.stderr()).toBe(`«summary»: el resumen de specialties/backend.md cambió desde la revisión (huella ${fingerprint(FAITHFUL_SUMMARY)} ≠ ${fingerprint('APIs y sistemas distribuidos para esta especialidad.')})\nNo se ha modificado ningún fichero\n`);

    // Y volver a aplicar el resumen que YA está puesto no es un fallo: se dice que ya está (1-sep).
    await handmade(h, '/work/output/otra-vez.md', { ...HEADER, specialty: 'engineering-manager', dataDir: undefined }, [
      item('summary', '(sin resumen actual)', 'Resumen nuevo para EM.', { file: 'specialties/engineering-manager.md', line: 1, hash: fingerprint('') }),
    ]);
    h.reset();
    expect(await runCli(['improve', 'apply', 'output/otra-vez.md'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain('1 propuesta ya aplicada (summary)');
  });

  it('al generar la revisión avisa cuando no puede registrar la fuente (oferta sin -s, fuentes inválidas, artefacto obsoleto)', async () => {
    const offer = await harness('summarize');
    expect(await runCli(['summarize', '-f', 'offers/acme-backend.txt'], offer.context)).toBe(EXIT_OK);
    expect(offer.stderr()).toContain('Aviso: un resumen orientado a una oferta (sin -s) no tiene destino en las fuentes');
    expect(offer.fs.file('/work/output/revision-summarize-2026-08-29-acme-backend.md')?.content).not.toContain('Fuente:');

    const broken = await harness('summarize', { [`${SOURCES}/profile.md`]: { kind: 'file', content: '---\nfullName: Ada\nemail: nope\n---\n', mtimeMs: 100 } });
    expect(await runCli(['summarize', '-s', 'backend'], broken.context)).toBe(EXIT_OK);
    expect(broken.stderr()).toContain('Aviso: no se registrará la fuente del resumen (1 problema en /work/data/sources (compruébalo con «cv validate»)); «cv improve apply» no podrá aplicar esta revisión');
    const brokenImprove = await harness('improve', { [`${SOURCES}/profile.md`]: { kind: 'file', content: '---\nfullName: Ada\nemail: nope\n---\n', mtimeMs: 100 } });
    expect(await runCli(['improve', '--only', 'exp-acme-1'], brokenImprove.context)).toBe(EXIT_OK);
    expect(brokenImprove.stderr()).toContain('Aviso: no se registrará la fuente de los logros (1 problema en /work/data/sources (compruébalo con «cv validate»)); «cv improve apply» no podrá aplicar esta revisión');

    const stale = await harness('improve');
    const source = stale.fs.file(`${SOURCES}/experience/acme.md`)?.content ?? '';
    await stale.fs.writeFile(`${SOURCES}/experience/acme.md`, source.replace(ORIGINAL_1, 'Texto cambiado tras compilar.'), 0o600);
    stale.fs.touch(`${SOURCES}/experience/acme.md`, 100);
    expect(await runCli(['improve', '--only', 'exp-acme-1,exp-acme-k8s'], stale.context)).toBe(EXIT_OK);
    expect(stale.stderr()).toContain('Aviso: el logro «exp-acme-1» difiere entre el artefacto y experience/acme.md:15 (recompila con «cv build»): la revisión no registrará su fuente');
    expect(stale.fs.file(REVIEW)?.content).toContain('Fuente: experience/acme.md:18');
    expect(stale.fs.file(REVIEW)?.content).not.toContain('Fuente: experience/acme.md:15');

    const missing = await harness('summarize');
    await missing.fs.remove(`${SOURCES}/specialties/backend.md`);
    missing.fs.touch(`${SOURCES}/profile.md`, 100);
    expect(await runCli(['summarize', '-s', 'backend'], missing.context)).toBe(EXIT_OK);
    expect(missing.stderr()).toContain('Aviso: no se encontró en las fuentes el resumen de la especialidad «backend»: la revisión no registrará fuente');
    const gone = await harness('improve');
    await gone.fs.remove(`${SOURCES}/achievements.md`);
    expect(await runCli(['improve', '--only', 'ach-1'], gone.context)).toBe(EXIT_OK);
    expect(gone.stderr()).toContain('Aviso: el logro «ach-1» no está en las fuentes (¿artefacto obsoleto?)');
  });

  it('avisa con el recuento en plural cuando las fuentes tienen varios problemas', async () => {
    const broken = await harness('improve', {
      [`${SOURCES}/profile.md`]: { kind: 'file', content: '---\nfullName: Ada\nemail: nope\n---\n', mtimeMs: 100 },
      [`${SOURCES}/experience/acme.md`]: { kind: 'file', content: '---\ncompany: ACME\nrole: Dev\nstart: 2020-13\n---\n', mtimeMs: 100 },
    });
    expect(await runCli(['improve', '--only', 'ach-1'], broken.context)).toBe(EXIT_OK);
    expect(broken.stderr()).toContain('(2 problemas en /work/data/sources (compruébalo con «cv validate»))');
    const warnings: string[] = [];
    expect(summarySource({ achievements: new Map(), summaries: new Map() }, undefined, undefined, (line) => warnings.push(line))).toBeUndefined();
    expect(warnings).toEqual(['Aviso: no se encontró en las fuentes el resumen de profile.md: la revisión no registrará fuente']);
  });

  it('buildSourceIndex sin procedencia no indexa nada', async () => {
    const dataset = await loadDataset(FIXTURE, { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
    if (!dataset.ok) throw new Error('dataset');
    const empty = buildSourceIndex(dataset.profile, []);
    expect(buildSourceIndex(dataset.profile, [{ path: ['experience', 0, 'achievements', 0], file: 'x.md' }]).achievements.get('exp-acme-1')).toEqual({ file: 'x.md', line: 1, text: ORIGINAL_1 });
    expect(empty.achievements.size).toBe(0);
    expect(empty.summaries.size).toBe(0);
    const full = buildSourceIndex(dataset.profile, dataset.provenance);
    expect(full.achievements.get('exp-acme-1')).toEqual({ file: 'experience/acme.md', line: 15, text: ORIGINAL_1 });
    expect(full.summaries.get('profile')).toMatchObject({ file: 'profile.md', line: 23 });
    expect(full.summaries.get('specialty:engineering-manager')).toEqual({ file: 'specialties/engineering-manager.md', line: 1, text: '' });
  });
});

describe('cv history (T-8.10)', () => {
  it('lista las entradas, muestra la versión guardada («latest») y restaura dejando la actual en el histórico', async () => {
    const h = await harness();
    expect(await runCli(['history'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('Histórico de fuentes vacío');
    h.reset();
    expect(await runCli(['improve', '--only', 'exp-acme-1'], h.context)).toBe(EXIT_OK);
    await mark(h, REVIEW, 'exp-acme-1', 1);
    h.reset();
    const before = h.fs.file(`${SOURCES}/experience/acme.md`)?.content ?? '';
    expect(await runCli(['improve', 'apply', 'output/revision-improve-2026-08-29.md'], h.context)).toBe(EXIT_OK);
    h.reset();
    expect(await runCli(['history'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe('2026-08-29T10:00:00.000Z · apply revision-improve-2026-08-29.md · experience/acme.md (exp-acme-1) · 20260829T100000000Z-revision-improve-2026-08-29\n');
    h.reset();
    expect(await runCli(['history', '--json'], h.context)).toBe(EXIT_OK);
    expect((JSON.parse(h.stdout()) as { entries: { id: string }[] }).entries[0]?.id).toBe('20260829T100000000Z-revision-improve-2026-08-29');
    h.reset();
    expect(await runCli(['history', 'show', 'latest', 'experience/acme.md'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe(before);
    h.reset();
    expect(await runCli(['history', 'show', 'no-existe', 'experience/acme.md'], h.context)).toBe(EXIT_DATA_ERROR);
    expect(h.stderr()).toContain('No hay ninguna entrada «no-existe»');
    h.reset();
    expect(await runCli(['history', 'restore', 'latest', 'experience/acme.md'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain(`Restaurado ${SOURCES}/experience/acme.md desde la entrada latest`);
    expect(h.fs.file(`${SOURCES}/experience/acme.md`)?.content).toBe(before);
    h.reset();
    expect(await runCli(['history'], h.context)).toBe(EXIT_OK);
    expect(h.stdout().split('\n')[0]).toContain('· restore 20260829T100000000Z-revision-improve-2026-08-29 · experience/acme.md');
    h.reset();
    expect(await runCli(['history', 'restore', 'latest', 'otra.md'], h.context)).toBe(EXIT_DATA_ERROR);
  });
});


describe('cv improve archive | unarchive | undo (T-9.24)', () => {
  const ARCHIVED = '/work/output/revisiones-archivadas/revision-improve-2026-08-29.md';

  /** Una revisión de un solo logro, marcada: aplicarla no deja nada pendiente. */
  async function marcada(): Promise<Harness> {
    const h = await harness('improve', {});
    expect(await runCli(['improve', '--only', 'exp-acme-1'], h.context)).toBe(EXIT_OK);
    await mark(h, REVIEW, 'exp-acme-1', 1);
    h.reset();
    return h;
  }

  it('aplicar una revisión que ya no deja nada pendiente la archiva sola; --no-archive la deja donde está', async () => {
    const h = await marcada();
    expect(await runCli(['improve', 'apply', 'output/revision-improve-2026-08-29.md'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain(`Revisión archivada (ya no deja nada pendiente): ${ARCHIVED}`);
    expect(h.fs.file(REVIEW)).toBeUndefined();
    expect(h.fs.file(ARCHIVED)).toBeDefined();

    // Con --no-archive, la misma aplicación deja la revisión en su sitio.
    const otra = await marcada();
    expect(await runCli(['improve', 'apply', 'output/revision-improve-2026-08-29.md', '--no-archive'], otra.context)).toBe(EXIT_OK);
    expect(otra.stdout()).not.toContain('archivada');
    expect(otra.fs.file(REVIEW)).toBeDefined();
  });

  it('una revisión con ítems sin marcar NO se archiva: todavía tiene trabajo dentro', async () => {
    const h = await harness();
    expect(await runCli(['improve', '--only', 'exp-acme-1,exp-acme-k8s'], h.context)).toBe(EXIT_OK);
    await mark(h, REVIEW, 'exp-acme-1', 1);
    h.reset();
    expect(await runCli(['improve', 'apply', 'output/revision-improve-2026-08-29.md'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).not.toContain('archivada');
    expect(h.fs.file(REVIEW)).toBeDefined();
  });

  it('archive y unarchive mueven el fichero; repetirlo lo dice sin mover nada y lo que no existe da error', async () => {
    const h = await marcada();
    expect(await runCli(['improve', 'archive', 'output/revision-improve-2026-08-29.md'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe(`Archivada: ${ARCHIVED}\n`);
    expect(h.fs.file(ARCHIVED)).toBeDefined();
    h.reset();
    // Se acepta la ruta que se tenga a mano: la de dentro del archivo también.
    expect(await runCli(['improve', 'archive', 'output/revisiones-archivadas/revision-improve-2026-08-29.md'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain('ya estaba archivada');
    h.reset();
    expect(await runCli(['improve', 'unarchive', 'output/revision-improve-2026-08-29.md'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe(`Desarchivada: ${REVIEW}\n`);
    h.reset();
    expect(await runCli(['improve', 'unarchive', 'output/revision-improve-2026-08-29.md'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain('ya estaba a la vista');
    h.reset();
    expect(await runCli(['improve', 'archive', 'output/revision-que-no-esta.md'], h.context)).toBe(EXIT_FAILURE);
    expect(h.stderr()).toContain('No existe la revisión');
  });

  it('undo devuelve la fuente a como estaba, saca la revisión del archivo y sin aplicación previa lo dice', async () => {
    const h = await marcada();
    const antes = h.fs.file(`${SOURCES}/experience/acme.md`)?.content ?? '';
    expect(await runCli(['improve', 'apply', 'output/revision-improve-2026-08-29.md'], h.context)).toBe(EXIT_OK);
    expect(h.fs.file(`${SOURCES}/experience/acme.md`)?.content).toContain('Logré: ');
    h.reset();
    // El histórico fecha sus entradas con el reloj del contexto: deshacer ocurre después de aplicar.
    h.setNow(new Date('2026-08-30T10:00:00.000Z'));
    expect(await runCli(['improve', 'undo', 'output/revisiones-archivadas/revision-improve-2026-08-29.md'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('Restaurado experience/acme.md a como estaba antes de aplicar «revision-improve-2026-08-29.md»');
    expect(h.stdout()).toContain(`Revisión desarchivada: ${REVIEW}`);
    expect(h.stderr()).toContain('1 fuente restaurada');
    expect(h.fs.file(`${SOURCES}/experience/acme.md`)?.content).toBe(antes);

    // Deshacerlo otra vez no cambia nada y se dice.
    h.reset();
    h.setNow(new Date('2026-08-31T10:00:00.000Z'));
    expect(await runCli(['improve', 'undo', 'output/revision-improve-2026-08-29.md'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain('no se ha cambiado nada');

    // Y una revisión que nunca se aplicó no tiene nada que deshacer.
    const nueva = await marcada();
    expect(await runCli(['improve', 'undo', 'output/revision-improve-2026-08-29.md'], nueva.context)).toBe(EXIT_DATA_ERROR);
    expect(nueva.stderr()).toContain('no hay nada que deshacer');
  });
});
