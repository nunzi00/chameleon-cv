import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DOWNLOAD_LIMITS, DownloadError, downloadToBuffer, downloadToFile, fetchWithNode, type FetchedResponse, type Fetcher } from '../../src/typst';

const PAYLOAD = Buffer.from('%PDF-contenido de prueba para la descarga verificada'.repeat(100));
const SHA = createHash('sha256').update(PAYLOAD).digest('hex');

async function* chunks(buffer: Buffer, size = 700): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < buffer.length; offset += size) {
    yield buffer.subarray(offset, offset + size);
  }
}

function respond(overrides: Partial<FetchedResponse> = {}): Fetcher {
  return () => Promise.resolve({ ok: true, status: 200, url: 'https://objects.example/typst.tar.xz', body: chunks(PAYLOAD), contentLength: PAYLOAD.length, ...overrides });
}

let directory = '';
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'chameleon-download-'));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

describe('downloadToFile', () => {
  it('escribe el fichero (0600) en streaming y devuelve bytes y SHA-256 verificado', async () => {
    const target = join(directory, 'ok.bin');
    expect(await downloadToFile('https://example/asset', target, { expectedSha256: SHA, fetcher: respond() })).toEqual({ bytes: PAYLOAD.length, sha256: SHA });
    expect((await readFile(target)).equals(PAYLOAD)).toBe(true);
    expect((await stat(target)).mode & 0o777).toBe(0o600);
    expect(DOWNLOAD_LIMITS.maxBytes).toBe(96 * 1024 * 1024);
  });

  it('con un SHA-256 distinto no deja ningún fichero', async () => {
    const target = join(directory, 'bad.bin');
    const error = await downloadToFile('https://example/asset', target, { expectedSha256: 'f'.repeat(64), fetcher: respond() }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DownloadError);
    expect(error).toMatchObject({ code: 'integrity', message: expect.stringContaining('el fichero se ha eliminado') });
    expect(await exists(target)).toBe(false);
  });

  it('rechaza respuestas no seguras, errores HTTP, cuerpos ausentes y tamaños excesivos (anunciados o reales)', async () => {
    const attempt = (fetcher: Fetcher, maxBytes?: number) => downloadToFile('https://example/asset', join(directory, `x-${Math.random()}.bin`), { expectedSha256: SHA, fetcher, maxBytes }).catch((e: unknown) => e);
    expect(await attempt(respond({ url: 'http://objects.example/typst.tar.xz' }))).toMatchObject({ code: 'insecure' });
    expect(await attempt(respond({ ok: false, status: 404 }))).toMatchObject({ code: 'http', message: 'La descarga de «https://example/asset» respondió HTTP 404' });
    expect(await attempt(respond({ body: null }))).toMatchObject({ code: 'http' });
    expect(await attempt(respond({ contentLength: 10 ** 9 }))).toMatchObject({ code: 'too-large', message: expect.stringContaining('anuncia') });
    const real = await attempt(respond({ contentLength: undefined }), 1000);
    expect(real).toMatchObject({ code: 'too-large', message: expect.stringContaining('supera el máximo') });
    expect(await attempt(() => Promise.reject(new TypeError('fetch failed')))).toMatchObject({ code: 'network', message: 'No se pudo descargar «https://example/asset»: fetch failed' });
    async function* broken(): AsyncGenerator<Uint8Array> {
      yield PAYLOAD.subarray(0, 10);
      throw new Error('conexión perdida');
    }
    const interrupted = await attempt(respond({ body: broken() }));
    expect(interrupted).toMatchObject({ code: 'network', message: 'La descarga de «https://example/asset» se interrumpió: conexión perdida' });
  });

  it('un destino que ya existe no se sobrescribe', async () => {
    const target = join(directory, 'ok.bin');
    const error = await downloadToFile('https://example/asset', target, { expectedSha256: SHA, fetcher: respond() }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DownloadError);
  });
});

describe('fetchWithNode', () => {
  let server: Server;
  let url = '';
  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === '/chunked') {
        response.writeHead(200);
        response.write(PAYLOAD);
        response.end();
        return;
      }
      response.writeHead(200, { 'content-length': String(PAYLOAD.length) });
      response.end(PAYLOAD);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    url = typeof address === 'object' && address !== null ? `http://127.0.0.1:${address.port}/asset` : '';
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('envuelve fetch: estado, URL final, cuerpo iterable y longitud; y downloadToFile rechaza http en la URL final', async () => {
    const response = await fetchWithNode(url);
    expect(response).toMatchObject({ ok: true, status: 200, url, contentLength: PAYLOAD.length });
    const received: Buffer[] = [];
    for await (const chunk of response.body ?? []) {
      received.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(received).equals(PAYLOAD)).toBe(true);
    expect((await fetchWithNode(url.replace('/asset', '/chunked'))).contentLength).toBeUndefined();
    const error = await downloadToFile(url, join(directory, 'insecure.bin'), { expectedSha256: SHA }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'insecure' });
    await expect(downloadToBuffer(url, { maxBytes: 10 })).rejects.toMatchObject({ code: 'insecure' });
  });
});

describe('downloadToBuffer (T-8.3, archivos de temas)', () => {
  it('descarga en memoria con las mismas comprobaciones: contenido, bytes, huella y URL final', async () => {
    const result = await downloadToBuffer('https://example/tema.zip', { maxBytes: PAYLOAD.length, fetcher: respond() });
    expect(result).toEqual({ bytes: PAYLOAD.length, sha256: SHA, content: PAYLOAD, url: 'https://objects.example/typst.tar.xz' });
    expect(Buffer.from(result.content).equals(PAYLOAD)).toBe(true);
  });

  it('rechaza la URL final no https, el HTTP fallido, el tamaño anunciado o real por encima del límite y la red caída', async () => {
    await expect(downloadToBuffer('https://example/t', { maxBytes: 1_000_000, fetcher: respond({ url: 'http://objects.example/t' }) })).rejects.toMatchObject({ code: 'insecure' });
    await expect(downloadToBuffer('https://example/t', { maxBytes: 1_000_000, fetcher: respond({ ok: false, status: 404 }) })).rejects.toMatchObject({ code: 'http' });
    await expect(downloadToBuffer('https://example/t', { maxBytes: 10, fetcher: respond() })).rejects.toMatchObject({ code: 'too-large', message: `El fichero anuncia ${PAYLOAD.length} bytes; el máximo admitido es 10` });
    await expect(downloadToBuffer('https://example/t', { maxBytes: 1000, fetcher: respond({ contentLength: undefined }) })).rejects.toMatchObject({ code: 'too-large', message: 'La descarga supera el máximo admitido (1000 bytes)' });
    await expect(downloadToBuffer('https://example/t', { maxBytes: 1000, fetcher: () => Promise.reject(new TypeError('fetch failed')) })).rejects.toMatchObject({ code: 'network' });
    const timeouts: Array<number | undefined> = [];
    const fetcher: Fetcher = (_url, timeoutMs) => {
      timeouts.push(timeoutMs);
      return respond()('x');
    };
    await downloadToBuffer('https://example/t', { maxBytes: PAYLOAD.length, fetcher, timeoutMs: 60_000 });
    await downloadToBuffer('https://example/t', { maxBytes: PAYLOAD.length, fetcher });
    expect(timeouts).toEqual([60_000, undefined]);
  });
});
