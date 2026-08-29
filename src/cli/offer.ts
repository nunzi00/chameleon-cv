/**
 * La oferta en la CLI: `-` es la entrada estándar (solo texto) y cualquier otra cosa, un fichero de texto
 * o PDF relativo al directorio de trabajo. La lectura, los límites y los mensajes viven en la capa de
 * casos de uso (`src/app/offer.ts`).
 */
import { resolve } from 'node:path';

import { DEFAULT_OFFER_NAME, offerNameOf, type OfferInput } from '../app/offer';
import type { CliContext } from './context';

export { DEFAULT_OFFER_NAME, OFFER_MAX_BYTES, isPdfSource, offerNameOf, pdfExitCode, type OfferInput } from '../app/offer';

export const STDIN_SOURCE = '-';

/** Concatena un flujo de trozos (Buffer o texto) en una cadena UTF-8. */
export async function readStream(stream: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Nombre corto de una oferta a partir de su argumento en la CLI. */
export function offerName(source: string): string {
  return source === STDIN_SOURCE ? DEFAULT_OFFER_NAME : offerNameOf(source);
}

/** La entrada que la capa de casos de uso leerá, a partir del argumento de la CLI. */
export function offerInput(context: Pick<CliContext, 'cwd' | 'stdin'>, source: string): OfferInput {
  return source === STDIN_SOURCE ? { kind: 'stdin', read: () => context.stdin(), name: DEFAULT_OFFER_NAME } : { kind: 'file', path: resolve(context.cwd, source) };
}
