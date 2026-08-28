/**
 * Lectura de la oferta de empleo (`docs/trimming-cli.md` §4.1): un fichero de texto o la entrada
 * estándar (`-`), con límite de tamaño; vacía es error de datos.
 */
import { basename, extname, resolve } from 'node:path';

import { normalizeInput } from '../core/keywords';
import { describeError } from '../shared/errors';
import type { CliContext } from './context';
import { EXIT_DATA_ERROR, EXIT_FAILURE } from './output';
import { slugify } from './slug';

export const OFFER_MAX_BYTES = 1024 * 1024;
export const STDIN_SOURCE = '-';
const STDIN_NAME = 'oferta';

export interface OfferText {
  /** Texto normalizado (sin BOM, finales de línea `\n`). */
  readonly text: string;
  /** Nombre corto para la salida y los informes (`acme-backend`, o `oferta` si viene de stdin). */
  readonly name: string;
}

export type OfferResult =
  | { readonly ok: true; readonly offer: OfferText }
  | { readonly ok: false; readonly message: string; readonly exitCode: number };

/** Concatena un flujo de trozos (Buffer o texto) en una cadena UTF-8. */
export async function readStream(stream: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Nombre corto de una oferta a partir de su ruta. */
export function offerName(source: string): string {
  return source === STDIN_SOURCE ? STDIN_NAME : slugify(basename(source, extname(source))) || STDIN_NAME;
}

export async function readOfferText(context: CliContext, source: string): Promise<OfferResult> {
  let raw: string;
  if (source === STDIN_SOURCE) {
    raw = await context.stdin();
  } else {
    const path = resolve(context.cwd, source);
    try {
      const info = await context.datasetFileSystem.stat(path);
      if (info.kind !== 'file') {
        return { ok: false, message: `La oferta «${path}» no es un fichero`, exitCode: EXIT_FAILURE };
      }
      if (info.size > OFFER_MAX_BYTES) {
        return { ok: false, message: `La oferta «${path}» supera el máximo de 1 MiB`, exitCode: EXIT_FAILURE };
      }
      raw = await context.datasetFileSystem.readTextFile(path);
    } catch (error) {
      return { ok: false, message: `No se pudo leer la oferta «${path}»: ${describeError(error)}`, exitCode: EXIT_FAILURE };
    }
  }
  const text = normalizeInput(raw);
  if (text.trim() === '') {
    return { ok: false, message: 'La oferta está vacía', exitCode: EXIT_DATA_ERROR };
  }
  return { ok: true, offer: { text, name: offerName(source) } };
}
