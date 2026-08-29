/**
 * Lectura de la oferta de empleo (`docs/trimming-cli.md` §4.1, `docs/pdf-integration.md` §2.2): texto ya
 * en memoria, un lector diferido (la entrada estándar de la CLI) o un fichero de texto o PDF (texto
 * extraído en un worker contenido), con límites de tamaño; vacía es error de datos.
 */
import { basename, extname, resolve } from 'node:path';

import { normalizeInput } from '../core/keywords';
import { DEFAULT_PDF_LIMITS, type PdfErrorCode } from '../pdf';
import { describeError } from '../shared/errors';
import type { AppContext } from './context';
import { dataError, environmentError, errorWithExit, type AppError, type ExitCode } from './errors';
import { slugify } from './slug';

export const OFFER_MAX_BYTES = 1024 * 1024;
export const DEFAULT_OFFER_NAME = 'oferta';
const PDF_EXTENSION = /\.pdf$/i;

export type OfferInput =
  | { readonly kind: 'text'; readonly text: string; readonly name?: string | undefined }
  | { readonly kind: 'stdin'; readonly read: () => Promise<string>; readonly name?: string | undefined }
  | { readonly kind: 'file'; readonly path: string };

export interface OfferText {
  /** Texto normalizado (sin BOM, finales de línea `\n`). */
  readonly text: string;
  /** Nombre corto para la salida y los informes (`acme-backend`, u `oferta` si no viene de un fichero). */
  readonly name: string;
}

export type OfferResult = { readonly ok: true; readonly offer: OfferText } | { readonly ok: false; readonly error: AppError };

/** Nombre corto de una oferta a partir de la ruta de su fichero. */
export function offerNameOf(path: string): string {
  return slugify(basename(path, extname(path))) || DEFAULT_OFFER_NAME;
}

export function isPdfSource(source: string): boolean {
  return PDF_EXTENSION.test(source);
}

/** Un PDF inválido o excesivo es un problema de datos; un fallo o un tiempo agotado, del entorno. */
export function pdfExitCode(code: PdfErrorCode): ExitCode {
  return code === 'timeout' || code === 'failed' ? 2 : 1;
}

async function readOfferFile(context: AppContext, path: string): Promise<string | AppError> {
  try {
    const info = await context.datasetFileSystem.stat(path);
    if (info.kind !== 'file') {
      return environmentError(`La oferta «${path}» no es un fichero`);
    }
    if (isPdfSource(path)) {
      if (info.size > DEFAULT_PDF_LIMITS.maxBytes) {
        return environmentError(`La oferta «${path}» supera el máximo de 10 MiB`);
      }
      const extracted = await context.pdfExtractor(await context.datasetFileSystem.readBinaryFile(path));
      return extracted.ok ? extracted.text : errorWithExit(`No se pudo extraer el texto de «${path}»: ${extracted.message}`, pdfExitCode(extracted.code));
    }
    if (info.size > OFFER_MAX_BYTES) {
      return environmentError(`La oferta «${path}» supera el máximo de 1 MiB`);
    }
    return await context.datasetFileSystem.readTextFile(path);
  } catch (error) {
    return environmentError(`No se pudo leer la oferta «${path}»: ${describeError(error)}`);
  }
}

export async function readOffer(context: AppContext, input: OfferInput): Promise<OfferResult> {
  let raw: string;
  let name: string;
  if (input.kind === 'file') {
    const path = resolve(context.cwd, input.path);
    const read = await readOfferFile(context, path);
    if (typeof read !== 'string') {
      return { ok: false, error: read };
    }
    raw = read;
    name = offerNameOf(path);
  } else {
    raw = input.kind === 'text' ? input.text : await input.read();
    name = input.name ?? DEFAULT_OFFER_NAME;
  }
  const text = normalizeInput(raw);
  if (text.trim() === '') {
    return { ok: false, error: dataError('La oferta está vacía') };
  }
  return { ok: true, offer: { text, name } };
}
