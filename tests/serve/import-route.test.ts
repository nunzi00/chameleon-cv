/**
 * POST /import-cv (T-8.4b): el CV binario (PDF con extractor inyectado o worker real, DOCX con el lector de zip)
 * como borrador en import/<nombre>/ — 201 con el resumen y el README, 409 sin replace, 422 para datos malos.
 * El Content-Type no decide: la cabecera mágica de los bytes sí (el límite de cuerpo viene de accepts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer, type ServerHandle } from '../../src/serve';
import type { ItemsResult } from '../../src/import';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';
import { zipOf } from '../helpers/zip';

const TOKEN = 'token-de-pruebas-fijo';

const ITEMS: ItemsResult = {
  ok: true,
  pages: 1,
  items: [
    { page: 1, text: 'Ada Ejemplo — Backend', x: 40, y: 700, width: 200, fontSize: 16 },
    { page: 1, text: 'Experiencia', x: 40, y: 660, width: 100, fontSize: 13 },
    { page: 1, text: 'Backend Senior · Acme', x: 40, y: 630, width: 220, fontSize: 11 },
    { page: 1, text: 'mar 2020 – actualidad', x: 40, y: 615, width: 120, fontSize: 10 },
    { page: 1, text: '• Migré 14 servicios a Kubernetes.', x: 40, y: 600, width: 220, fontSize: 10 },
    // «Freelance» sin empresa (fecha en la línea siguiente) → issue «sin empresa reconocida»; la línea suelta acaba en unparsed.
    { page: 1, text: 'Freelance', x: 40, y: 580, width: 100, fontSize: 11 },
    { page: 1, text: 'ene 2018 – dic 2019', x: 40, y: 565, width: 120, fontSize: 10 },
    // Una línea sin viñeta dentro de «Logros» va directa a unparsed (cubre el mapa de la ruta).
    { page: 1, text: 'Logros', x: 40, y: 540, width: 80, fontSize: 13 },
    { page: 1, text: 'Nota perdida sin viñeta', x: 40, y: 520, width: 180, fontSize: 10 },
  ],
};

const DOC = '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Ada Ejemplo</w:t></w:r></w:p></w:body></w:document>';

describe('cv serve: POST /import', () => {
  let stubbed: ServerHandle;
  let real: ServerHandle;
  let corpus: ServerHandle;
  let corpusFs: MemoryFileSystem;

  const post = (handle: ServerHandle, body: Uint8Array | string, headers: Record<string, string> = {}): Promise<Response> =>
    fetch(`${handle.url}api/v1/import-cv`, { method: 'POST', body: typeof body === 'string' ? Buffer.from(body, 'utf8') : body, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/pdf', ...headers } });

  beforeAll(async () => {
    const options = { host: '127.0.0.1', port: 0, data: 'data/sources', profile: 'data/dist/profile.json', version: '9.9.9', apiOnly: true, allowedHosts: [], token: TOKEN, allowRemote: false };
    stubbed = await startServer({ ...options, context: appContext(new MemoryFileSystem({ '/work/data/sources/profile.md': '---\nfullName: Ada\n---\n' }), { itemsExtractor: async () => ITEMS, now: () => new Date('2026-08-30T21:00:00.000Z') }) });
    corpusFs = new MemoryFileSystem({ '/work/data/sources/profile.md': '---\nfullName: Ada\n---\n', '/work/corpus/uno.pdf': '%PDF-1.4 uno', '/work/corpus/dos.pdf': '%PDF-1.4 dos', '/work/corpus/roto.pdf': 'esto no es un PDF', '/work/corpus/notas.txt': 'nada' });
    corpus = await startServer({ ...options, context: appContext(corpusFs, { itemsExtractor: async () => ITEMS, now: () => new Date('2026-08-30T21:00:00.000Z') }) });
    real = await startServer({ ...options, context: appContext(new MemoryFileSystem({ '/work/data/sources/profile.md': '---\nfullName: Ada\n---\n' })) });
  });

  afterAll(async () => {
    await stubbed.close();
    await real.close();
    await corpus.close();
  });

  it('201 con el resumen, el README y el nombre del perfil; 409 sin replace y 201 sustituyendo', async () => {
    const created = await post(stubbed, '%PDF-1.4 finto');
    expect(created.status).toBe(201);
    const body = (await created.json()) as { name: string; files: number; counts: { experience: number }; readme: string; issues: readonly unknown[] };
    expect(body.name).toBe('ada-ejemplo');
    expect(body.counts.experience).toBe(2);
    expect(body.files).toBeGreaterThanOrEqual(3);
    expect(body.readme).toContain('# Informe del borrador importado');
    expect(body.issues.length).toBeGreaterThanOrEqual(1);
    expect((body as unknown as { unparsed: readonly unknown[] }).unparsed.length).toBeGreaterThanOrEqual(1);
    const conflict = await post(stubbed, '%PDF-1.4 finto');
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as { error: { code: string } }).error.code).toBe('conflict');
    const replaced = await post(stubbed, '%PDF-1.4 finto', { 'x-cv-import-replace': '1' });
    expect(replaced.status).toBe(201);
  });

  it('POST /import-manfred entra por su propia ruta y no deja nada sin situar (T-9.22)', async () => {
    const mac = JSON.stringify({
      settings: { MACVersion: '0.5' },
      aboutMe: { profile: { name: 'Ada', surnames: 'Ejemplo', title: 'Backend' } },
      experience: { jobs: [{ organization: { name: 'Acme' }, roles: [{ name: 'Backend Senior', startDate: '2020-01-01' }] }] },
      careerPreferences: { preferences: { preferredRoles: ['Backend Developer'] } },
    });
    const response = await fetch(`${stubbed.url}api/v1/import-manfred`, {
      method: 'POST',
      body: Buffer.from(mac, 'utf8'),
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/pdf', 'x-cv-import-name': 'mac-de-ada' },
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { name: string; counts: { experience: number }; issues: readonly unknown[]; unparsed: readonly unknown[]; readme: string };
    expect(body.name).toBe('mac-de-ada');
    expect(body.counts.experience).toBe(1);
    expect(body.unparsed).toEqual([]);
    // Lo que el MAC guarda y el perfil no, encabeza el informe en vez de perderse.
    expect(body.readme).toContain('los puestos que buscas');
    const invalido = await fetch(`${stubbed.url}api/v1/import-manfred`, { method: 'POST', body: Buffer.from('{"cualquier":"cosa"}', 'utf8'), headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/pdf' } });
    expect(invalido.status).toBe(422);
  });

  it('GET /import-cv/folders ofrece las carpetas con CV, para elegir una sin escribir la ruta (T-9.21)', async () => {
    const response = await fetch(`${corpus.url}api/v1/import-cv/folders`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { folders: ReadonlyArray<{ path: string; files: number }> };
    // El espacio de la prueba tiene corpus/ con tres PDF (uno roto, que también cuenta: se ve al importar) y
    // data/sources, que no se ofrece por ser del producto.
    expect(body.folders).toEqual([{ path: 'corpus', files: 3 }]);
  });

  it('la cabecera x-cv-import-name elige la carpeta; un DOCX entra por su cabecera mágica', async () => {
    const named = await post(stubbed, '%PDF-1.4 finto', { 'x-cv-import-name': 'mío borrador' });
    expect(named.status).toBe(201);
    expect(((await named.json()) as { name: string }).name).toBe('mio-borrador');
    const docx = await post(stubbed, zipOf([['word/document.xml', DOC]]), { 'Content-Type': 'application/octet-stream', 'x-cv-import-name': 'ada-docx' });
    expect(docx.status).toBe(201);
    expect(((await docx.json()) as { name: string }).name).toBe('ada-docx');
  });

  it('bytes que no son PDF ni DOCX, o un DOCX roto, son 422 de datos; el PDF falso llega al worker real', async () => {
    const unknown = await post(stubbed, 'hola mundo');
    expect(unknown.status).toBe(422);
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe('invalid-data');
    const broken = await post(stubbed, new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9]));
    expect(broken.status).toBe(422);
    const realWorker = await post(real, '%PDF-1.4 finto');
    expect(realWorker.status).toBe(422);
    expect(((await realWorker.json()) as { error: { message: string } }).error.message).toContain('No se pudo extraer el PDF (invalid)');
  });

  it('POST /import-cv/folder importa la carpeta entera y devuelve la tabla; lo que falla se anota (T-9.14)', async () => {
    const enviar = (body: unknown, handle: ServerHandle = corpus): Promise<Response> =>
      fetch(`${handle.url}api/v1/import-cv/folder`, { method: 'POST', body: JSON.stringify(body), headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } });
    const response = await enviar({ directory: 'corpus' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { total: number; imported: Array<{ file: string; name: string; counts: { experience: number } }>; failed: Array<{ file: string; message: string }> };
    // Solo .pdf y .docx del primer nivel, en orden estable, y cada borrador nombrado por su fichero.
    expect(body.total).toBe(3);
    expect(body.imported.map((entry) => entry.name)).toEqual(['dos', 'uno']);
    expect(body.imported[0]?.counts.experience).toBe(2);
    expect(body.failed.map((entry) => entry.file)).toEqual(['corpus/roto.pdf']);
    expect(corpusFs.file('/work/import/uno/README.md')).toBeDefined();
    // Repetir sin «replace» choca con lo que ya existe, y se cuenta como fallo de ese CV, no de la tanda.
    const otra = (await (await enviar({ directory: 'corpus' })).json()) as { imported: unknown[]; failed: Array<{ message: string }> };
    expect(otra.imported).toEqual([]);
    expect(otra.failed[0]?.message).toContain('--replace');
    expect((await (await enviar({ directory: 'corpus', replace: true })).json() as { imported: unknown[] }).imported).toHaveLength(2);
    // Una carpeta fuera del espacio de trabajo, una que no existe, una sin CV y un cuerpo vacío.
    expect((await enviar({ directory: '../fuera' })).status).toBe(400);
    expect((await enviar({ directory: 'no-existe' })).status).toBe(404);
    expect((await enviar({ directory: 'import' })).status).toBe(404);
    expect((await enviar({})).status).toBe(400);
  });
});
