import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { serializeProfile } from '../../src/artifact';
import type { LlmProvider, LlmRequest, ProviderSelection } from '../../src/llm';
import type { WritableFileSystem } from '../../src/artifact/writable-file-system';
import { NodeFileSystem, defaultSourceParsers, loadDataset } from '../../src/parsers';
import { startServer, type ServerHandle } from '../../src/serve';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem, type MemoryEntry } from '../helpers/memory-file-system';

const FIXTURE = join(__dirname, '../fixtures/dataset');
const SOURCES = '/work/data/sources';
const TOKEN = 'token-de-pruebas-fijo';
const NOW = new Date('2026-08-29T10:00:00.000Z');
const FAITHFUL_SUMMARY = 'Senior Backend Engineer con 3 años de experiencia en plataformas de pago con PHP, Symfony y Kubernetes; reduje la latencia p95 del checkout un 40 %.\n\nCertificada CKA.';

interface SseEvent {
  readonly event: string;
  readonly data: { readonly status?: string; readonly result?: unknown; readonly error?: unknown; readonly line?: string; readonly lines?: string[] };
}

/** El dataset de la fixture en memoria, con su artefacto compilado. */
async function workspace(extra: Record<string, string | MemoryEntry> = {}): Promise<MemoryFileSystem> {
  const built: Record<string, MemoryEntry> = {};
  for (const entry of await readdir(FIXTURE, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const absolute = join(entry.parentPath, entry.name);
      built[`${SOURCES}/${relative(FIXTURE, absolute)}`] = { kind: 'file', content: await readFile(absolute, 'utf8'), mtimeMs: 100 };
    }
  }
  const dataset = await loadDataset(FIXTURE, { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
  if (!dataset.ok) {
    throw new Error('dataset');
  }
  return new MemoryFileSystem({ ...built, '/work/data/dist/profile.json': { kind: 'file', content: serializeProfile(dataset.profile), mode: 0o600, mtimeMs: 500 }, ...extra });
}

function answer(request: LlmRequest): unknown {
  const input = JSON.parse(request.messages[1]?.content ?? '{}') as { text?: string; corpus?: string; dictionary?: unknown };
  if (input.dictionary !== undefined) {
    return { suggestions: [{ tag: 'php', reason: 'usa PHP' }] };
  }
  const faithful = input.text === undefined ? FAITHFUL_SUMMARY : `Logré: ${input.text.replace(/\*\*/g, '')}`;
  return { proposals: [{ text: faithful, rationale: 'fiel' }] };
}

const base: LlmProvider = {
  id: 'ollama',
  kind: 'local',
  baseUrl: 'http://127.0.0.1:11434',
  model: 'fake',
  complete: (request) => {
    const json = answer(request);
    return Promise.resolve({ ok: true, json, raw: JSON.stringify(json), model: 'fake', usage: {}, elapsedMs: 3 });
  },
  health: () => Promise.resolve({ ok: true, version: undefined, models: ['fake'], modelAvailable: true }),
};
/** Espera a que lo cancelen. */
const slow: LlmProvider = { ...base, complete: (request) => new Promise((resolve) => request.signal?.addEventListener('abort', () => resolve({ ok: false, code: 'cancelled', message: 'cancelada' }))) };
const remote: LlmProvider = { ...base, id: 'openai', kind: 'remote', baseUrl: 'https://api.openai.com', model: 'gpt-x' };
const gemini: LlmProvider = { ...base, id: 'gemini', kind: 'remote', baseUrl: 'https://generativelanguage.googleapis.com', model: 'g-x' };
/** Responde el esquema de «import map»: una propuesta válida para la línea que se envía. */
const mapper: LlmProvider = { ...base, complete: () => Promise.resolve({ ok: true, json: { proposals: [{ n: 9, section: 'experiencia', reason: 'entidad con fechas' }] }, raw: '{}', model: 'fake', usage: {}, elapsedMs: 2 }) };
const sick: LlmProvider = { ...base, health: () => Promise.resolve({ ok: false, code: 'unreachable', message: 'Ollama no responde' }) };
const modelless: LlmProvider = { ...base, health: () => Promise.resolve({ ok: true, version: undefined, models: [], modelAvailable: false }) };
const otherModel: LlmProvider = { ...base, health: () => Promise.resolve({ ok: true, version: undefined, models: ['llama3'], modelAvailable: false }) };

function llmProvider(selection: ProviderSelection): Promise<{ ok: true; provider: LlmProvider } | { ok: false; message: string }> {
  const providers: Record<string, LlmProvider> = { lento: slow, remoto: remote, gemini, mapa: mapper, enfermo: sick, 'sin-modelo': modelless, 'otro-modelo': otherModel };
  if (selection.provider === 'ninguno') {
    return Promise.resolve({ ok: false, message: 'sin proveedor configurado' });
  }
  return Promise.resolve({ ok: true, provider: providers[selection.provider ?? ''] ?? base });
}

function parseSse(text: string): SseEvent[] {
  return text
    .split('\n\n')
    .filter((block) => block.startsWith('event:'))
    .map((block) => {
      const [first = '', second = ''] = block.split('\n');
      return { event: first.slice('event: '.length), data: JSON.parse(second.slice('data: '.length)) as SseEvent['data'] };
    });
}

describe('cv serve: trabajos del co-piloto y revisiones', () => {
  let fs: MemoryFileSystem;
  let server: ServerHandle;
  const api = (path: string, init: RequestInit = {}): Promise<Response> => fetch(`${server.url}api/v1${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) } });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> => api(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } });
  const events = async (id: string): Promise<SseEvent[]> => {
    const response = await api(`/jobs/${id}/events`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    return parseSse(await response.text());
  };
  let reviewName = '';

  beforeAll(async () => {
    fs = await workspace();
    server = await startServer({ context: appContext(fs, { llmProvider, now: () => NOW }), host: '127.0.0.1', port: 0, data: 'data/sources', profile: 'data/dist/profile.json', version: '9.9.9', apiOnly: true, allowRemote: false, allowedHosts: [], token: TOKEN });
  });
  afterAll(async () => {
    await server.close();
  });

  it('POST /jobs/improve encola, dice qué sale y a dónde, y los eventos siguen el trabajo hasta la revisión escrita', async () => {
    const created = await post('/jobs/improve', { cache: false, proposals: 1 });
    expect(created.status).toBe(202);
    const body = (await created.json()) as { job: { id: string; status: string; kind: string }; sending: { destination: string; items: number; words: number; ids: string[]; redactCompanies: boolean }; warnings: unknown[] };
    expect(created.headers.get('location')).toBe(`/api/v1/jobs/${body.job.id}`);
    expect(body.job.kind).toBe('improve');
    expect(['queued', 'running', 'done']).toContain(body.job.status);
    expect(body.sending).toMatchObject({ destination: 'ollama (http://127.0.0.1:11434, local; modelo fake)', redactCompanies: false });
    expect(body.sending.items).toBeGreaterThan(0);
    expect(body.sending.ids).toHaveLength(body.sending.items);
    const stream = await events(body.job.id);
    const final = stream.at(-1);
    expect(final?.event).toBe('status');
    expect(final?.data.status).toBe('done');
    const result = final?.data.result as { review: { name: string; path: string; sha256: string }; stats: { items: number; proposals: number }; cancelled: boolean };
    expect(result.review.name).toBe('revision-improve-2026-08-29.md');
    expect(result.review.path).toBe('output/revision-improve-2026-08-29.md');
    expect(result.stats.items).toBe(body.sending.items);
    expect(result.cancelled).toBe(false);
    // Las líneas de progreso llegan en directo si el SSE conecta a tiempo y, en todo caso, en el estado final.
    expect(final?.data.lines?.length ?? 0).toBeGreaterThanOrEqual(body.sending.items);
    reviewName = result.review.name;
    const listed = (await (await api('/jobs')).json()) as { jobs: Array<{ id: string; status: string }> };
    expect(listed.jobs.map((job) => job.id)).toContain(body.job.id);
    expect((await (await api(`/jobs/${body.job.id}`)).json()) as object).toMatchObject({ job: { id: body.job.id, status: 'done', lines: expect.any(Array) } });
  });

  it('las revisiones se listan, leen (ETag), editan con If-Match, aplican (plan y escritura con la versión anterior en el histórico) y eliminan', async () => {
    const list = (await (await api('/reviews')).json()) as { reviews: Array<{ name: string; task: string; items: number; marked: number; sha256: string }> };
    expect(list.reviews.map((review) => review.name)).toEqual([reviewName]);
    expect(list.reviews[0]).toMatchObject({ task: 'improve', marked: 0 });
    const read = await api(`/reviews/${reviewName}`);
    expect(read.status).toBe(200);
    const file = ((await read.json()) as { review: { text: string; sha256: string; review: { items: Array<{ id: string }> } } }).review;
    expect(read.headers.get('etag')).toBe(`"${file.sha256}"`);
    expect(file.review.items.length).toBeGreaterThan(0);

    expect((await api(`/reviews/${reviewName}`, { method: 'PUT', body: JSON.stringify({ content: 'x' }), headers: { 'Content-Type': 'application/json' } })).status).toBe(428);
    expect((await api('/reviews/otro.md', { method: 'PUT', body: JSON.stringify({ content: 'x' }), headers: { 'Content-Type': 'application/json', 'If-Match': '*' } })).status).toBe(400);
    const marked = file.text.replace('- [ ] Propuesta 1:', '- [x] Propuesta 1:');
    const saved = await api(`/reviews/${reviewName}`, { method: 'PUT', body: JSON.stringify({ content: marked }), headers: { 'Content-Type': 'application/json', 'If-Match': `"${file.sha256}"` } });
    expect(saved.status).toBe(200);
    expect((await (await api('/reviews')).json()) as object).toMatchObject({ reviews: [{ marked: 1 }] });

    const plan = await post(`/reviews/${reviewName}/apply`, {});
    expect(plan.status).toBe(200);
    const planned = (await plan.json()) as { plan: Array<{ path: string; edits: Array<{ id: string; text: string }> }>; written: unknown[]; changes: number };
    expect(planned.plan).toHaveLength(1);
    expect(planned.plan[0]?.edits[0]?.text).toMatch(/^Logré: /);
    expect(planned.written).toEqual([]);
    const before = fs.file(planned.plan[0]?.path ?? '')?.content ?? '';
    const applied = await post(`/reviews/${reviewName}/apply`, { dryRun: false });
    expect(applied.status).toBe(200);
    const outcome = (await applied.json()) as { written: Array<{ path: string; backup: string; ids: string[] }>; changes: number; deleted: boolean };
    expect(outcome.changes).toBe(1);
    expect(outcome.deleted).toBe(false);
    expect(outcome.written[0]?.backup).toMatch(/^\/work\/output\/historial-fuentes\/[^/]+\/experience\/acme\.md$/);
    expect(fs.file(outcome.written[0]?.backup ?? '')?.content).toBe(before);
    expect(fs.file(outcome.written[0]?.path ?? '')?.content).toContain('Logré: ');
    // Repetir sin cambios en la fuente: la huella ya no coincide → 422 con las líneas.
    const again = await post(`/reviews/${reviewName}/apply`, { dryRun: false });
    expect(again.status).toBe(422);
    expect((await again.json()) as object).toMatchObject({ error: { code: 'invalid-data', lines: expect.any(Array), written: [] } });

    expect((await api(`/reviews/${reviewName}`, { method: 'DELETE' })).status).toBe(200);
    expect((await api(`/reviews/${reviewName}`)).status).toBe(404);
    expect((await api(`/reviews/${reviewName}`, { method: 'DELETE' })).status).toBe(404);
    expect((await api('/reviews/otro.md')).status).toBe(400);
    expect((await api('/reviews/otro.md', { method: 'DELETE' })).status).toBe(400);
    expect((await post('/reviews/otro.md/apply', {})).status).toBe(400);
    expect((await post(`/reviews/${reviewName}/apply`, {})).status).toBe(422);
  });

  it('tras aplicar, una nueva revisión avisa de los logros que ya no coinciden con las fuentes; output elige el nombre y la oferta afina la selección', async () => {
    const improve = (await (await post('/jobs/improve', { cache: false, output: 'revision-mia.md' })).json()) as { job: { id: string } };
    const stream = await events(improve.job.id);
    expect(stream.at(-1)?.data).toMatchObject({ status: 'done', result: { review: { name: 'revision-mia.md' } } });
    expect(stream.at(-1)?.data.lines?.some((line) => line.startsWith('Aviso: el logro «'))).toBe(true);
    const summarize = (await (await post('/jobs/summarize', { cache: false, output: 'revision-resumen.md', offer: { text: 'Buscamos Kubernetes y PHP' }, specialty: 'backend' })).json()) as { job: { id: string } };
    expect((await events(summarize.job.id)).at(-1)?.data).toMatchObject({ status: 'done', result: { review: { name: 'revision-resumen.md' } } });
    expect((await post('/jobs/summarize', { paragraphs: 9 })).status).toBe(400);
    const unknown = await post('/jobs/improve', { specialty: 'inexistente' });
    expect(unknown.status).toBe(422);
    expect((await unknown.json()) as object).toMatchObject({ error: { code: 'invalid-data', warnings: expect.any(Array) } });
    const otherModelResponse = await post('/jobs/improve', { provider: 'otro-modelo' });
    expect(otherModelResponse.status).toBe(503);
    expect(((await otherModelResponse.json()) as { error: { message: string } }).error.message).toContain('sirve: llama3');
    // Revisiones: cuerpo que no es JSON y huella que no coincide.
    expect((await api('/reviews/revision-mia.md', { method: 'PUT', body: 'x', headers: { 'Content-Type': 'application/json', 'If-Match': '*' } })).status).toBe(400);
    expect((await api('/reviews/revision-mia.md', { method: 'PUT', body: JSON.stringify({ content: 'x' }), headers: { 'Content-Type': 'application/json', 'If-Match': '"0000000000000000000000000000000000000000000000000000000000000000"' } })).status).toBe(409);
    expect((await api('/reviews/revision-mia.md/apply', { method: 'POST', body: 'x', headers: { 'Content-Type': 'application/json' } })).status).toBe(400);
  });

  it('DELETE /jobs/{id} cancela un trabajo en marcha: la petición en curso se aborta y los eventos terminan en «cancelled»', async () => {
    const created = (await (await post('/jobs/improve', { provider: 'lento', cache: false })).json()) as { job: { id: string; status: string } };
    expect(created.job.status).toBe('running');
    const pending = events(created.job.id);
    const queued = (await (await post('/jobs/summarize', { cache: false })).json()) as { job: { id: string; status: string } };
    expect(queued.job.status).toBe('queued');
    const cancelled = await api(`/jobs/${created.job.id}`, { method: 'DELETE' });
    expect(cancelled.status).toBe(200);
    const stream = await pending;
    expect(stream.at(-1)?.data).toMatchObject({ status: 'cancelled', result: { cancelled: true, processed: 0 } });
    const summary = await events(queued.job.id);
    expect(summary.at(-1)?.data).toMatchObject({ status: 'done', result: { review: { name: 'revision-summarize-2026-08-29.md' }, cancelled: false } });
    expect((await api('/jobs/nope')).status).toBe(404);
    expect((await api('/jobs/nope', { method: 'DELETE' })).status).toBe(404);
    expect((await api('/jobs/nope/events')).status).toBe(404);
  });

  it('POST /jobs/suggest-tags etiqueta un texto y devuelve el resultado en el trabajo, sin escribir nada', async () => {
    const created = await post('/jobs/suggest-tags', { text: 'Migré la plataforma de pagos a Kubernetes con PHP' });
    expect(created.status).toBe(202);
    const body = (await created.json()) as { job: { id: string }; sending: { items: number; scope: string } };
    expect(body.sending.items).toBe(1);
    expect(body.sending.scope).toMatch(/^diccionario cerrado de /);
    const stream = await events(body.job.id);
    expect(stream.at(-1)?.data.status).toBe('done');
    const result = stream.at(-1)?.data.result as { items: Array<{ id: string | undefined; line: string }>; cancelled: boolean };
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBeUndefined();
    expect(result.cancelled).toBe(false);
    expect((await post('/jobs/suggest-tags', { text: '' })).status).toBe(400);
  });

  it('al cerrar el servidor, un trabajo en marcha se cancela y el cierre no se queda esperando', async () => {
    const created = (await (await post('/jobs/improve', { provider: 'lento', cache: false })).json()) as { job: { id: string; status: string } };
    expect(created.job.status).toBe('running');
    // Con las cabeceras recibidas la suscripción ya existe: el cierre debe entregar el estado final antes de cortar.
    const response = await api(`/jobs/${created.job.id}/events`);
    expect(response.status).toBe(200);
    await server.close();
    expect(parseSse(await response.text()).at(-1)?.data.status).toBe('cancelled');
    server = await startServer({ context: appContext(fs, { llmProvider, now: () => NOW }), host: '127.0.0.1', port: 0, data: 'data/sources', profile: 'data/dist/profile.json', version: '9.9.9', apiOnly: true, allowRemote: false, allowedHosts: [], token: TOKEN });
  });

  it('rechaza cuerpos fuera de esquema, proveedores inexistentes o enfermos, y remotos sin --allow-remote', async () => {
    expect((await post('/jobs/improve', { proposals: 9 })).status).toBe(400);
    const none = await post('/jobs/improve', { provider: 'ninguno' });
    expect(none.status).toBe(503);
    expect((await none.json()) as object).toMatchObject({ error: { code: 'environment', message: 'sin proveedor configurado' } });
    const sickResponse = await post('/jobs/improve', { provider: 'enfermo' });
    expect(sickResponse.status).toBe(503);
    expect(((await sickResponse.json()) as { error: { message: string } }).error.message).toBe('Ollama no responde; comprueba el proveedor con «cv llm status»');
    const noModel = await post('/jobs/summarize', { provider: 'sin-modelo' });
    expect(noModel.status).toBe(503);
    expect(((await noModel.json()) as { error: { message: string } }).error.message).toContain('no sirve ningún modelo');
    const forbidden = await post('/jobs/improve', { provider: 'remoto' });
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()) as object).toMatchObject({ error: { code: 'remote-disabled', sending: { destination: 'openai (https://api.openai.com, remote; modelo gpt-x)' } } });
    expect((await post('/jobs/improve', { offer: { workspaceFile: '../fuera.txt' } })).status).toBe(400);
    expect((await post('/jobs/summarize', { offer: { workspaceFile: '../fuera.txt' } })).status).toBe(400);
  });
});

describe('cv serve: refinar un borrador con el co-piloto (T-8.18)', () => {
  let server: ServerHandle;
  let fs: MemoryFileSystem;
  const REPORT = ['# Informe del borrador importado', '', '- Origen: cv.pdf', '', '## Sin situar (revísalo a mano)', '', '- línea 9: Cruz Roja, Valencia | 2019 – 2020', ''].join('\n');
  const post = (path: string, body: unknown): Promise<Response> => fetch(`${server.url}api/v1${path}`, { method: 'POST', body: JSON.stringify(body), headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } });

  beforeAll(async () => {
    fs = await workspace({ '/work/import/mio/README.md': REPORT });
    server = await startServer({ context: appContext(fs, { llmProvider, now: () => NOW }), host: '127.0.0.1', port: 0, data: 'data/sources', profile: 'data/dist/profile.json', version: '9.9.9', apiOnly: true, allowRemote: false, allowedHosts: [], token: TOKEN });
  });
  afterAll(async () => {
    await server.close();
  });

  it('propone secciones para lo sin situar y lo deja en el README; sin borrador es 404 y el remoto sigue prohibido', async () => {
    const created = await post('/jobs/import-map', { provider: 'mapa', cache: false });
    expect(created.status).toBe(400);
    const started = await post('/jobs/import-map', { name: 'mio', provider: 'mapa', cache: false });
    expect(started.status).toBe(202);
    const body = (await started.json()) as { job: { id: string }; sending: { items: number; skipped: number } };
    expect(body.sending).toMatchObject({ items: 1, skipped: 0 });
    const response = await fetch(`${server.url}api/v1/jobs/${body.job.id}/events`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const final = parseSse(await response.text()).at(-1);
    expect(final?.data).toMatchObject({ status: 'done', result: { name: 'mio', rejected: 0, proposals: [{ n: 9, section: 'experiencia' }] } });
    expect(fs.file('/work/import/mio/README.md')?.content).toContain('- línea 9 → **experiencia**: Cruz Roja, Valencia | 2019 – 2020');

    expect((await post('/jobs/import-map', { name: 'nada' })).status).toBe(404);
    const forbidden = await post('/jobs/import-map', { name: 'mio', provider: 'remoto' });
    expect(forbidden.status).toBe(403);
    expect(((await forbidden.json()) as { error: { code: string } }).error.code).toBe('remote-disabled');
  });
});

describe('cv serve --allow-remote: consentimiento de coste en dos pasos', () => {
  let server: ServerHandle;
  const post = (path: string, body: unknown): Promise<Response> => fetch(`${server.url}api/v1${path}`, { method: 'POST', body: JSON.stringify(body), headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } });

  beforeAll(async () => {
    // Escribir en output/ falla: el trabajo terminará en «failed» con el error de la capa de casos de uso.
    const fs = await workspace({ '/work/output/revision-b.md': 'x', '/work/import/mio/README.md': ['# Informe', '', '## Sin situar (revísalo a mano)', '', '- línea 9: Cruz Roja, Valencia | 2019 – 2020', ''].join('\n') });
    const failing: WritableFileSystem = Object.assign(Object.create(fs) as WritableFileSystem, {
      writeFile: (path: string, content: string, mode: number) => (path.includes('/output/') ? Promise.reject(new Error('EROFS: solo lectura')) : fs.writeFile(path, content, mode)),
      remove: () => Promise.reject(new Error('EROFS: solo lectura')),
    });
    server = await startServer({ context: appContext(fs, { llmProvider, now: () => NOW, artifactFileSystem: failing }), host: '127.0.0.1', port: 0, data: 'data/sources', profile: 'data/dist/profile.json', version: '9.9.9', apiOnly: true, allowRemote: true, allowedHosts: [], token: TOKEN });
  });
  afterAll(async () => {
    await server.close();
  });

  it('un remoto responde 409 con la estimación; repetir con el estimateId es la confirmación (una sola vez)', async () => {
    const first = await post('/jobs/improve', { provider: 'remoto', cache: false });
    expect(first.status).toBe(409);
    const consent = (await first.json()) as { error: { code: string; estimateId: string; estimate: { requests: number }; warning: string; sending: { items: number } } };
    expect(consent.error.code).toBe('consent-required');
    expect(consent.error.estimate.requests).toBe(consent.error.sending.items);
    expect(consent.error.warning).toContain('openai');
    expect((await post('/jobs/summarize', { provider: 'remoto', consent: { estimateId: consent.error.estimateId } })).status).toBe(409);
    const second = await post('/jobs/improve', { provider: 'remoto', cache: false });
    const fresh = ((await second.json()) as { error: { estimateId: string } }).error.estimateId;
    const accepted = await post('/jobs/improve', { provider: 'remoto', cache: false, consent: { estimateId: fresh } });
    expect(accepted.status).toBe(202);
    const job = ((await accepted.json()) as { job: { id: string } }).job;
    const response = await fetch(`${server.url}api/v1/jobs/${job.id}/events`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const final = parseSse(await response.text()).at(-1);
    expect(final?.data).toMatchObject({ status: 'failed', error: { code: 'environment' } });
    expect((await post('/jobs/improve', { provider: 'remoto', consent: { estimateId: fresh } })).status).toBe(409);
    const tags = await post('/jobs/suggest-tags', { provider: 'remoto', text: 'Migré la plataforma a Kubernetes' });
    expect(tags.status).toBe(409);
    expect((await tags.json()) as object).toMatchObject({ error: { code: 'consent-required', estimate: { requests: 1 } } });
    const geminiTags = await post('/jobs/suggest-tags', { provider: 'gemini', text: 'Migré la plataforma a Kubernetes' });
    expect(geminiTags.status).toBe(409);
    const geminiBody = (await geminiTags.json()) as { error: { code: string; dataNote: string } };
    expect(geminiBody.error.code).toBe('consent-required');
    expect(geminiBody.error.dataNote).toContain('Google');
    // Refinar un borrador con un remoto (T-8.18): estima el coste, exige confirmarlo y, si la respuesta no cumple el esquema, el trabajo falla.
    const refine = await post('/jobs/import-map', { name: 'mio', provider: 'remoto' });
    expect(refine.status).toBe(409);
    const refineConsent = (await refine.json()) as { error: { estimateId: string; estimate: { requests: number }; sending: { items: number } } };
    expect(refineConsent.error.estimate.requests).toBe(1);
    expect(refineConsent.error.sending.items).toBe(1);
    const refining = await post('/jobs/import-map', { name: 'mio', provider: 'remoto', consent: { estimateId: refineConsent.error.estimateId } });
    expect(refining.status).toBe(202);
    const refineJob = ((await refining.json()) as { job: { id: string } }).job;
    const refineEvents = await fetch(`${server.url}api/v1/jobs/${refineJob.id}/events`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(parseSse(await refineEvents.text()).at(-1)?.data).toMatchObject({ status: 'failed', error: { code: 'invalid-data' } });

    const undeletable = await fetch(`${server.url}api/v1/reviews/revision-b.md`, { method: 'DELETE', headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(undeletable.status).toBe(503);
    expect((await undeletable.json()) as object).toMatchObject({ error: { code: 'environment', message: 'No se pudo eliminar la revisión «revision-b.md»: EROFS: solo lectura' } });
  });
});
