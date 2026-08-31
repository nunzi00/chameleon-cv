/**
 * POST /import-linkedin (T-9.8): la exportación oficial de datos de LinkedIn (zip binario) como borrador en
 * `import/<nombre>/`, por el mismo camino que la CLI. Sin red: la ruta no descarga nada, solo lee el archivo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer, type ServerHandle } from '../../src/serve';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';
import { zipOf } from '../helpers/zip';

const TOKEN = 'token-de-pruebas-fijo';

const EXPORT = zipOf([
  ['Profile.csv', 'First Name,Last Name,Headline\r\nAda,Ejemplo,Ingeniera de software\r\n'],
  ['Positions.csv', 'Company Name,Title,Description,Started On,Finished On\r\nNexo Pagos,Staff Backend Engineer,Pasarela de pagos.,Mar 2022,\r\n'],
  ['Skills.csv', 'Name\r\nPHP\r\n'],
]);

describe('cv serve: POST /import-linkedin', () => {
  let handle: ServerHandle;
  let fs: MemoryFileSystem;

  const post = (body: Uint8Array, headers: Record<string, string> = {}): Promise<Response> =>
    fetch(`${handle.url}api/v1/import-linkedin`, {
      method: 'POST',
      body,
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/pdf', ...headers },
    });

  beforeAll(async () => {
    fs = new MemoryFileSystem({ '/work/data/sources/profile.md': '---\nfullName: Ada\n---\n' });
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

  it('201 con el resumen y el informe; al venir de CSV no hay nada sin situar', async () => {
    const response = await post(EXPORT);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { name: string; counts: { experience: number; skills: number }; readme: string; unparsed: readonly unknown[] };
    expect(body).toMatchObject({ name: 'ada-ejemplo', counts: { experience: 1, skills: 1 } });
    expect(body.unparsed).toEqual([]);
    expect(body.readme).toContain('# Informe del borrador importado');
    expect(await fs.readTextFile('/work/import/ada-ejemplo/profile.md')).toContain('Ada Ejemplo');
  });

  it('409 sin replace y 201 sustituyendo', async () => {
    expect((await post(EXPORT)).status).toBe(409);
    expect((await post(EXPORT, { 'x-cv-import-replace': '1' })).status).toBe(201);
  });

  it('un zip que no es una exportación de LinkedIn es 422 de datos', async () => {
    const response = await post(zipOf([['leeme.txt', 'hola']]));
    expect(response.status).toBe(422);
    expect(await response.text()).toContain('no parece una exportación de LinkedIn');
  });

  it('la cabecera de nombre decide la carpeta', async () => {
    const response = await post(EXPORT, { 'x-cv-import-name': 'mi-linkedin' });
    expect(response.status).toBe(201);
    expect(await fs.readTextFile('/work/import/mi-linkedin/README.md')).toContain('Reconocido');
  });

  it('lo que el esquema degrade viaja en «issues», con su motivo', async () => {
    const malo = zipOf([
      ['Profile.csv', 'First Name,Last Name\r\nAda,Ejemplo\r\n'],
      ['Email Addresses.csv', 'Email Address,Primary\r\nno-es-un-correo,Yes\r\n'],
    ]);
    const response = await post(malo, { 'x-cv-import-name': 'degradado' });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { issues: ReadonlyArray<{ reason: string }> };
    expect(body.issues.length).toBeGreaterThan(0);
    expect(body.issues.map((issue) => issue.reason).join(' ')).toContain('email');
  });
});
