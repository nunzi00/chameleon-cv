/**
 * Worker de extracción de texto de PDF (`docs/pdf-integration.md` §2.2). Módulo ESM
 * autocontenido a propósito: solo importa paquetes, para que Node pueda cargarlo tanto
 * compilado (`dist/pdf/worker.mjs`) como en desarrollo (`src/pdf/worker.mts`, con el
 * *type stripping* nativo). Recibe bytes y devuelve texto; nada más.
 *
 * Es cableado de I/O: queda fuera del umbral de cobertura (como `src/index.ts`); su
 * comportamiento se verifica de extremo a extremo desde `extract-text.ts`.
 *
 * Nota de seguridad: pdf.js ≥ 5 eliminó por completo el código evaluado dinámicamente (la
 * opción `isEvalSupported` y el vector CVE-2024-4367 ya no existen en 6.x: cero `new Function`
 * en el build); el endurecimiento restante es no cargar fuentes ni rasterizar.
 */
import { parentPort, workerData } from 'node:worker_threads';

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

interface WorkerInput {
  readonly bytes: Uint8Array;
  readonly maxPages: number;
}

type WorkerReply =
  | { readonly ok: true; readonly text: string; readonly pages: number }
  | { readonly ok: false; readonly code: 'invalid' | 'too-many-pages' | 'failed'; readonly message: string };

const INVALID_PDF_ERRORS = new Set(['InvalidPDFException', 'FormatError', 'MissingPDFException', 'PasswordException', 'UnexpectedResponseException']);

async function extract(input: WorkerInput): Promise<WorkerReply> {
  // Opciones endurecidas fijas: sin fuentes, sin render, sin red (y sin URLs de CMaps ni fuentes estándar).
  const task = getDocument({
    data: new Uint8Array(input.bytes),
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: true,
    verbosity: 0,
  });
  try {
    const document = await task.promise;
    if (document.numPages > input.maxPages) {
      return { ok: false, code: 'too-many-pages', message: `El PDF tiene ${document.numPages} páginas (máximo ${input.maxPages})` };
    }
    const pages: string[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const lines: string[] = [];
      let line = '';
      for (const item of content.items) {
        if ('str' in item) {
          line += item.str;
          if (item.hasEOL) {
            lines.push(line);
            line = '';
          }
        }
      }
      if (line !== '') {
        lines.push(line);
      }
      pages.push(lines.join('\n'));
    }
    return { ok: true, text: pages.join('\n\n'), pages: document.numPages };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return {
      ok: false,
      code: INVALID_PDF_ERRORS.has(name) ? 'invalid' : 'failed',
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await task.destroy();
  }
}

void extract(workerData as WorkerInput).then((reply) => {
  parentPort?.postMessage(reply);
});
