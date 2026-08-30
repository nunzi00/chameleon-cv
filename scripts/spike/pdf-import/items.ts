/**
 * Extracción de items con coordenadas (T-8.4, P3): el worker del spike en un hilo aparte, con los mismos límites de
 * páginas, tiempo y memoria que el extractor del producto; devuelve los items o un error tipificado.
 */
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { DEFAULT_PDF_LIMITS, type PdfLimits } from '../../../src/pdf';
import type { TextItem } from './layout';

export type ItemsResult =
  | { readonly ok: true; readonly items: readonly TextItem[]; readonly pages: number }
  | { readonly ok: false; readonly code: 'invalid' | 'too-many-pages' | 'timeout' | 'too-large' | 'failed'; readonly message: string };

export function extractItems(bytes: Uint8Array, limits: PdfLimits = DEFAULT_PDF_LIMITS): Promise<ItemsResult> {
  if (bytes.byteLength > limits.maxBytes) {
    return Promise.resolve({ ok: false, code: 'too-large', message: `El PDF ocupa ${bytes.byteLength} bytes (máximo ${limits.maxBytes})` });
  }
  const worker = new Worker(join(__dirname, 'items-worker.mts'), {
    workerData: { bytes, maxPages: limits.maxPages },
    resourceLimits: { maxOldGenerationSizeMb: limits.maxMemoryMb },
    stdout: true,
    stderr: true,
  });
  worker.stdout.resume();
  worker.stderr.resume();
  return new Promise<ItemsResult>((resolve) => {
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve({ ok: false, code: 'timeout', message: `La extracción superó los ${limits.timeoutMs} ms permitidos` });
    }, limits.timeoutMs);
    const finish = (result: ItemsResult): void => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    };
    worker.once('message', (message: ItemsResult) => finish(message));
    worker.once('error', (error: Error) => finish({ ok: false, code: 'failed', message: error.message }));
    worker.once('exit', (code) => {
      if (code !== 0) {
        finish({ ok: false, code: 'failed', message: `el worker de items terminó con código ${code}` });
      }
    });
  });
}
