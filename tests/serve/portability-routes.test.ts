import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer, type ServerHandle } from '../../src/serve';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const TOKEN = 'token-de-pruebas-fijo';
const NOW = () => new Date(2026, 7, 30, 12, 0, 0);

function sources(): MemoryFileSystem {
  return new MemoryFileSystem({
    '/work/data/sources/profile.md': '---\nfullName: Ada Ejemplo\n---\n\nResumen.\n',
    '/work/data/sources/experience/acme.md': '---\ncompany: ACME\nrole: Dev\nstart: "2021"\n---\n\n## Logros\n\n- Reduje la latencia #perf\n',
  });
}

describe('cv serve: GET /export y POST /import', () => {
  let fs: MemoryFileSystem;
  let occupied: ServerHandle;
  let fresh: ServerHandle;
  const call = (server: ServerHandle, path: string, init: RequestInit = {}): Promise<Response> =>
    fetch(`${server.url}api/v1${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const post = (server: ServerHandle, path: string, body: unknown): Promise<Response> => call(server, path, { method: 'POST', body: JSON.stringify(body) });

  beforeAll(async () => {
    fs = sources();
    const context = appContext(fs, { now: NOW });
    const options = { context, host: '127.0.0.1', port: 0, profile: 'data/dist/profile.json', version: '9.9.9', apiOnly: true, allowRemote: false, allowedHosts: [], token: TOKEN };
    occupied = await startServer({ ...options, data: 'data/sources' });
    fresh = await startServer({ ...options, data: 'data/nuevo' });
  });

  afterAll(async () => {
    await occupied.close();
    await fresh.close();
  });

  it('GET /export devuelve el perfil desde las fuentes, sin artefacto', async () => {
    const response = await call(occupied, '/export');
    expect(response.status).toBe(200);
    const profile = (await response.json()) as { personal: { fullName: string }; experience: { id: string; achievements: { tags: string[] }[] }[] };
    expect(profile.personal.fullName).toBe('Ada Ejemplo');
    expect(profile.experience[0]).toMatchObject({ id: 'exp-acme', achievements: [{ tags: ['perf'] }] });
    expect(fs.file('/work/data/dist/profile.json')).toBeUndefined();
  });

  it('POST /import: por defecto solo planifica; 409 con el destino ocupado; escribe con dryRun:false; 400 y 422 con cuerpos y perfiles inválidos', async () => {
    const conflict = await post(occupied, '/import', { profile: { personal: { fullName: 'Otra' } } });
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as { error: { code: string; message: string } }).error).toMatchObject({ code: 'conflict', message: expect.stringContaining('no está vacío') as string });

    const planned = await post(fresh, '/import', { profile: { personal: { fullName: 'Otra', email: 'o@example.com' }, skills: [{ id: 'php', name: 'PHP' }] } });
    expect(planned.status).toBe(200);
    const plan = (await planned.json()) as { root: string; dryRun: boolean; plan: { files: { path: string; bytes: number }[]; counts: unknown; warnings: string[] }; written: string[]; backup?: string };
    expect(plan).toEqual({
      root: '/work/data/nuevo',
      dryRun: true,
      plan: {
        files: [
          { path: 'profile.md', bytes: '---\nschemaVersion: 1\nfullName: Otra\nemail: o@example.com\n---\n'.length },
          { path: 'skills.csv', bytes: 'name,category,level,years,aliases,tags,id\nPHP,other,,,,,php\n'.length },
        ],
        counts: { specialties: 0, experience: 0, projects: 0, education: 0, achievements: 0, skills: 1, certifications: 0 },
        warnings: ['profile.md contendrá datos de contacto (email, teléfono); las fuentes se escriben con permisos 0600'],
      },
      written: [],
    });
    expect(fs.file('/work/data/nuevo/profile.md')).toBeUndefined();

    const written = await post(fresh, '/import', { profile: { personal: { fullName: 'Otra' } }, dryRun: false });
    expect(written.status).toBe(200);
    const writtenBody = (await written.json()) as { dryRun: boolean; written: string[]; backup?: string };
    expect(writtenBody).toMatchObject({ dryRun: false, written: ['profile.md'] });
    expect(writtenBody.backup).toBeUndefined();
    expect(fs.file('/work/data/nuevo/profile.md')).toMatchObject({ mode: 0o600, content: '---\nschemaVersion: 1\nfullName: Otra\n---\n' });

    const replaced = await post(fresh, '/import', { profile: { personal: { fullName: 'Tercera' } }, dryRun: false, replace: true });
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toMatchObject({ written: ['profile.md'], backup: '/work/data/nuevo.20260830-120000.bak' });
    expect(fs.file('/work/data/nuevo.20260830-120000.bak/profile.md')?.content).toContain('Otra');

    const badBody = await post(fresh, '/import', { profile: 'no' });
    expect(badBody.status).toBe(400);
    const invalid = await post(fresh, '/import', { profile: { personal: { fullName: '' }, experience: [{ id: 'X' }] } });
    expect(invalid.status).toBe(422);
    const body = (await invalid.json()) as { error: { code: string; lines: string[] } };
    expect(body.error.code).toBe('invalid-data');
    expect(body.error.lines.join('\n')).toMatch(/personal\.fullName: /);
    expect(body.error.lines.join('\n')).toMatch(/experience\[0\]\.id: /);
  });

  it('GET /export con fuentes rotas responde 422 con todas las líneas', async () => {
    await fs.writeFile('/work/data/nuevo/profile.md', 'roto\n', 0o600);
    const response = await call(fresh, '/export');
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string; lines: string[] } };
    expect(body.error.code).toBe('invalid-data');
    expect(body.error.lines[0]).toMatch(/^profile\.md:1: Falta el frontmatter/);
  });
});
