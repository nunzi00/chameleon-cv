/**
 * `cv serve`: los duplicados de las propias fuentes (T-9.20). Verlos con el fichero de cada entrada, ensayar la
 * resolución sin tocar nada y resolverla de verdad —dejando la entrada elegida completa, la otra borrada y una
 * entrada en el histórico que lo deshace—.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer, type ServerHandle } from '../../src/serve';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const TOKEN = 'token-de-pruebas-fijo';

const PROFILE = ['---', 'schemaVersion: 1', 'locale: es-ES', 'fullName: Ada Ejemplo', 'links: []', '---', ''].join('\n');

function education(institution: string, degree: string, start?: string, end?: string): string {
  return ['---', `institution: ${institution}`, `degree: ${degree}`, ...(start === undefined ? [] : [`start: ${start}`]), ...(end === undefined ? [] : [`end: ${end}`]), '---', ''].join('\n');
}

describe('cv serve: rutas de duplicados', () => {
  let handle: ServerHandle;
  let fs: MemoryFileSystem;

  const api = (path: string, init: RequestInit = {}): Promise<Response> => fetch(`${handle.url}api/v1/${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) } });
  const resolveBody = (extra: Record<string, unknown> = {}): RequestInit => ({
    method: 'POST',
    body: JSON.stringify({ keep: 'edu-ciclo', absorb: ['edu-piringalla'], ...extra }),
    headers: { 'Content-Type': 'application/json' },
  });

  beforeAll(async () => {
    fs = new MemoryFileSystem({
      '/work/data/sources/profile.md': PROFILE,
      '/work/data/sources/education/ciclo.md': education('Centro pendiente', 'Ciclo Superior Administrador de Sistemas', '2008', '2010'),
      '/work/data/sources/education/piringalla.md': education('I.E.S Piringalla', 'cs administrador de sistemas informaticos'),
    });
    handle = await startServer({
      host: '127.0.0.1',
      port: 0,
      data: 'data/sources',
      profile: 'data/dist/profile.json',
      version: '9.9.9',
      apiOnly: true,
      allowedHosts: [],
      token: TOKEN,
      allowRemote: false,
      context: appContext(fs),
    });
  });

  afterAll(async () => {
    await handle.close();
  });

  it('GET /duplicates agrupa lo repetido y dice en qué fichero vive cada entrada', async () => {
    const response = await api('duplicates');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { groups: ReadonlyArray<{ section: string; members: ReadonlyArray<{ entry: { id: string } }> }>; compared: number; files: Record<string, string> };
    expect(body.compared).toBe(2);
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]?.section).toBe('education');
    expect(body.files['edu-piringalla']).toBe('education/piringalla.md');
  });

  it('POST /duplicates/resolve con dryRun enseña el plan y no toca nada', async () => {
    const response = await api('duplicates/resolve', resolveBody({ dryRun: true }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { dryRun: boolean; taken: ReadonlyArray<{ field: string }>; conflicts: readonly unknown[]; historyId?: string };
    expect(body.dryRun).toBe(true);
    expect(body.taken.map((field) => field.field)).toEqual(['institution']);
    expect(body.conflicts).toHaveLength(1);
    expect(body.historyId).toBeUndefined();
    expect(fs.file('/work/data/sources/education/piringalla.md')).toBeDefined();
  });

  it('un cuerpo que no cumple el esquema se para antes del caso de uso, y un id inventado no borra nada', async () => {
    expect((await api('duplicates/resolve', { method: 'POST', body: JSON.stringify({ keep: 'edu-ciclo', absorb: [] }), headers: { 'Content-Type': 'application/json' } })).status).toBe(400);
    expect((await api('duplicates/resolve', resolveBody({ absorb: ['edu-inventada'] }))).status).toBe(404);
    expect(fs.file('/work/data/sources/education/piringalla.md')).toBeDefined();
  });

  it('unas fuentes que no cargan se explican en las dos rutas, sin tocar nada', async () => {
    const roto = new MemoryFileSystem({ '/work/data/sources/profile.md': '---\nschemaVersion: 1\n---\n' });
    const otro = await startServer({
      host: '127.0.0.1',
      port: 0,
      data: 'data/sources',
      profile: 'data/dist/profile.json',
      version: '9.9.9',
      apiOnly: true,
      allowedHosts: [],
      token: TOKEN,
      allowRemote: false,
      context: appContext(roto),
    });
    try {
      expect((await fetch(`${otro.url}api/v1/duplicates`, { headers: { Authorization: `Bearer ${TOKEN}` } })).status).toBe(422);
      const resolver = await fetch(`${otro.url}api/v1/duplicates/resolve`, {
        method: 'POST',
        body: JSON.stringify({ keep: 'edu-a', absorb: ['edu-b'] }),
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      });
      expect(resolver.status).toBe(422);
    } finally {
      await otro.close();
    }
  });

  it('resuelve de verdad: la elegida queda completa, la otra se borra y el histórico lo deshace', async () => {
    const response = await api('duplicates/resolve', resolveBody());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { historyId: string; keep: { path: string }; absorbed: ReadonlyArray<{ path: string }> };
    expect(body.keep.path).toBe('education/ciclo.md');
    expect(body.absorbed.map((entry) => entry.path)).toEqual(['education/piringalla.md']);
    expect(fs.file('/work/data/sources/education/ciclo.md')?.content).toContain('institution: I.E.S Piringalla');
    expect(fs.file('/work/data/sources/education/piringalla.md')).toBeUndefined();

    const restored = await api('history/restore', { method: 'POST', body: JSON.stringify({ entry: body.historyId, path: 'education/piringalla.md' }), headers: { 'Content-Type': 'application/json' } });
    expect(restored.status).toBe(200);
    expect(fs.file('/work/data/sources/education/piringalla.md')?.content).toContain('I.E.S Piringalla');
  });
});
