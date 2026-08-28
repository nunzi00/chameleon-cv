/**
 * Extracción contenida de texto de un PDF (T-2.5, `docs/pdf-integration.md` §2.2): límites de
 * tamaño, páginas y texto; ejecución en un `worker_threads` propio con memoria acotada y
 * tiempo máximo tras el cual se termina el worker. Un PDF hostil no puede colgar la CLI.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { describeError } from '../shared/errors';

export interface PdfLimits {
  readonly maxBytes: number;
  readonly maxPages: number;
  readonly maxTextBytes: number;
  readonly timeoutMs: number;
  readonly maxMemoryMb: number;
}

export const DEFAULT_PDF_LIMITS: PdfLimits = {
  maxBytes: 10 * 1024 * 1024,
  maxPages: 50,
  maxTextBytes: 1024 * 1024,
  timeoutMs: 20_000,
  maxMemoryMb: 512,
};

export type PdfErrorCode = 'invalid' | 'too-large' | 'too-many-pages' | 'timeout' | 'failed';

export type PdfExtractionResult =
  | { readonly ok: true; readonly text: string; readonly pages: number }
  | { readonly ok: false; readonly code: PdfErrorCode; readonly message: string };

/** Respuesta del worker (protocolo interno). */
export type WorkerReply =
  | { readonly ok: true; readonly text: string; readonly pages: number }
  | { readonly ok: false; readonly code: 'invalid' | 'too-many-pages' | 'failed'; readonly message: string };

export interface ExtractionRun {
  readonly reply: Promise<WorkerReply>;
  terminate(): Promise<unknown>;
}

export type ExtractionRunner = (bytes: Uint8Array, maxPages: number, maxMemoryMb: number) => ExtractionRun;

/**
 * Script del worker, un módulo ESM: el compilado (`worker.mjs`) si existe, si no el fuente
 * (`worker.mts`, que Node carga nativamente con su *type stripping*).
 */
export function workerScriptPath(directory: string = __dirname): string {
  const compiled = join(directory, 'worker.mjs');
  return existsSync(compiled) ? compiled : join(directory, 'worker.mts');
}

/** Ejecuta un script de worker con los bytes y los límites; captura su salida para que no se cuele en la CLI. */
export function createWorkerRunner(script: string): ExtractionRunner {
  return (bytes, maxPages, maxMemoryMb) => {
    const worker = new Worker(script, {
      workerData: { bytes, maxPages },
      resourceLimits: { maxOldGenerationSizeMb: maxMemoryMb },
      stdout: true,
      stderr: true,
    });
    worker.stdout.resume();
    worker.stderr.resume();
    const reply = new Promise<WorkerReply>((resolve) => {
      worker.once('message', (message: WorkerReply) => {
        resolve(message);
      });
      worker.once('error', (error) => {
        resolve({ ok: false, code: 'failed', message: describeError(error) });
      });
      worker.once('exit', (code) => {
        if (code !== 0) {
          resolve({ ok: false, code: 'failed', message: `el worker de extracción terminó con código ${code}` });
        }
      });
    });
    return { reply, terminate: () => worker.terminate() };
  };
}

export const runInWorker: ExtractionRunner = (bytes, maxPages, maxMemoryMb) => createWorkerRunner(workerScriptPath())(bytes, maxPages, maxMemoryMb);

export async function extractPdfText(
  bytes: Uint8Array,
  limits: PdfLimits = DEFAULT_PDF_LIMITS,
  runner: ExtractionRunner = runInWorker,
): Promise<PdfExtractionResult> {
  if (bytes.byteLength > limits.maxBytes) {
    return { ok: false, code: 'too-large', message: `El PDF ocupa ${bytes.byteLength} bytes (máximo ${limits.maxBytes})` };
  }
  const run = runner(bytes, limits.maxPages, limits.maxMemoryMb);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<PdfExtractionResult>((resolve) => {
    timer = setTimeout(() => {
      resolve({ ok: false, code: 'timeout', message: `La extracción superó los ${limits.timeoutMs} ms permitidos` });
    }, limits.timeoutMs);
  });
  try {
    const result = await Promise.race([run.reply, timeout]);
    if (!result.ok) {
      return result;
    }
    const textBytes = Buffer.byteLength(result.text, 'utf8');
    if (textBytes > limits.maxTextBytes) {
      return { ok: false, code: 'too-large', message: `El texto extraído ocupa ${textBytes} bytes (máximo ${limits.maxTextBytes})` };
    }
    return result;
  } finally {
    clearTimeout(timer);
    await run.terminate();
  }
}
