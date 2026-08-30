import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadLlmSettings } from '../../src/app/settings';
import { QuotaLedger, llmStatus, type JsonHttp, type LlmStatusOptions } from '../../src/llm';
import { startServer, type ServerHandle } from '../../src/serve';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const TOKEN = 'token-de-pruebas-fijo';
const CONFIG = '# proyecto\n[theme]\nname = "classic"   # tema\n';

/** Salud local: el servidor compatible con OpenAI sirve dos modelos; `down` simula el servidor caído. */
let down = false;
const http: JsonHttp = () => Promise.resolve(down ? { ok: false, code: 'unreachable', message: 'ECONNREFUSED' } : { ok: true, status: 200, data: { data: [{ id: 'qwen' }, { id: 'otro' }], models: [{ name: 'qwen2.5:7b-instruct' }] } });
let env: Record<string, string> = {};

describe('cv serve: GET/PUT /config/llm y POST /config/llm/check', () => {
  let fs: MemoryFileSystem;
  let server: ServerHandle;
  let remoteServer: ServerHandle;
  const ledger = new QuotaLedger();
  const call = (handle: ServerHandle, path: string, init: RequestInit = {}): Promise<Response> =>
    fetch(`${handle.url}api/v1${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const put = (path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> => call(server, path, { method: 'PUT', body: JSON.stringify(body), headers });
  const post = (handle: ServerHandle, path: string, body: unknown): Promise<Response> => call(handle, path, { method: 'POST', body: JSON.stringify(body) });

  beforeAll(async () => {
    fs = new MemoryFileSystem({ '/work/cv.toml': CONFIG, '/work/data/sources/profile.md': '---\nfullName: Ada\n---\n' });
    ledger.record('groq', { 'x-ratelimit-remaining-requests': '28', 'x-ratelimit-limit-requests': '30' }, new Date('2026-08-30T12:00:00.000Z'));
    const status = async (options: LlmStatusOptions) => {
      const snapshot = await loadLlmSettings('/work', fs);
      return llmStatus({ ...options, env, http, remoteHttp: () => http, home: '/h', platform: 'linux', keysFile: '/h/keys.json', quotaLedger: ledger, settings: snapshot.settings, settingsError: snapshot.error, settingsPath: snapshot.path, settingsPresent: snapshot.present });
    };
    const context = appContext(fs, { llmStatus: status });
    const options = { context, host: '127.0.0.1', port: 0, data: 'data/sources', profile: 'data/dist/profile.json', version: '9.9.9', apiOnly: true, allowedHosts: [], token: TOKEN };
    server = await startServer({ ...options, allowRemote: false });
    remoteServer = await startServer({ ...options, allowRemote: true });
  });

  afterAll(async () => {
    await server.close();
    await remoteServer.close();
  });

  it('GET devuelve la configuración efectiva, cv.toml con su huella, los proveedores del registro sin claves y la cuota viva', async () => {
    const response = await call(server, '/config/llm');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { llm: { config: { sources: Record<string, string> }; settings: { configured: boolean; present: boolean }; providers: { id: string; plan: string; live?: { remainingRequests: number } }[]; keysFile: string }; file: { path: string; present: boolean; sha256: string }; remote: { allowed: boolean } };
    expect(body.file).toMatchObject({ path: '/work/cv.toml', present: true });
    expect(response.headers.get('etag')).toBe(`"${body.file.sha256}"`);
    expect(body.llm.settings).toMatchObject({ present: true, configured: false });
    expect(body.llm.config.sources).toEqual({ provider: 'default', baseUrl: 'default', model: 'default', think: 'default' });
    expect(body.llm.providers.map((provider) => provider.id)).toEqual(['openai', 'anthropic', 'groq']);
    expect(body.llm.providers[2]).toMatchObject({ plan: 'free', live: { remainingRequests: 28 } });
    expect(JSON.stringify(body)).not.toContain('sk-');
    expect(body.remote.allowed).toBe(false);
    await fs.remove('/work/cv.toml');
    const absent = await call(server, '/config/llm');
    expect(absent.headers.get('etag')).toBeNull();
    expect(((await absent.json()) as { file: { present: boolean } }).file.present).toBe(false);
    await fs.mkdir('/work/cv.toml');
    expect((await call(server, '/config/llm')).status).toBe(503);
    await fs.remove('/work/cv.toml');
    await fs.writeFile('/work/cv.toml', CONFIG, 0o600);
  });

  it('PUT exige If-Match, detecta conflictos, valida el cuerpo y escribe solo la tabla [llm]', async () => {
    expect((await put('/config/llm', { provider: 'ollama' })).status).toBe(428);
    expect((await put('/config/llm', { provider: 'ollama' }, { 'If-Match': '"nope"' })).status).toBe(409);
    expect((await put('/config/llm', { provider: 'ollama' }, { 'If-Match': '*' })).status).toBe(409);
    expect((await put('/config/llm', { provider: 'openai' }, { 'If-Match': '*' })).status).toBe(400);
    const current = (await (await call(server, '/config/llm')).json()) as { file: { sha256: string } };
    const written = await put('/config/llm', { provider: 'openai-compatible', model: 'qwen', models: { groq: 'openai/gpt-oss-20b' } }, { 'If-Match': `"${current.file.sha256}"` });
    expect(written.status).toBe(200);
    const body = (await written.json()) as { path: string; sha256: string; llm: unknown };
    expect(body).toMatchObject({ path: '/work/cv.toml', llm: { provider: 'openai-compatible', model: 'qwen', models: { groq: 'openai/gpt-oss-20b' } } });
    expect(written.headers.get('etag')).toBe(`"${body.sha256}"`);
    expect(fs.file('/work/cv.toml')).toMatchObject({ mode: 0o600, content: `${CONFIG}\n[llm]\nprovider = "openai-compatible"\nmodel = "qwen"\n\n[llm.models]\ngroq = "openai/gpt-oss-20b"\n` });
    const after = (await (await call(server, '/config/llm')).json()) as { llm: { config: { provider: string; model: string; sources: Record<string, string> }; settings: { configured: boolean } } };
    expect(after.llm.config).toMatchObject({ provider: 'openai-compatible', model: 'qwen', sources: { provider: 'file', baseUrl: 'default', model: 'file' } });
    expect(after.llm.settings.configured).toBe(true);
    const again = await put('/config/llm', { model: 'otro' }, { 'If-Match': `"${body.sha256}"` });
    expect(again.status).toBe(200);
    expect(fs.file('/work/cv.toml')?.content).toBe(`${CONFIG}\n[llm]\nmodel = "otro"\n`);
  });

  it('check comprueba el local por defecto, rechaza los remotos sin --allow-remote y con él explica la clave ausente o el id desconocido', async () => {
    const local = await post(server, '/config/llm/check', {});
    expect(local.status).toBe(200);
    // Tras el PUT anterior, cv.toml solo fija model = "otro": el proveedor vuelve a ser ollama (por defecto).
    expect(await local.json()).toEqual({ provider: 'ollama', kind: 'local', ok: false, models: ['qwen2.5:7b-instruct'], modelAvailable: false, message: 'el modelo configurado «otro» no está disponible' });
    const available = await post(server, '/config/llm/check', { model: 'qwen2.5:7b-instruct' });
    expect(await available.json()).toMatchObject({ ok: true, modelAvailable: true });
    const forbidden = await post(server, '/config/llm/check', { provider: 'groq' });
    expect(forbidden.status).toBe(403);
    expect(((await forbidden.json()) as { error: { code: string } }).error.code).toBe('remote-disabled');
    const pending = await post(remoteServer, '/config/llm/check', { provider: 'groq' });
    expect(pending.status).toBe(200);
    expect(await pending.json()).toMatchObject({ provider: 'groq', kind: 'remote', ok: false, message: 'El proveedor «groq» está registrado pero pendiente de la verificación al alta por una persona (docs/copilot-providers.md §9): no se puede seleccionar hasta entonces' });
    const noKey = await post(remoteServer, '/config/llm/check', { provider: 'openai' });
    expect(noKey.status).toBe(200);
    expect(await noKey.json()).toMatchObject({ provider: 'openai', kind: 'remote', ok: false, message: expect.stringContaining('No hay clave para «openai»') as string });
    const unknown = await post(remoteServer, '/config/llm/check', { provider: 'gemini' });
    expect(await unknown.json()).toMatchObject({ provider: 'gemini', kind: 'remote', ok: false, message: expect.stringContaining('no es un proveedor conocido') as string });
    expect((await post(server, '/config/llm/check', { provider: '' })).status).toBe(400);
    env = { CHAMELEON_OPENAI_API_KEY: 'sk' };
    const remoteMissing = await post(remoteServer, '/config/llm/check', { provider: 'openai' });
    expect(await remoteMissing.json()).toEqual({ provider: 'openai', kind: 'remote', ok: false, models: ['qwen', 'otro'], modelAvailable: false, message: 'el modelo configurado «gpt-4o-mini» no está disponible', quota: undefined });
    const remoteOk = await post(remoteServer, '/config/llm/check', { provider: 'openai', model: 'qwen' });
    expect(await remoteOk.json()).toMatchObject({ provider: 'openai', kind: 'remote', ok: true, modelAvailable: true });
    down = true;
    expect(await (await post(remoteServer, '/config/llm/check', { provider: 'openai' })).json()).toMatchObject({ provider: 'openai', kind: 'remote', ok: false, message: expect.stringContaining('ECONNREFUSED') as string });
    expect(await (await post(server, '/config/llm/check', {})).json()).toMatchObject({ provider: 'ollama', kind: 'local', ok: false, message: expect.stringContaining('ECONNREFUSED') as string });
    down = false;
    env = {};
    await fs.writeFile('/work/cv.toml', '[llm]\nprovider = "openai"\n', 0o600);
    expect(await (await post(server, '/config/llm/check', {})).json()).toMatchObject({ provider: 'local', kind: 'local', ok: false, message: expect.stringContaining('Configuración inválida') as string });
    expect(await (await post(server, '/config/llm/check', { provider: 'ollama' })).json()).toMatchObject({ provider: 'ollama', kind: 'local', ok: false });
  });
});
