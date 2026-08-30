/**
 * Worker del spike (T-8.4, P3): como `src/pdf/worker.mts` —mismo pdf.js endurecido, sin fuentes, sin render, sin red—
 * pero devuelve los *items* de texto con sus coordenadas y tamaño de fuente en lugar de líneas. Solo para medir; no
 * forma parte del producto.
 */
import { parentPort, workerData } from 'node:worker_threads';

import '../../../src/pdf/polyfills.mts';
import 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

interface WorkerInput {
  readonly bytes: Uint8Array;
  readonly maxPages: number;
}

interface Item {
  readonly page: number;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly fontSize: number;
}

type WorkerReply = { readonly ok: true; readonly items: Item[]; readonly pages: number } | { readonly ok: false; readonly code: 'invalid' | 'too-many-pages' | 'failed'; readonly message: string };

const INVALID_PDF_ERRORS = new Set(['InvalidPDFException', 'FormatError', 'MissingPDFException', 'PasswordException', 'UnexpectedResponseException']);

async function extract(input: WorkerInput): Promise<WorkerReply> {
  const task = getDocument({ data: new Uint8Array(input.bytes), disableFontFace: true, useSystemFonts: false, stopAtErrors: true, verbosity: 0 });
  try {
    const document = await task.promise;
    if (document.numPages > input.maxPages) {
      return { ok: false, code: 'too-many-pages', message: `El PDF tiene ${document.numPages} páginas (máximo ${input.maxPages})` };
    }
    const items: Item[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if ('str' in item && item.str !== '') {
          const [a, b, , , x, y] = item.transform as number[];
          items.push({ page: number, text: item.str, x: x ?? 0, y: y ?? 0, width: item.width, fontSize: Math.hypot(a ?? 0, b ?? 0) || 1 });
        }
      }
    }
    return { ok: true, items, pages: document.numPages };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return { ok: false, code: INVALID_PDF_ERRORS.has(name) ? 'invalid' : 'failed', message: error instanceof Error ? error.message : String(error) };
  } finally {
    await task.destroy();
  }
}

void extract(workerData as WorkerInput).then((reply) => {
  parentPort?.postMessage(reply);
});
