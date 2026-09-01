import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultAssets } from '../../src/shared/assets';
import { serializeProfile } from '../../src/artifact';
import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK, REMOTE_CANCELLED, parseMaxTags, runCli, type CliContext, type LlmProviderResult } from '../../src/cli';
import { MemoryLlmCache, type LlmHealth, type LlmProvider, type LlmRequest } from '../../src/llm';
import { NodeFileSystem, defaultSourceParsers, loadDataset } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import { renderTypstCv } from '../../src/renderers/typst';
import { installTypst, typstStatus } from '../../src/typst';
import { MemoryFileSystem, type MemoryEntry } from '../helpers/memory-file-system';

interface Harness {
  readonly context: CliContext;
  readonly fs: MemoryFileSystem;
  readonly calls: LlmRequest[];
  readonly cache: MemoryLlmCache;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

const NOW = new Date('2026-08-29T10:00:00.000Z');
let artifact = '';

async function loadArtifact(): Promise<string> {
  if (artifact === '') {
    const dataset = await loadDataset(join(__dirname, '../fixtures/dataset'), { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
    if (!dataset.ok) {
      throw new Error('dataset');
    }
    artifact = serializeProfile(dataset.profile);
  }
  return artifact;
}

const SUGGESTIONS = [
  { tag: 'php', reason: 'usa PHP' },
  { tag: 'Kubernetes', reason: 'migración a Kubernetes' },
  { tag: 'aws', reason: 'no está en el diccionario' },
  { tag: '#symfony', reason: '' },
  { tag: 'php', reason: 'duplicada' },
  { tag: 'pin', reason: 'reservada' },
];

function fakeProvider(calls: LlmRequest[], health: LlmHealth = { ok: true, version: undefined, models: ['fake'], modelAvailable: true }, kind: 'local' | 'remote' = 'local', fail = false): LlmProvider {
  return {
    id: kind === 'local' ? 'ollama' : 'openai',
    kind,
    baseUrl: kind === 'local' ? 'http://127.0.0.1:11434' : 'https://api.openai.com',
    model: 'fake',
    complete: (request) => {
      calls.push(request);
      if (fail) {
        return Promise.resolve({ ok: false, code: 'timeout', message: 'tarde' });
      }
      const json = { suggestions: SUGGESTIONS };
      return Promise.resolve({ ok: true, json, raw: JSON.stringify(json), model: 'fake-1', usage: { promptTokens: 10, completionTokens: 5 }, elapsedMs: 7 });
    },
    health: () => Promise.resolve(health),
  };
}

interface HarnessOptions {
  readonly provider?: LlmProviderResult | undefined;
  readonly extra?: Record<string, string | MemoryEntry> | undefined;
  readonly stdin?: string | undefined;
  readonly confirm?: ((question: string) => Promise<boolean>) | undefined;
  readonly artifact?: string | undefined;
}

async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const out: string[] = [];
  const err: string[] = [];
  const calls: LlmRequest[] = [];
  const cache = new MemoryLlmCache();
  const fs = new MemoryFileSystem({
    '/work/data/sources/profile.md': { kind: 'file', content: '---\nfullName: Ada\n---\n', mtimeMs: 100 },
    '/work/data/dist/profile.json': { kind: 'file', content: options.artifact ?? (await loadArtifact()), mode: 0o600, mtimeMs: 500 },
    ...(options.extra ?? {}),
  });
  const context: CliContext = {
    cwd: '/work',
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
    stdin: () => Promise.resolve(options.stdin ?? ''),
    datasetFileSystem: fs,
    artifactFileSystem: fs,
    parsers: defaultSourceParsers(),
    pdfExtractor: (bytes) => extractPdfText(bytes),
    typstRenderer: (profile, renderOptions) => renderTypstCv(profile, renderOptions),
    typstInstall: (installOptions, report) => installTypst(installOptions, report),
    typstStatus: (statusOptions) => typstStatus(statusOptions),
    llmStatus: () => Promise.reject(new Error('no usado')),
    llmProvider: () => Promise.resolve(options.provider ?? { ok: true as const, provider: fakeProvider(calls) }),
    llmCache: cache,
    assets: defaultAssets(),
    now: () => NOW,
    ...(options.confirm === undefined ? {} : { confirm: options.confirm }),
  };
  return { context, fs, calls, cache, stdout: () => out.join(''), stderr: () => err.join('') };
}

/** Artefacto con un logro sin etiquetas (la fixture los tiene todos etiquetados). */
async function artifactWithUntagged(): Promise<string> {
  const json = JSON.parse(await loadArtifact()) as { experience: Array<{ achievements: Array<Record<string, unknown>> }> };
  json.experience[0]?.achievements.push({ id: 'exp-acme-nuevo', text: 'Migré la plataforma a Kubernetes.', tags: [] });
  return JSON.stringify(json);
}

const SOURCES = '/work/data/sources';
const FIXTURE = join(__dirname, '../fixtures/dataset');
let tree: Record<string, MemoryEntry> | undefined;

/** Las fuentes de la fixture en memoria: `--apply` escribe en ellas, así que tienen que estar. */
async function sources(): Promise<Record<string, MemoryEntry>> {
  if (tree === undefined) {
    const built: Record<string, MemoryEntry> = {};
    for (const entry of await readdir(FIXTURE, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) {
        const absolute = join(entry.parentPath, entry.name);
        built[`${SOURCES}/${relative(FIXTURE, absolute)}`] = { kind: 'file', content: await readFile(absolute, 'utf8'), mtimeMs: 100 };
      }
    }
    tree = built;
  }
  return tree;
}

describe('cv suggest tags (T-4.6): diccionario cerrado, salida limpia, nunca escribe en las fuentes', () => {
  it('etiqueta un texto suelto: stdout solo con las etiquetas del diccionario; rechazos y explicación por stderr', async () => {
    const h = await harness();
    expect(await runCli(['suggest', 'tags', 'Migré la plataforma de Ada Ejemplo a Kubernetes. #devops', '--explain'], h.context)).toBe(EXIT_OK);
    // Y el mismo interruptor que en las otras dos órdenes (T-9.16).
    expect(await runCli(['suggest', 'tags', 'Migré la plataforma a Kubernetes', '--no-wait-quota'], (await harness()).context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe('#php #kubernetes #symfony\n');
    expect(h.stderr()).toContain('Saldrá 1 fragmento seudonimizado (7 palabras; sin nombre ni datos de contacto; diccionario cerrado de 7 etiquetas de 2 especialidades) hacia ollama (http://127.0.0.1:11434, local; modelo fake)\n');
    expect(h.stderr()).toContain('[1/1] texto: #php #kubernetes #symfony (1 literal · 0 por contexto · 2 inferida) · 7 ms\n');
    expect(h.stderr()).toContain('  #php · evidencia inferida · nueva · usa PHP\n  #kubernetes · evidencia literal · nueva · migración a Kubernetes\n  #symfony · evidencia inferida · nueva\n');
    expect(h.stderr()).toContain('  ✗ aws: VIOLATION_CLOSED_DICTIONARY\n  ✗ pin: VIOLATION_RESERVED_TAG\n');
    expect(h.stderr()).toContain('1 fragmento · 3 etiquetas sugeridas (3 nuevas) · 2 rechazadas · 0 fallidos · 0 desde caché\n');
    const input = JSON.parse(h.calls[0]?.messages[1]?.content ?? '{}') as { text: string; currentTags: string[]; dictionary: string[] };
    expect(input).toMatchObject({ text: 'Migré la plataforma de [NOMBRE] a Kubernetes.', currentTags: ['devops'] });
    expect(input.dictionary).toEqual(['php', 'symfony', 'kubernetes', 'kafka', 'liderazgo', 'gestion', 'agile']);
    expect((h.calls[0]?.schema as { properties: { suggestions: { items: { properties: { tag: { enum: string[] } } } } } }).properties.suggestions.items.properties.tag.enum).toEqual(input.dictionary);
    expect(h.fs.file('/work/data/sources/profile.md')?.content).toBe('---\nfullName: Ada\n---\n');
    expect(h.cache.size).toBe(1);
  });

  it('lee el texto de stdin con «-», admite -s para acotar el diccionario y --max-tags', async () => {
    const h = await harness({ stdin: 'Coordiné a 6 personas con Scrum.\n' });
    expect(await runCli(['suggest', 'tags', '-', '-s', 'engineering-manager', '--max-tags', '1'], h.context)).toBe(EXIT_OK);
    // El doble devuelve etiquetas de backend: ninguna está en el diccionario acotado.
    expect(h.stdout()).toBe('');
    expect(h.stderr()).toContain('diccionario cerrado de 3 etiquetas de 1 especialidad');
    expect(h.stderr()).toContain('texto: ninguna etiqueta del diccionario encaja\n');
    expect(h.stderr()).toContain('  ✗ php: VIOLATION_CLOSED_DICTIONARY\n');
    const input = JSON.parse(h.calls[0]?.messages[1]?.content ?? '{}') as { maxTags: number; dictionary: string[]; text: string };
    expect(input).toMatchObject({ maxTags: 1, dictionary: ['liderazgo', 'gestion', 'agile'], text: 'Coordiné a 6 personas con Scrum.' });
    expect(parseMaxTags('10')).toBe(10);
    expect(() => parseMaxTags('11')).toThrow('debe ser un entero entre 1 y 10');
    expect(() => parseMaxTags('x')).toThrow('debe ser un entero');
  });

  it('etiqueta logros del perfil: --only con su id por delante, --untagged solo los que no tienen, --max-items avisa', async () => {
    const h = await harness({ artifact: await artifactWithUntagged() });
    expect(await runCli(['suggest', 'tags', '--only', 'exp-acme-1,exp-acme-nuevo', '--max-tags', '2', '--redact-companies'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe('exp-acme-1: #php #kubernetes\nexp-acme-nuevo: #php #kubernetes\n');
    expect(h.stderr()).toContain('Saldrán 2 fragmentos seudonimizados (');
    expect(h.stderr()).toContain(', sin empresas; diccionario');
    expect(h.stderr()).toContain('[1/2] exp-acme-1: #php #kubernetes (0 literal · 2 por contexto · 0 inferida) · 7 ms\n');
    expect(h.stderr()).toContain('  ✗ symfony: VIOLATION_MAX_TAGS\n');
    const explained = await harness();
    expect(await runCli(['suggest', 'tags', '--only', 'exp-acme-1', '--explain'], explained.context)).toBe(EXIT_OK);
    expect(explained.stderr()).toContain('  #php · evidencia contexto · ya presente · usa PHP\n  #kubernetes · evidencia contexto · nueva · migración a Kubernetes\n  #symfony · evidencia contexto · nueva\n');
    expect(h.stderr()).toContain('2 fragmentos · 4 etiquetas sugeridas (3 nuevas) · 6 rechazadas · 0 fallidos · 0 desde caché\n');

    const untagged = await harness({ artifact: await artifactWithUntagged() });
    expect(await runCli(['suggest', 'tags', '--untagged'], untagged.context)).toBe(EXIT_OK);
    expect(untagged.stdout()).toBe('exp-acme-nuevo: #php #kubernetes #symfony\n');
    expect(untagged.calls).toHaveLength(1);

    const capped = await harness();
    expect(await runCli(['suggest', 'tags', '--max-items', '2'], capped.context)).toBe(EXIT_OK);
    expect(capped.stderr()).toContain('Aviso: 6 logros superan el máximo por ejecución (2); se procesan los 2 primeros');
    expect(capped.calls).toHaveLength(2);
    expect(capped.stdout().split('\n').filter((line) => line !== '')).toHaveLength(2);
  });

  it('explica los errores de datos: sin texto, texto demasiado largo, ids desconocidos, todo etiquetado, especialidad o diccionario inexistentes', async () => {
    const empty = await harness();
    expect(await runCli(['suggest', 'tags', '   '], empty.context)).toBe(EXIT_DATA_ERROR);
    expect(empty.stderr()).toContain('No hay texto que etiquetar');
    const long = await harness();
    expect(await runCli(['suggest', 'tags', 'x'.repeat(601)], long.context)).toBe(EXIT_DATA_ERROR);
    expect(long.stderr()).toBe('El texto supera los 600 caracteres (601): etiqueta un logro cada vez\n');
    const unknown = await harness();
    expect(await runCli(['suggest', 'tags', '--only', 'nope,exp-acme-1,zzz'], unknown.context)).toBe(EXIT_DATA_ERROR);
    expect(unknown.stderr()).toBe('No existen los logros «nope», «zzz»\n');
    const one = await harness();
    expect(await runCli(['suggest', 'tags', '--only', 'nope'], one.context)).toBe(EXIT_DATA_ERROR);
    expect(one.stderr()).toBe('No existe el logro «nope»\n');
    const tagged = await harness();
    expect(await runCli(['suggest', 'tags', '--untagged'], tagged.context)).toBe(EXIT_DATA_ERROR);
    expect(tagged.stderr()).toContain('Todos los logros considerados tienen etiquetas');
    const specialty = await harness();
    expect(await runCli(['suggest', 'tags', 'texto', '-s', 'frontend'], specialty.context)).toBe(EXIT_DATA_ERROR);
    expect(specialty.stderr()).toBe('No existe la especialidad «frontend» (definidas: backend, engineering-manager)\n');
    const json = JSON.parse(await loadArtifact()) as { specialties: unknown[]; experience: Array<{ achievements: unknown[] }>; projects: Array<{ achievements: unknown[] }>; achievements: unknown[] };
    json.specialties = [];
    const noDictionary = await harness({ artifact: JSON.stringify(json) });
    expect(await runCli(['suggest', 'tags', 'texto'], noDictionary.context)).toBe(EXIT_DATA_ERROR);
    expect(noDictionary.stderr()).toContain('El perfil no define especialidades');
    json.specialties = [{ id: 'x', title: 'X', tags: ['php'] }];
    for (const container of [...json.experience, ...json.projects]) container.achievements = [];
    json.achievements = [];
    const noItems = await harness({ artifact: JSON.stringify(json) });
    expect(await runCli(['suggest', 'tags'], noItems.context)).toBe(EXIT_DATA_ERROR);
    expect(noItems.stderr()).toBe('No hay logros que etiquetar\n');
    const missing = await harness({ extra: { '/work/data/dist/profile.json': { kind: 'file', content: '{"nope": true}', mode: 0o600, mtimeMs: 500 } } });
    expect(await runCli(['suggest', 'tags', 'texto'], missing.context)).toBe(EXIT_DATA_ERROR);
  });

  it('--show-prompt, --show-payload, --dry-run, --build, --no-cache y la segunda ejecución desde caché', async () => {
    const prompt = await harness();
    expect(await runCli(['suggest', 'tags', '--show-prompt'], prompt.context)).toBe(EXIT_OK);
    expect(prompt.stdout()).toContain('Diccionario cerrado');
    const dry = await harness();
    expect(await runCli(['suggest', 'tags', '--only', 'exp-acme-1', '--show-payload', '--dry-run'], dry.context)).toBe(EXIT_OK);
    expect(JSON.parse(dry.stdout())).toMatchObject([{ id: 'exp-acme-1', currentTags: ['performance', 'php'] }]);
    expect(dry.stderr()).toContain('Ejecución en seco: no se ha enviado nada\n');
    expect(dry.calls).toHaveLength(0);
    const broken = await harness({ extra: { '/work/data/sources/profile.md': { kind: 'file', content: '---\nfullName: Ada\nemail: nope\n---\n', mtimeMs: 100 } } });
    expect(await runCli(['suggest', 'tags', 'texto', '--build'], broken.context)).toBe(EXIT_DATA_ERROR);
    expect(broken.stderr()).toContain('email');
    const built = await harness({ extra: { '/work/data/sources/skills.csv': { kind: 'file', content: 'name\nPHP\n', mtimeMs: 100 } } });
    await built.fs.remove('/work/data/dist/profile.json');
    expect(await runCli(['suggest', 'tags', 'Migré a Kubernetes', '--build'], built.context)).toBe(EXIT_DATA_ERROR);
    expect(built.stderr()).toContain('El perfil no define especialidades');
    const first = await harness();
    expect(await runCli(['suggest', 'tags', '--only', 'exp-acme-1'], first.context)).toBe(EXIT_OK);
    const again = await harness();
    for (const [key] of (first.cache as unknown as { entries: Map<string, unknown> }).entries) {
      const entry = await first.cache.get(key);
      if (entry !== undefined) await again.cache.set(key, entry);
    }
    expect(await runCli(['suggest', 'tags', '--only', 'exp-acme-1'], again.context)).toBe(EXIT_OK);
    expect(again.calls).toHaveLength(0);
    expect(again.stderr()).toContain('· desde caché\n');
    expect(again.stderr()).toContain('1 fragmento · 3 etiquetas sugeridas (2 nuevas) · 2 rechazadas · 0 fallidos · 1 desde caché\n');
    const fresh = await harness();
    expect(await runCli(['suggest', 'tags', '--only', 'exp-acme-1', '--no-cache'], fresh.context)).toBe(EXIT_OK);
    expect(fresh.cache.size).toBe(0);
  });

  it('proveedor: sin proveedor, caído, sin el modelo, fallo total (2) y remoto con consentimiento de coste', async () => {
    const none = await harness({ provider: { ok: false, message: 'sin proveedor' } });
    expect(await runCli(['suggest', 'tags', 'texto'], none.context)).toBe(EXIT_FAILURE);
    expect(none.stderr()).toContain('sin proveedor\n');
    const down = await harness({ provider: { ok: true, provider: fakeProvider([], { ok: false, code: 'unreachable', message: 'ECONNREFUSED' }) } });
    expect(await runCli(['suggest', 'tags', 'texto'], down.context)).toBe(EXIT_FAILURE);
    expect(down.stderr()).toContain('ECONNREFUSED\nComprueba el proveedor con «cv llm status»\n');
    const noModel = await harness({ provider: { ok: true, provider: fakeProvider([], { ok: true, version: undefined, models: ['otro'], modelAvailable: false }) } });
    expect(await runCli(['suggest', 'tags', 'texto'], noModel.context)).toBe(EXIT_FAILURE);
    expect(noModel.stderr()).toContain('El modelo «fake» no está disponible en http://127.0.0.1:11434; comprueba «cv llm status»\n');
    const failing = await harness({ provider: { ok: true, provider: fakeProvider([], undefined, 'local', true) } });
    expect(await runCli(['suggest', 'tags', 'texto'], failing.context)).toBe(EXIT_FAILURE);
    expect(failing.stdout()).toBe('');
    expect(failing.stderr()).toContain('[1/1] texto: fallo (timeout)\n');
    expect(failing.stderr()).toContain('1 fragmento · 0 etiquetas sugeridas (0 nuevas) · 0 rechazadas · 1 fallidos · 0 desde caché\n');

    const remoteCalls: LlmRequest[] = [];
    const declined = await harness({ provider: { ok: true, provider: fakeProvider(remoteCalls, undefined, 'remote') }, confirm: () => Promise.resolve(false) });
    expect(await runCli(['suggest', 'tags', 'texto', '--provider', 'openai'], declined.context)).toBe(EXIT_FAILURE);
    expect(declined.stderr()).toContain('Aviso de coste: 1 petición a openai (https://api.openai.com; modelo fake)');
    expect(declined.stderr()).toContain(`${REMOTE_CANCELLED}\n`);
    expect(remoteCalls).toHaveLength(0);
    const accepted = await harness({ provider: { ok: true, provider: fakeProvider(remoteCalls, undefined, 'remote') } });
    expect(await runCli(['suggest', 'tags', 'Migré a Kubernetes', '--provider', 'openai', '--yes'], accepted.context)).toBe(EXIT_OK);
    expect(accepted.stderr()).toContain('Confirmado con --yes\n');
    expect(accepted.stdout()).toBe('#php #kubernetes #symfony\n');
    expect(remoteCalls).toHaveLength(1);
  });
});

describe('cv suggest tags --apply (T-9.15): de la sugerencia a la fuente, solo lo que apruebas', () => {
  it('escribe solo las etiquetas nuevas, al final de la viñeta, con copia .bak y sin tocar nada más', async () => {
    const h = await harness({ extra: await sources() });
    const antes = h.fs.file(`${SOURCES}/experience/acme.md`)?.content ?? '';
    expect(await runCli(['suggest', 'tags', '--only', 'exp-acme-1', '--apply', '--yes'], h.context)).toBe(EXIT_OK);
    const despues = h.fs.file(`${SOURCES}/experience/acme.md`)?.content ?? '';
    // #php ya la tenía: entran las dos nuevas, detrás de las que ya había.
    expect(despues).toContain('#performance #php #kubernetes #symfony\n');
    expect(h.stderr()).toContain('  exp-acme-1: #kubernetes #symfony\n');
    expect(h.stderr()).toContain('(copia .bak al lado) · recompila con «cv build»\n');
    expect(h.fs.file(`${SOURCES}/experience/acme.md.bak`)?.content).toBe(antes);
    expect(despues.split('\n')).toHaveLength(antes.split('\n').length);
    // Y a la segunda, aunque el artefacto siga sin recompilar, la fuente manda: ni se reescribe ni deja copia.
    const otra = await harness({ extra: { ...(await sources()), [`${SOURCES}/experience/acme.md`]: { kind: 'file', content: despues, mtimeMs: 100 } } });
    expect(await runCli(['suggest', 'tags', '--only', 'exp-acme-1', '--apply', '--yes'], otra.context)).toBe(EXIT_OK);
    expect(otra.stderr()).toContain('no se aplicó «exp-acme-1»: ya las tenía\n');
    expect(otra.fs.file(`${SOURCES}/experience/acme.md`)?.content).toBe(despues);
    expect(otra.fs.file(`${SOURCES}/experience/acme.md.bak`)).toBeUndefined();
  });

  it('con terminal pregunta logro a logro, y lo que no confirmas no se escribe', async () => {
    const preguntas: string[] = [];
    const h = await harness({ extra: await sources(), confirm: (question: string) => { preguntas.push(question); return Promise.resolve(false); } });
    const antes = h.fs.file(`${SOURCES}/experience/acme.md`)?.content ?? '';
    expect(await runCli(['suggest', 'tags', '--only', 'exp-acme-1', '--apply'], h.context)).toBe(EXIT_OK);
    expect(preguntas).toEqual(['¿Añadir #kubernetes #symfony a «exp-acme-1»?']);
    expect(h.stderr()).toContain('No se aplicó ninguna etiqueta.\n');
    expect(h.fs.file(`${SOURCES}/experience/acme.md`)?.content).toBe(antes);
  });

  it('un texto suelto no tiene fuente donde aplicarse, y se dice en vez de escribir a ciegas', async () => {
    const h = await harness({ extra: await sources() });
    expect(await runCli(['suggest', 'tags', 'Migré la plataforma a Kubernetes', '--apply', '--yes'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain('No se aplicó ninguna etiqueta.\n');
  });

  it('si el artefacto va por delante de las fuentes, ese logro no se escribe y se dice por qué', async () => {
    const h = await harness({ artifact: await artifactWithUntagged(), extra: await sources() });
    expect(await runCli(['suggest', 'tags', '--only', 'exp-acme-nuevo', '--apply', '--yes'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain('no se aplicó «exp-acme-nuevo»: no está en las fuentes (¿artefacto obsoleto? recompila con «cv build»)\n');
  });

  it('si la fuente no se puede escribir, la orden termina en error y lo dice', async () => {
    const h = await harness({ extra: await sources() });
    const readOnly = new Proxy(h.fs, { get: (target, key) => (key === 'writeFile' ? () => Promise.reject(new Error('solo lectura')) : Reflect.get(target, key, target)) });
    expect(await runCli(['suggest', 'tags', '--only', 'exp-acme-1', '--apply', '--yes'], { ...h.context, artifactFileSystem: readOnly })).toBe(EXIT_FAILURE);
    expect(h.stderr()).toContain('No se pudo escribir experience/acme.md: solo lectura');
  });

  it('unas fuentes que no validan detienen la escritura', async () => {
    const roto = { ...(await sources()), [`${SOURCES}/experience/acme.md`]: { kind: 'file' as const, content: '---\nrole: sin empresa\n---\n', mtimeMs: 100 } };
    const h = await harness({ extra: roto });
    expect(await runCli(['suggest', 'tags', '--only', 'exp-acme-1', '--apply', '--yes'], h.context)).toBe(EXIT_FAILURE);
    expect(h.stderr()).toContain('compruébalo con «cv validate»');
  });
});
