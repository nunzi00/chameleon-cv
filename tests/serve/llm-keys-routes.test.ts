/**
 * PUT y DELETE /config/llm/keys/{proveedor}: guardar y borrar la clave de un remoto desde la interfaz web, en el
 * mismo fichero 0600 que escribe `cv llm key set`. Lo que de verdad se comprueba aquí es la promesa: la clave
 * viaja solo en el cuerpo del PUT y **ninguna respuesta la devuelve**, ni la de guardar ni la del estado.
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startServer, type ServerHandle } from '../../src/serve';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const TOKEN = 'token-de-pruebas-fijo';
const SECRETO = 'sk-clave-de-prueba-que-no-debe-salir-nunca';

describe('cv serve: claves de proveedores remotos', () => {
  let handle: ServerHandle;
  let configHome: string;

  const call = (method: string, provider: string, body?: unknown): Promise<Response> =>
    fetch(`${handle.url}api/v1/config/llm/keys/${provider}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    });

  beforeAll(async () => {
    configHome = await mkdtemp(join(tmpdir(), 'cv-keys-routes-'));
    vi.stubEnv('XDG_CONFIG_HOME', configHome);
    for (const name of ['CHAMELEON_OPENAI_API_KEY', 'CHAMELEON_ANTHROPIC_API_KEY', 'CHAMELEON_GROQ_API_KEY', 'CHAMELEON_GEMINI_API_KEY']) {
      vi.stubEnv(name, '');
    }
    handle = await startServer({
      host: '127.0.0.1',
      port: 0,
      data: 'data/sources',
      profile: 'data/dist/profile.json',
      version: '9.9.9',
      apiOnly: true,
      allowedHosts: [],
      token: TOKEN,
      allowRemote: true,
      context: appContext(new MemoryFileSystem({ '/work/data/sources/profile.md': '---\nfullName: Ada\n---\n' })),
    });
  });

  afterAll(async () => {
    await handle.close();
    vi.unstubAllEnvs();
    await rm(configHome, { recursive: true, force: true });
  });

  it('guarda la clave y responde con su procedencia, nunca con su valor', async () => {
    const response = await call('PUT', 'gemini', { key: SECRETO });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(SECRETO);
    expect(JSON.parse(text)).toMatchObject({ provider: 'gemini', source: 'file', keysFile: join(configHome, 'chameleon-cv', 'keys.json') });
  });

  it('el estado del co-piloto dice que hay clave, pero tampoco la enseña', async () => {
    const config = await fetch(`${handle.url}api/v1/config/llm`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const text = await config.text();
    expect(text).not.toContain(SECRETO);
    const gemini = (JSON.parse(text) as { llm: { providers: ReadonlyArray<{ id: string; keyPresence: string }> } }).llm.providers.find((provider) => provider.id === 'gemini');
    expect(gemini?.keyPresence).toBe('file');
  });

  it('la borra y lo dice; repetirlo no es un error, simplemente no había nada', async () => {
    expect(await (await call('DELETE', 'gemini')).json()).toMatchObject({ provider: 'gemini', removed: true, source: 'none' });
    expect(await (await call('DELETE', 'gemini')).json()).toMatchObject({ removed: false, source: 'none' });
  });

  it('rechaza un proveedor que no existe y un cuerpo que no cumple el contrato', async () => {
    expect((await call('PUT', 'inventado', { key: 'x' })).status).toBe(422);
    expect((await call('DELETE', 'inventado')).status).toBe(422);
    expect((await call('PUT', 'gemini', { key: '' })).status).toBe(400);
    expect((await call('PUT', 'gemini', {})).status).toBe(400);
  });

  it('una clave con saltos de línea se rechaza sin escribir nada', async () => {
    const response = await call('PUT', 'gemini', { key: 'linea1\nlinea2' });
    expect(response.status).toBe(422);
    expect(await (await call('DELETE', 'gemini')).json()).toMatchObject({ removed: false });
  });

  it('un fichero de claves con permisos abiertos se rechaza al guardar y al borrar, sin tocarlo', async () => {
    const dir = join(configHome, 'chameleon-cv');
    await mkdir(dir, { recursive: true });
    const file = join(dir, 'keys.json');
    await writeFile(file, '{"gemini":"da-igual"}', 'utf8');
    // 0644: cualquiera del sistema podría leerlo, así que el producto no lo usa ni lo reescribe.
    await chmod(file, 0o644);
    expect((await call('PUT', 'gemini', { key: SECRETO })).status).toBe(422);
    const removed = await call('DELETE', 'gemini');
    expect(removed.status).toBe(422);
    expect(await removed.text()).toContain('permisos');
    await chmod(file, 0o600);
  });
});
