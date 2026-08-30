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
  ],
};

const DOC = '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Ada Ejemplo</w:t></w:r></w:p></w:body></w:document>';

describe('cv serve: POST /import', () => {
  let stubbed: ServerHandle;
  let real: ServerHandle;

  const post = (handle: ServerHandle, body: Uint8Array | string, headers: Record<string, string> = {}): Promise<Response> =>
    fetch(`${handle.url}api/v1/import-cv`, { method: 'POST', body: typeof body === 'string' ? Buffer.from(body, 'utf8') : body, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/pdf', ...headers } });

  beforeAll(async () => {
    const options = { host: '127.0.0.1', port: 0, data: 'data/sources', profile: 'data/dist/profile.json', version: '9.9.9', apiOnly: true, allowedHosts: [], token: TOKEN, allowRemote: false };
    stubbed = await startServer({ ...options, context: appContext(new MemoryFileSystem({ '/work/data/sources/profile.md': '---\nfullName: Ada\n---\n' }), { itemsExtractor: async () => ITEMS, now: () => new Date('2026-08-30T21:00:00.000Z') }) });
    real = await startServer({ ...options, context: appContext(new MemoryFileSystem({ '/work/data/sources/profile.md': '---\nfullName: Ada\n---\n' })) });
  });

  afterAll(async () => {
    await stubbed.close();
    await real.close();
  });

  it('201 con el resumen, el README y el nombre del perfil; 409 sin replace y 201 sustituyendo', async () => {
    const created = await post(stubbed, '%PDF-1.4 finto');
    expect(created.status).toBe(201);
    const body = (await created.json()) as { name: string; files: number; counts: { experience: number }; readme: string; issues: readonly unknown[] };
    expect(body.name).toBe('ada-ejemplo');
    expect(body.counts.experience).toBe(1);
    expect(body.files).toBeGreaterThanOrEqual(3);
    expect(body.readme).toContain('# Informe del borrador importado');
    const conflict = await post(stubbed, '%PDF-1.4 finto');
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as { error: { code: string } }).error.code).toBe('conflict');
    const replaced = await post(stubbed, '%PDF-1.4 finto', { 'x-cv-import-replace': '1' });
    expect(replaced.status).toBe(201);
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
});
