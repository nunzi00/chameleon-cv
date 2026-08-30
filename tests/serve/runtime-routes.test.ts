import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LOCAL_MODELS, type LlmRuntime, type RuntimeResult, type RuntimeState, type RuntimeUpOptions } from '../../src/llm';
import { startServer, type ServerHandle } from '../../src/serve';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const TOKEN = 'token-de-pruebas-fijo';

const STOPPED: RuntimeState = {
  runner: 'native',
  managed: false,
  running: false,
  model: { name: 'qwen2.5:7b-instruct', present: false },
  log: '/h/.cache/chameleon-cv/ollama/serve.log',
  disabled: undefined,
  detail: 'Ollama parado · runner native disponible',
};
const RUNNING: RuntimeState = { ...STOPPED, managed: true, running: true, model: { name: 'qwen2.5:7b-instruct', present: true }, detail: 'Ollama en marcha (native, lo arrancó cv) · modelo «qwen2.5:7b-instruct» presente' };

/** Doble del runtime: `up` fracasa cuando se pide el modelo «falla», `down` se niega con «ajeno» en el entorno. */
let foreign = false;
const ups: RuntimeUpOptions[] = [];
const runtime: LlmRuntime = {
  status: async () => STOPPED,
  up: async (options = {}) => {
    ups.push(options);
    options.progress?.('descargando el modelo…');
    if (options.model === 'falla') {
      return { ok: false, code: 'pull-failed', message: 'la descarga falló', lines: ['descargando el modelo…'] } satisfies RuntimeResult;
    }
    if (options.model === 'Inválido') {
      return { ok: false, code: 'invalid-model', message: 'nombre de modelo inválido', lines: [] } satisfies RuntimeResult;
    }
    return { ok: true, state: RUNNING, lines: ['descargando el modelo…', 'modelo disponible'] };
  },
  models: async () => ({
    catalogue: LOCAL_MODELS.map((entry) => ({ ...entry, present: entry.id === 'qwen2.5:7b-instruct', sizeBytes: undefined, configured: entry.id === 'qwen2.5:7b-instruct' })),
    others: [],
    running: false,
    disabled: undefined,
  }),
  down: async () => (foreign ? { ok: false, code: 'not-managed', message: 'Ollama está en marcha pero no lo arrancó cv', lines: [] } : { ok: true, state: STOPPED, lines: ['Ollama detenido (native)'] }),
};

describe('cv serve: GET/POST /llm/runtime (T-8.8)', () => {
  let server: ServerHandle;
  let bare: ServerHandle;
  const call = (handle: ServerHandle, path: string, init: RequestInit = {}): Promise<Response> =>
    fetch(`${handle.url}api/v1${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const post = (handle: ServerHandle, body: unknown): Promise<Response> => call(handle, '/llm/runtime', { method: 'POST', body: JSON.stringify(body) });

  beforeAll(async () => {
    const fs = new MemoryFileSystem({ '/work/data/sources/profile.md': '---\nfullName: Ada\n---\n' });
    const options = { host: '127.0.0.1', port: 0, data: 'data/sources', profile: 'data/dist/profile.json', version: '9.9.9', apiOnly: true, allowedHosts: [], token: TOKEN, allowRemote: false };
    server = await startServer({ ...options, context: appContext(fs, { llmRuntime: runtime }) });
    bare = await startServer({ ...options, context: appContext(fs) });
  });

  afterAll(async () => {
    await server.close();
    await bare.close();
  });

  async function finished(id: string): Promise<{ status: string; result: unknown; error: { code: string; message: string } | undefined; lines: string[] }> {
    for (let i = 0; i < 100; i += 1) {
      const response = await call(server, `/jobs/${id}`);
      const { job } = (await response.json()) as { job: { status: string; result: unknown; error: { code: string; message: string } | undefined; lines: string[] } };
      if (job.status === 'done' || job.status === 'failed') {
        return job;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('el trabajo no terminó');
  }

  it('GET devuelve el estado del runtime; sin runtime en el contexto, 503', async () => {
    const response = await call(server, '/llm/runtime');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ runtime: STOPPED });
    const missing = await call(bare, '/llm/runtime');
    expect(missing.status).toBe(503);
    expect(await missing.json()).toMatchObject({ error: { code: 'environment' } });
  });

  it('GET /llm/models devuelve el catálogo con lo descargado (T-8.13); sin runtime, 503; POST up acepta source', async () => {
    const response = await call(server, '/llm/models');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { catalogue: { id: string; present: boolean; configured: boolean; mirror: string | undefined }[]; others: unknown[]; running: boolean; disabled: undefined };
    expect(body.running).toBe(false);
    expect(body.catalogue.map((entry) => [entry.id, entry.present, entry.configured])).toEqual([
      ['qwen3:8b', false, false],
      ['qwen2.5:7b-instruct', true, true],
      ['deepseek-r1:8b', false, false],
      ['gpt-oss:20b', false, false],
      ['qwen3:4b', false, false],
    ]);
    expect(body.catalogue[0]?.mirror).toBe('hf.co/unsloth/Qwen3-8B-GGUF:Q4_K_M');
    const missing = await call(bare, '/llm/models');
    expect(missing.status).toBe(503);
    const up = await post(server, { action: 'up', model: 'qwen3:8b', source: 'huggingface' });
    expect(up.status).toBe(202);
    await finished(((await up.json()) as { job: { id: string } }).job.id);
    expect(ups.at(-1)).toMatchObject({ model: 'qwen3:8b', source: 'huggingface' });
    const bad = await post(server, { action: 'up', source: 'github' });
    expect(bad.status).toBe(400);
  });

  it('POST up crea el trabajo ollama-up (202 con Location) que recoge el progreso y el estado final', async () => {
    const response = await post(server, { action: 'up', model: 'llama3:8b', runner: 'docker', pull: false });
    expect(response.status).toBe(202);
    const body = (await response.json()) as { job: { id: string; kind: string }; sending: { destination: string }; warnings: unknown[] };
    expect(body.job.kind).toBe('ollama-up');
    expect(body.sending.destination).toContain('registro público de Ollama');
    expect(response.headers.get('location')).toBe(`/api/v1/jobs/${body.job.id}`);
    const job = await finished(body.job.id);
    expect(job.status).toBe('done');
    expect(job.lines).toEqual(['descargando el modelo…']);
    expect(job.result).toEqual({ runtime: RUNNING, lines: ['descargando el modelo…', 'modelo disponible'] });
    expect(ups.at(-1)).toMatchObject({ model: 'llama3:8b', runner: 'docker', pull: false });
  });

  it('POST up con un fallo del runtime deja el trabajo fallido con el código del servidor', async () => {
    const response = await post(server, { action: 'up', model: 'falla' });
    const body = (await response.json()) as { job: { id: string } };
    const job = await finished(body.job.id);
    expect(job.status).toBe('failed');
    expect(job.error).toMatchObject({ code: 'environment', message: 'la descarga falló' });
    const invalid = (await (await post(server, { action: 'up', model: 'Inválido' })).json()) as { job: { id: string } };
    expect((await finished(invalid.job.id)).error).toMatchObject({ code: 'invalid-data', message: 'nombre de modelo inválido' });
  });

  it('POST down devuelve el estado y lo hecho; un Ollama ajeno responde 409; sin runtime, 503; cuerpo inválido, error de validación', async () => {
    const ok = await post(server, { action: 'down' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ runtime: STOPPED, lines: ['Ollama detenido (native)'] });
    foreign = true;
    const refused = await post(server, { action: 'down' });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: 'conflict', message: 'Ollama está en marcha pero no lo arrancó cv' } });
    foreign = false;
    expect((await post(bare, { action: 'down' })).status).toBe(503);
    expect((await post(server, { action: 'restart' })).status).toBeGreaterThanOrEqual(400);
  });
});
