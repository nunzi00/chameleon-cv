/**
 * `cv serve`: las rutas de los borradores (T-9.19). Listarlos con sus duplicados, leer y corregir sus ficheros
 * con `If-Match` como los de `data/sources/`, y adoptar entradas —201 con lo escrito, 200 con `dryRun`, 400 si
 * el cuerpo no cumple el esquema— comprobando que un nombre manipulado no sale de `import/`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer, type ServerHandle } from '../../src/serve';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const TOKEN = 'token-de-pruebas-fijo';

const PROFILE = ['---', 'schemaVersion: 1', 'locale: es-ES', 'fullName: Ada Ejemplo', 'links: []', '---', ''].join('\n');

function experience(company: string, role: string, start: string, end?: string): string {
  return ['---', `company: ${company}`, `role: ${role}`, `start: ${start}`, ...(end === undefined ? [] : [`end: ${end}`]), '---', ''].join('\n');
}

describe('cv serve: rutas de borradores', () => {
  let handle: ServerHandle;
  let fs: MemoryFileSystem;

  const api = (path: string, init: RequestInit = {}): Promise<Response> => fetch(`${handle.url}api/v1/${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) } });

  beforeAll(async () => {
    fs = new MemoryFileSystem({
      '/work/data/sources/profile.md': PROFILE,
      '/work/data/sources/experience/life5.md': experience('Life5', 'Backend', '2022-05', '2022-12'),
      '/work/import/mio/profile.md': PROFILE,
      '/work/import/mio/README.md': '# Informe del borrador importado\n\n- Origen: CV Lucas.pdf\n',
      '/work/import/mio/experience/acme.md': experience('Acme', 'Backend Senior', '2020-01', '2021-01'),
      '/work/import/mio/experience/life5.md': experience('Life5', 'Software Developer', '2022-04'),
      '/work/import/mio.20260902-140535.bak/profile.md': PROFILE,
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

  it('GET /drafts da los borradores y los grupos de duplicados, sin las copias de --replace', async () => {
    const response = await api('drafts');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      drafts: ReadonlyArray<{ name: string; counts: { experience: number }; report: { origin?: string }; entries: readonly unknown[] }>;
      duplicates: { groups: ReadonlyArray<{ inSources: boolean; members: readonly unknown[] }>; compared: number };
    };
    expect(body.drafts.map((draft) => draft.name)).toEqual(['mio']);
    expect(body.drafts[0]?.counts.experience).toBe(2);
    expect(body.drafts[0]?.report.origin).toBe('CV Lucas.pdf');
    // El empleo de Life5 está en el borrador y en las fuentes: sale como grupo y avisa de que ya lo tienes.
    expect(body.duplicates.groups).toHaveLength(1);
    expect(body.duplicates.groups[0]?.inSources).toBe(true);
  });

  it('GET /drafts/{name}/files lista los ficheros y GET …/files/{ruta} devuelve el contenido con ETag', async () => {
    const listed = await api('drafts/mio/files');
    expect(listed.status).toBe(200);
    const entries = ((await listed.json()) as { entries: ReadonlyArray<{ path: string }> }).entries;
    expect(entries.map((entry) => entry.path)).toContain('experience/acme.md');
    const file = await api('drafts/mio/files/experience/acme.md');
    expect(file.status).toBe(200);
    expect(file.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/);
    expect(((await file.json()) as { content: string }).content).toContain('company: Acme');
  });

  it('PUT …/files/{ruta} corrige el borrador con If-Match, y sin la huella correcta responde 409/428', async () => {
    const current = await api('drafts/mio/files/experience/acme.md');
    const etag = current.headers.get('etag') ?? '';
    const corrected = experience('Acme S.L.', 'Backend Senior', '2020-01', '2021-01');
    const sinIfMatch = await api('drafts/mio/files/experience/acme.md', { method: 'PUT', body: JSON.stringify({ content: corrected }), headers: { 'Content-Type': 'application/json' } });
    expect(sinIfMatch.status).toBe(428);
    const stale = await api('drafts/mio/files/experience/acme.md', { method: 'PUT', body: JSON.stringify({ content: corrected }), headers: { 'Content-Type': 'application/json', 'If-Match': `"${'0'.repeat(64)}"` } });
    expect(stale.status).toBe(409);
    const written = await api('drafts/mio/files/experience/acme.md', { method: 'PUT', body: JSON.stringify({ content: corrected }), headers: { 'Content-Type': 'application/json', 'If-Match': etag } });
    expect(written.status).toBe(200);
    expect(fs.file('/work/import/mio/experience/acme.md')?.content).toContain('company: Acme S.L.');
    // Corregir un borrador NO toca las fuentes.
    expect(fs.file('/work/data/sources/experience/acme.md')).toBeUndefined();
  });

  it('un nombre de borrador manipulado no sale de import/', async () => {
    // Un «..» ni siquiera llega a la ruta: el servidor normaliza la URL antes.
    for (const name of ['..', '%2e%2e']) {
      expect((await api(`drafts/${name}/files`)).status).toBe(404);
    }
    // Y lo que sí llega se rechaza por no ser un nombre de borrador: el de una copia lleva puntos.
    const backup = await api('drafts/mio.20260902-140535.bak/files');
    expect(backup.status).toBe(422);
    expect(((await backup.json()) as { error: { message: string } }).error.message).toContain('no es un nombre de borrador');
  });

  it('los fallos de cada ruta se explican en vez de romper, y unas fuentes rotas no ocultan los borradores', async () => {
    const roto = new MemoryFileSystem({
      '/work/data/sources/profile.md': '---\nschemaVersion: 1\n---\n',
      '/work/import/mio/profile.md': PROFILE,
      '/work/import/mio/experience/acme.md': experience('Acme', 'Backend Senior', '2020-01', '2021-01'),
    });
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
      // Que las fuentes no carguen no puede esconderte tus borradores: solo deja los duplicados sin comparar
      // contra ellas. Verlos es justo lo que hace falta para arreglar el perfil.
      const response = await fetch(`${otro.url}api/v1/drafts`, { headers: { Authorization: `Bearer ${TOKEN}` } });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { drafts: readonly unknown[]; duplicates: { compared: number } };
      expect(body.drafts).toHaveLength(1);
      expect(body.duplicates.compared).toBe(1);
    } finally {
      await otro.close();
    }
    // Un fichero que no está en el borrador es un 404, no un 500.
    expect((await api('drafts/mio/files/experience/no-existe.md')).status).toBe(404);
    // Y un cuerpo que no es el del esquema se para antes del caso de uso.
    const malo = await api('drafts/mio/files/experience/acme.md', { method: 'PUT', body: JSON.stringify({ contenido: 'x' }), headers: { 'Content-Type': 'application/json', 'If-Match': '*' } });
    expect(malo.status).toBe(400);
  });

  it('POST /drafts/adopt escribe con 201, ensaya con 200 y rechaza un cuerpo que no cumple el esquema', async () => {
    const dry = await api('drafts/adopt', {
      method: 'POST',
      body: JSON.stringify({ entries: [{ draft: 'mio', section: 'experience', id: 'exp-acme' }], dryRun: true }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(dry.status).toBe(200);
    expect(((await dry.json()) as { dryRun: boolean }).dryRun).toBe(true);
    expect(fs.file('/work/data/sources/experience/acme.md')).toBeUndefined();

    const adopted = await api('drafts/adopt', {
      method: 'POST',
      body: JSON.stringify({ entries: [{ draft: 'mio', section: 'experience', id: 'exp-acme' }] }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(adopted.status).toBe(201);
    expect(((await adopted.json()) as { adopted: ReadonlyArray<{ path: string }> }).adopted[0]?.path).toBe('experience/acme.md');
    expect(fs.file('/work/data/sources/experience/acme.md')?.content).toContain('company: Acme');

    // Lista vacía y sección inventada las para el esquema del cuerpo, antes de llegar al caso de uso: 400.
    const empty = await api('drafts/adopt', { method: 'POST', body: JSON.stringify({ entries: [] }), headers: { 'Content-Type': 'application/json' } });
    expect(empty.status).toBe(400);
    // Un id que el borrador no tiene es un 404 del caso de uso, no un 500.
    const inventada = await api('drafts/adopt', {
      method: 'POST',
      body: JSON.stringify({ entries: [{ draft: 'mio', section: 'experience', id: 'exp-inventada' }] }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(inventada.status).toBe(404);

    const unknownSection = await api('drafts/adopt', {
      method: 'POST',
      body: JSON.stringify({ entries: [{ draft: 'mio', section: 'habilidades', id: 'x' }] }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(unknownSection.status).toBe(400);
  });

  it('POST /drafts/replace: el borrador entero pasa a ser las fuentes; 200 ensaya, 201 escribe (T-9.33)', async () => {
    const replace = (body: unknown): Promise<Response> => api('drafts/replace', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

    const dry = await replace({ draft: 'mio', dryRun: true });
    expect(dry.status).toBe(200);
    expect(await dry.json()).toMatchObject({ dryRun: true, written: [], root: '/work/data/sources' });
    // No ha tocado nada: la fuente de antes sigue donde estaba.
    expect(fs.file('/work/data/sources/experience/life5.md')).toBeDefined();

    const done = await replace({ draft: 'mio' });
    expect(done.status).toBe(201);
    const outcome = (await done.json()) as { readonly backup?: string; readonly written: readonly string[] };
    expect(outcome.written).toContain('profile.md');
    // Sustituir no destruye: lo anterior queda entero en la copia (C9).
    expect(String(outcome.backup)).toMatch(/^\/work\/data\/sources\.\d{8}-\d{6}\.bak$/);
    expect(fs.file(`${String(outcome.backup)}/experience/life5.md`)).toBeDefined();

    // Un nombre manipulado no sale de import/, y un cuerpo sin borrador lo para el esquema.
    expect((await replace({ draft: '../fuera' })).status).toBe(422);
    expect((await replace({})).status).toBe(400);
  });
});
