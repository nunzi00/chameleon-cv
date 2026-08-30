/**
 * Descarga verificada (T-3.3): la única operación de red de `cv`, iniciada explícitamente por el
 * usuario con `cv typst install`. Solo https, límite de tamaño, tiempo acotado, fichero temporal
 * 0600 y SHA-256 calculado en streaming y comparado con el manifiesto antes de dar nada por bueno.
 */
import { createHash } from 'node:crypto';
import { open, unlink } from 'node:fs/promises';

import { describeError } from '../shared/errors';

export const DOWNLOAD_LIMITS = {
  timeoutMs: 120_000,
  /** Los assets oficiales pesan 14–23 MB; cualquier cosa mayor es sospechosa. */
  maxBytes: 96 * 1024 * 1024,
} as const;

export interface FetchedResponse {
  readonly ok: boolean;
  readonly status: number;
  /** URL final tras redirecciones (debe seguir siendo https). */
  readonly url: string;
  readonly body: AsyncIterable<Uint8Array> | null;
  readonly contentLength: number | undefined;
}

export type Fetcher = (url: string, timeoutMs?: number) => Promise<FetchedResponse>;

/** `fetch` nativo de Node con tiempo acotado y redirecciones seguidas. */
export async function fetchWithNode(url: string, timeoutMs: number = DOWNLOAD_LIMITS.timeoutMs): Promise<FetchedResponse> {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'chameleon-cv' } });
  const length = response.headers.get('content-length');
  return {
    ok: response.ok,
    status: response.status,
    url: response.url,
    body: response.body as unknown as AsyncIterable<Uint8Array> | null,
    contentLength: length === null ? undefined : Number(length),
  };
}

export type DownloadErrorCode = 'network' | 'http' | 'insecure' | 'too-large' | 'integrity';

export class DownloadError extends Error {
  readonly code: DownloadErrorCode;

  constructor(code: DownloadErrorCode, message: string) {
    super(message);
    this.name = 'DownloadError';
    this.code = code;
  }
}

export interface DownloadOptions {
  readonly expectedSha256: string;
  readonly maxBytes?: number | undefined;
  readonly fetcher?: Fetcher | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface DownloadResult {
  readonly bytes: number;
  readonly sha256: string;
}

async function removeQuietly(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // Puede no existir; el error original es el que importa.
  }
}

type OpenResponse = FetchedResponse & { readonly body: AsyncIterable<Uint8Array> };

/** Pide la URL y comprueba lo que se puede comprobar antes de leer el cuerpo: https final, HTTP correcto, tamaño anunciado. */
async function openDownload(url: string, maxBytes: number, fetcher: Fetcher, timeoutMs: number | undefined): Promise<OpenResponse> {
  let response: FetchedResponse;
  try {
    response = await fetcher(url, timeoutMs);
  } catch (error) {
    throw new DownloadError('network', `No se pudo descargar «${url}»: ${describeError(error)}`);
  }
  if (!response.url.startsWith('https://')) {
    throw new DownloadError('insecure', `La descarga acabó en una URL no segura: «${response.url}»`);
  }
  if (!response.ok || response.body === null) {
    throw new DownloadError('http', `La descarga de «${url}» respondió HTTP ${response.status}`);
  }
  if (response.contentLength !== undefined && response.contentLength > maxBytes) {
    throw new DownloadError('too-large', `El fichero anuncia ${response.contentLength} bytes; el máximo admitido es ${maxBytes}`);
  }
  return { ...response, body: response.body };
}

/** Recorre el cuerpo con límite en flujo y SHA-256 al vuelo; cada trozo pasa por `sink`. */
async function consume(url: string, body: AsyncIterable<Uint8Array>, maxBytes: number, sink: (chunk: Uint8Array) => Promise<void>): Promise<DownloadResult> {
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of body) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        throw new DownloadError('too-large', `La descarga supera el máximo admitido (${maxBytes} bytes)`);
      }
      hash.update(chunk);
      await sink(chunk);
    }
  } catch (error) {
    throw error instanceof DownloadError ? error : new DownloadError('network', `La descarga de «${url}» se interrumpió: ${describeError(error)}`);
  }
  return { bytes, sha256: hash.digest('hex') };
}

/** Descarga `url` en `target` (nuevo, 0600); si el SHA-256 no coincide, no queda ningún fichero. */
export async function downloadToFile(url: string, target: string, options: DownloadOptions): Promise<DownloadResult> {
  const maxBytes = options.maxBytes ?? DOWNLOAD_LIMITS.maxBytes;
  const response = await openDownload(url, maxBytes, options.fetcher ?? fetchWithNode, options.timeoutMs);
  const handle = await open(target, 'wx', 0o600);
  let result: DownloadResult;
  try {
    result = await consume(url, response.body, maxBytes, async (chunk) => {
      await handle.write(chunk);
    });
  } catch (error) {
    await handle.close();
    await removeQuietly(target);
    throw error;
  }
  await handle.close();
  if (result.sha256 !== options.expectedSha256) {
    await removeQuietly(target);
    throw new DownloadError('integrity', `SHA-256 incorrecto: esperado ${options.expectedSha256}, obtenido ${result.sha256}; el fichero se ha eliminado`);
  }
  return result;
}

export interface BufferDownloadOptions {
  /** Límite anunciado al usuario y aplicado en flujo. */
  readonly maxBytes: number;
  readonly fetcher?: Fetcher | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface BufferDownloadResult extends DownloadResult {
  readonly content: Uint8Array;
  /** URL final tras redirecciones (https). */
  readonly url: string;
}

/** Descarga pequeña en memoria (archivos de temas, T-8.3): mismas comprobaciones, sin fichero temporal. */
export async function downloadToBuffer(url: string, options: BufferDownloadOptions): Promise<BufferDownloadResult> {
  const response = await openDownload(url, options.maxBytes, options.fetcher ?? fetchWithNode, options.timeoutMs);
  const chunks: Uint8Array[] = [];
  const result = await consume(url, response.body, options.maxBytes, (chunk) => {
    chunks.push(chunk);
    return Promise.resolve();
  });
  return { ...result, content: Buffer.concat(chunks), url: response.url };
}
