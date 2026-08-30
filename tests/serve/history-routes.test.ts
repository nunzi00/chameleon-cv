import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer, type ServerHandle } from '../../src/serve';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const TOKEN = 'token-de-pruebas-fijo';
const NOW = new Date('2026-08-30T18:00:00.000Z');

describe('cv serve: histórico de versiones de las fuentes (T-8.10)', () => {
  let server: ServerHandle;
  let fs: MemoryFileSystem;
  const call = (path: string, init: RequestInit = {}): Promise<Response> =>
    fetch(`${server.url}api/v1${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const post = (path: string, body: unknown): Promise<Response> => call(path, { method: 'POST', body: JSON.stringify(body) });

  beforeAll(async () => {
    fs = new MemoryFileSystem({
      '/work/data/sources/profile.md': '---\nfullName: Ada\n---\n',
      '/work/data/sources/experience/acme.md': 'v2',
      '/work/output/historial-fuentes/index.json': JSON.stringify({
        version: 1,
        entries: [{ id: '20260830T100000000Z-r', at: '2026-08-30T10:00:00.000Z', action: 'apply', origin: 'r.md', root: '/work/data/sources', files: [{ path: 'experience/acme.md', sha256Before: 'a', sha256After: 'b', ids: ['exp-1'] }] }],
      }),
      '/work/output/historial-fuentes/20260830T100000000Z-r/experience/acme.md': 'v1',
    });
    const context = appContext(fs, { now: () => NOW });
    server = await startServer({ context, host: '127.0.0.1', port: 0, data: 'data/sources', profile: 'data/dist/profile.json', version: '9.9.9', apiOnly: true, allowedHosts: [], token: TOKEN, allowRemote: false });
  });

  afterAll(async () => {
    await server.close();
  });

  it('GET /history lista las entradas; POST /history/version lee una versión (id o latest); los errores son 422', async () => {
    const list = await call('/history');
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ entries: [{ id: '20260830T100000000Z-r', files: [{ path: 'experience/acme.md' }] }] });
    const version = await post('/history/version', { entry: 'latest', path: 'experience/acme.md' });
    expect(version.status).toBe(200);
    expect(await version.json()).toMatchObject({ entry: { id: '20260830T100000000Z-r' }, file: { ids: ['exp-1'] }, content: 'v1' });
    const missing = await post('/history/version', { entry: 'no', path: 'experience/acme.md' });
    expect(missing.status).toBe(422);
    expect((await post('/history/version', { entry: '' })).status).toBeGreaterThanOrEqual(400);
  });

  it('POST /history/restore escribe la versión guardada y deja la actual en una entrada nueva', async () => {
    const restored = await post('/history/restore', { entry: 'latest', path: 'experience/acme.md' });
    expect(restored.status).toBe(200);
    const body = (await restored.json()) as { path: string; entry: { action: string; origin: string } };
    expect(body.path).toBe('/work/data/sources/experience/acme.md');
    expect(body.entry).toMatchObject({ action: 'restore', origin: '20260830T100000000Z-r' });
    expect(fs.file('/work/data/sources/experience/acme.md')?.content).toBe('v1');
    const list = (await (await call('/history')).json()) as { entries: { action: string }[] };
    expect(list.entries.map((entry) => entry.action)).toEqual(['restore', 'apply']);
    expect((await post('/history/restore', { entry: 'nada', path: 'x.md' })).status).toBe(422);
    expect((await post('/history/restore', {})).status).toBeGreaterThanOrEqual(400);
  });
});
