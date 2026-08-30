/**
 * Extracción de items de un PDF con coordenadas (T-8.4b, docs/cv-import.md §2): como `extractPdfText` del producto
 * —worker propio con memoria acotada y tiempo máximo; un PDF hostil no puede colgar la CLI— pero devuelve los items
 * de texto con posición y tamaño de fuente para reconstruir la maquetación. El worker se carga por ruta en el
 * repositorio y `dist/`, y por código embebido en el ejecutable autónomo (mismo esquema de assets que el de PDF).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import type { AssetStore } from '../shared/assets';
import { describeError } from '../shared/errors';
import { DEFAULT_PDF_LIMITS, type PdfLimits } from '../pdf';
import type { TextItem } from './layout';

export type ItemsErrorCode = 'invalid' | 'too-many-pages' | 'timeout' | 'too-large' | 'failed';

export type ItemsResult =
  | { readonly ok: true; readonly items: readonly TextItem[]; readonly pages: number }
  | { readonly ok: false; readonly code: ItemsErrorCode; readonly message: string };

/** Respuesta del worker (protocolo interno). */
export type ItemsWorkerReply = ItemsResult;

/** Script del worker, un módulo ESM: el compilado (`items-worker.mjs`) si existe, si no el fuente (`items-worker.mts`). */
export function itemsWorkerScriptPath(directory: string = __dirname): string {
  const compiled = join(directory, 'items-worker.mjs');
  return existsSync(compiled) ? compiled : join(directory, 'items-worker.mts');
}

/** Clave del asset con el worker de items empaquetado (ejecutable autónomo). */
export const ITEMS_WORKER_ASSET_KEY = 'items-worker.js';

/** De dónde sale el worker: un fichero (repositorio y `dist/`) o su código ya empaquetado. */
export type ItemsWorkerSource = { readonly kind: 'path'; readonly path: string } | { readonly kind: 'code'; readonly code: string };

/** En el repositorio el worker se carga por ruta; en cualquier otro almacén, por código embebido. */
export async function itemsWorkerSource(assets: Pick<AssetStore, 'kind' | 'text'>): Promise<ItemsWorkerSource> {
  return assets.kind === 'disk' ? { kind: 'path', path: itemsWorkerScriptPath() } : { kind: 'code', code: await assets.text(ITEMS_WORKER_ASSET_KEY) };
}

export interface ItemsRun {
  readonly reply: Promise<ItemsWorkerReply>;
  terminate(): Promise<unknown>;
}

export type ItemsRunner = (bytes: Uint8Array, maxPages: number, maxMemoryMb: number) => ItemsRun;

/** Ejecuta el worker (por ruta o por código) con los bytes y los límites; captura su salida para que no se cuele en la CLI. */
export function createItemsRunner(source: string | ItemsWorkerSource): ItemsRunner {
  const spec: ItemsWorkerSource = typeof source === 'string' ? { kind: 'path', path: source } : source;
  return (bytes, maxPages, maxMemoryMb) => {
    const worker = new Worker(spec.kind === 'code' ? spec.code : spec.path, {
      eval: spec.kind === 'code',
      workerData: { bytes, maxPages },
      resourceLimits: { maxOldGenerationSizeMb: maxMemoryMb },
      stdout: true,
      stderr: true,
    });
    worker.stdout.resume();
    worker.stderr.resume();
    const reply = new Promise<ItemsWorkerReply>((resolve) => {
      worker.once('message', (message: ItemsWorkerReply) => {
        resolve(message);
      });
      worker.once('error', (error) => {
        resolve({ ok: false, code: 'failed', message: describeError(error) });
      });
      worker.once('exit', (code) => {
        if (code !== 0) {
          resolve({ ok: false, code: 'failed', message: `el worker de items terminó con código ${code}` });
        }
      });
    });
    return { reply, terminate: () => worker.terminate() };
  };
}

export const runItemsInWorker: ItemsRunner = (bytes, maxPages, maxMemoryMb) => createItemsRunner(itemsWorkerScriptPath())(bytes, maxPages, maxMemoryMb);

/** Extrae los items con los mismos límites (bytes, páginas, memoria, tiempo, texto total) que el extractor de PDF. */
export async function extractItems(bytes: Uint8Array, limits: PdfLimits = DEFAULT_PDF_LIMITS, runner: ItemsRunner = runItemsInWorker): Promise<ItemsResult> {
  if (bytes.byteLength > limits.maxBytes) {
    return { ok: false, code: 'too-large', message: `El PDF ocupa ${bytes.byteLength} bytes (máximo ${limits.maxBytes})` };
  }
  const run = runner(bytes, limits.maxPages, limits.maxMemoryMb);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<ItemsResult>((resolve) => {
    timer = setTimeout(() => {
      resolve({ ok: false, code: 'timeout', message: `La extracción superó los ${limits.timeoutMs} ms permitidos` });
    }, limits.timeoutMs);
  });
  try {
    const result = await Promise.race([run.reply, timeout]);
    if (!result.ok) {
      return result;
    }
    const textBytes = result.items.reduce((sum, item) => sum + Buffer.byteLength(item.text, 'utf8'), 0);
    if (textBytes > limits.maxTextBytes) {
      return { ok: false, code: 'too-large', message: `El texto extraído ocupa ${textBytes} bytes (máximo ${limits.maxTextBytes})` };
    }
    return result;
  } finally {
    clearTimeout(timer);
    await run.terminate();
  }
}
