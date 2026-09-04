/**
 * Los usuarios sobre HTTP (T-9.32): `GET|POST /users`, `DELETE /users/{id}` y —lo importante— que la
 * cabecera `x-cv-user` cambie la RAÍZ de todas las demás rutas sin que ninguna de ellas lo sepa.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer, type ServerHandle } from '../../src/serve';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const TOKEN = 'token-de-pruebas-fijo';
const ADA = '---\nschemaVersion: 1\nlocale: es-ES\nfullName: Ada Ejemplo\n---\n\nResumen.\n';
const EVA = '---\nschemaVersion: 1\nlocale: es-ES\nfullName: Eva Invitada\n---\n\nResumen.\n';

function assets(directory: string): (context: ReturnType<typeof appContext>) => ReturnType<typeof appContext> {
  return (context) => ({
    ...context,
    assets: { kind: context.assets.kind, text: (key) => context.assets.text(key), bytes: (key) => context.assets.bytes(key), keys: (prefix) => context.assets.keys(prefix), directory: () => Promise.resolve(directory) },
  });
}

describe('usuarios del espacio de trabajo', () => {
  let fs: MemoryFileSystem;
  let server: ServerHandle;
  const api = (path: string, init: RequestInit = {}, user?: string): Promise<Response> =>
    fetch(`${server.url}api/v1${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(user === undefined ? {} : { 'x-cv-user': user }), ...(init.headers ?? {}) } });
  const post = (path: string, body: unknown, user?: string): Promise<Response> => api(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }, user);

  beforeAll(async () => {
    fs = new MemoryFileSystem({
      '/work/data/sources/profile.md': ADA,
      '/work/usuarios/invitado1/data/sources/profile.md': EVA,
      '/tpl/profile.md': ADA,
    });
    server = await startServer({
      context: assets('/tpl')(appContext(fs)),
      host: '127.0.0.1',
      port: 0,
      data: 'data/sources',
      profile: 'data/dist/profile.json',
      version: '9.9.9',
      apiOnly: true,
      allowRemote: false,
      allowedHosts: [],
      token: TOKEN,
    });
  });
  afterAll(async () => {
    await server.close();
  });

  it('lista los usuarios, dice con cuál se trabaja y si la raíz sirve por sí sola', async () => {
    expect(await (await api('/users')).json()).toEqual({ root: '/work', users: [{ id: 'invitado1', root: '/work/usuarios/invitado1', sources: true, name: undefined }], current: undefined, pinned: undefined, rootUsable: true });
    expect(await (await api('/users', {}, 'invitado1')).json()).toMatchObject({ current: 'invitado1' });
  });

  it('la MISMA ruta con la cabecera devuelve el perfil del usuario, y sin ella el de la raíz', async () => {
    expect((await post('/build', {})).status).toBe(200);
    expect((await post('/build', {}, 'invitado1')).status).toBe(200);
    const raiz = (await (await api('/profile')).json()) as { readonly personal: { readonly fullName: string } };
    const invitado = (await (await api('/profile', {}, 'invitado1')).json()) as typeof raiz;
    expect(raiz.personal.fullName).toBe('Ada Ejemplo');
    expect(invitado.personal.fullName).toBe('Eva Invitada');
    // Y cada artefacto está en su sitio: elegir usuario es cambiar la raíz, no filtrar al leer.
    expect(fs.file('/work/usuarios/invitado1/data/dist/profile.json')).toBeDefined();
  });

  it('un usuario desconocido es 404 y uno imposible es 400: la cabecera no puede salir de usuarios/', async () => {
    expect((await api('/status', {}, 'nadie')).status).toBe(404);
    expect((await api('/status', {}, '../fuera')).status).toBe(400);
    // Una cabecera vacía es «sin usuario», no un error.
    expect((await api('/status', {}, '  ')).status).toBe(200);
  });

  it('crea un usuario sembrado, lo retira apartándolo y no pisa uno existente', async () => {
    const created = await post('/users', { id: 'nuevo' });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ id: 'nuevo', root: '/work/usuarios/nuevo', adopted: [] });
    expect(fs.file('/work/usuarios/nuevo/data/sources/profile.md')?.content).toBe(ADA);
    expect((await post('/users', { id: 'nuevo' })).status).toBe(409);
    // Un identificador imposible es un 400, la misma clase que una ruta de fichero que no se acepta.
    expect((await post('/users', { id: 'NO VALE' })).status).toBe(400);
    const removed = await api('/users/nuevo', { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect((await removed.json() as { readonly backup: string }).backup).toContain('/work/usuarios/nuevo.');
    expect((await api('/users/nuevo', { method: 'DELETE' })).status).toBe(404);
  });

  it('«empty» crea el usuario sin sembrar nada', async () => {
    expect((await post('/users', { id: 'vacio', empty: true })).status).toBe(201);
    expect(fs.file('/work/usuarios/vacio/data/sources/profile.md')).toBeUndefined();
  });

  it('un cuerpo que no cumple el esquema es 400', async () => {
    expect((await post('/users', { nombre: 'x' })).status).toBe(400);
  });
});

describe('cv serve --user: el servidor fijado a una persona', () => {
  let server: ServerHandle;
  beforeAll(async () => {
    const fs = new MemoryFileSystem({ '/work/usuarios/invitado1/data/sources/profile.md': EVA });
    server = await startServer({
      context: { ...appContext(fs), cwd: '/work/usuarios/invitado1', workspaceRoot: '/work' },
      root: '/work',
      pinnedUser: 'invitado1',
      host: '127.0.0.1',
      port: 0,
      data: 'data/sources',
      profile: 'data/dist/profile.json',
      version: '9.9.9',
      apiOnly: true,
      allowRemote: false,
      allowedHosts: [],
      token: TOKEN,
    });
  });
  afterAll(async () => {
    await server.close();
  });

  it('anuncia que está fijado y rechaza pedir otro usuario', async () => {
    const listed = await fetch(`${server.url}api/v1/users`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(await listed.json()).toMatchObject({ pinned: 'invitado1', current: 'invitado1' });
    const otro = await fetch(`${server.url}api/v1/status`, { headers: { Authorization: `Bearer ${TOKEN}`, 'x-cv-user': 'lucas' } });
    expect(otro.status).toBe(409);
    expect(await otro.json()).toMatchObject({ error: { message: expect.stringContaining('fijado al usuario «invitado1»') } });
    // Pedir el mismo que ya está fijado no es un error: es redundante.
    expect((await fetch(`${server.url}api/v1/status`, { headers: { Authorization: `Bearer ${TOKEN}`, 'x-cv-user': 'invitado1' } })).status).toBe(200);
  });
});
