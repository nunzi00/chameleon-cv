/**
 * La oferta en la CLI: `-` es la entrada estándar (solo texto) y cualquier otra cosa, un fichero de texto
 * o PDF relativo al directorio de trabajo. La lectura, los límites y los mensajes viven en la capa de
 * casos de uso (`src/app/offer.ts`).
 */
import { relative, resolve } from 'node:path';

import { DEFAULT_OFFER_NAME, offerNameOf, type OfferInput } from '../app/offer';
import { slugify } from '../app/slug';
import { OFFER_URL_LIMITS, fetchOffer, offerFetcher, type FetchedOffer } from '../offers';
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

/* ── URL como origen de la oferta (T-8.5 S1, docs/offers-from-url.md §4.3) ───────────────────── */

export function isUrlSource(source: string): boolean {
  return /^https?:\/\//i.test(source.trim());
}

export interface OfferUrlFlags {
  readonly allowRemote: boolean;
  readonly yes: boolean;
  /** `--save-offer [ruta]`: `true` = nombre automático en offers/; una cadena = ruta relativa a offers/. */
  readonly saveOffer?: string | boolean | undefined;
  readonly replace: boolean;
}

export type OfferSourceResult = { readonly ok: true; readonly input: OfferInput } | { readonly ok: false; readonly message: string; readonly exit: number };

function saveTarget(offer: FetchedOffer, flag: string | true): string {
  const suggested = slugify([offer.title, offer.company].filter((part) => part !== undefined).join(' ')) || offerNameOf(new URL(offer.url).pathname);
  const name = flag === true ? `${suggested}.txt` : flag.endsWith('.txt') || flag.endsWith('.md') ? flag : `${flag}.txt`;
  return `offers/${name}`.replace(/\/{2,}/g, '/');
}

/**
 * Resuelve una URL de oferta: `--allow-remote` obligatorio, confirmación por petición (o `--yes`), descarga con la
 * guardia de §4.2, procedencia por stderr y guardado opcional en `offers/` con cabecera de origen. El resto de los
 * orígenes (fichero, `-`) no pasa por aquí.
 */
export async function resolveOfferSource(context: CliContext, source: string, flags: OfferUrlFlags): Promise<OfferSourceResult> {
  const url = source.trim();
  if (!flags.allowRemote) {
    return { ok: false, message: 'Una oferta por URL exige --allow-remote (y confirma la descarga, o usa --yes); también puedes pegar el texto o guardar la página y pasar el fichero', exit: 2 };
  }
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return { ok: false, message: `«${url}» no es una URL válida`, exit: 1 };
  }
  const question = `Se descargará «${url}» (host ${host}, máximo ${Math.round(OFFER_URL_LIMITS.maxBytes / 1024 / 1024)} MB, sin cookies). ¿Continuar? [s/N] `;
  if (!flags.yes) {
    if (context.confirm === undefined) {
      return { ok: false, message: 'Descarga cancelada: sin terminal interactiva, confirma con --yes', exit: 2 };
    }
    if (!(await context.confirm(question))) {
      return { ok: false, message: 'Descarga cancelada', exit: 2 };
    }
  }
  const result = await fetchOffer(url, {
    fetcher: context.fetcher ?? offerFetcher('es, en;q=0.8'),
    pdfExtractor: async (content) => {
      const extracted = await context.pdfExtractor(content);
      return extracted.ok ? { ok: true, text: extracted.text } : { ok: false, message: extracted.message };
    },
  });
  if (!result.ok) {
    return { ok: false, message: result.message, exit: result.code === 'invalid-url' ? 1 : 2 };
  }
  const offer = result.offer;
  context.stderr(`Oferta descargada de ${offer.url} (${offer.bytes} bytes, ${offer.kind}; procedencia: ${offer.source})\n`);
  for (const warning of offer.warnings) {
    context.stderr(`Aviso: ${warning}\n`);
  }
  const name = slugify([offer.title, offer.company].filter((part) => part !== undefined).join(' ')) || offerNameOf(new URL(offer.url).pathname);
  if (flags.saveOffer !== undefined && flags.saveOffer !== false) {
    const target = saveTarget(offer, flags.saveOffer);
    const absolute = resolve(context.cwd, target);
    if (relative(resolve(context.cwd, 'offers'), absolute).startsWith('..')) {
      return { ok: false, message: `--save-offer debe quedar dentro de offers/ (no «${target}»)`, exit: 1 };
    }
    let exists = true;
    try {
      await context.datasetFileSystem.stat(absolute);
    } catch {
      exists = false;
    }
    if (exists && !flags.replace) {
      return { ok: false, message: `Ya existe ${target}; usa --replace para sustituirlo`, exit: 1 };
    }
    const header = `# Origen: ${offer.url}\n# Descargada: ${(context.now?.() ?? new Date()).toISOString()}\n# Procedencia: ${offer.source}\n\n`;
    try {
      await context.artifactFileSystem.mkdir(resolve(context.cwd, 'offers'));
      await context.artifactFileSystem.writeFile(absolute, header + offer.text + '\n', 0o600);
    } catch (error) {
      return { ok: false, message: `No se pudo guardar la oferta en ${target}: ${error instanceof Error ? error.message : String(error)}`, exit: 2 };
    }
    context.stderr(`Oferta guardada en ${target} (cabecera con el origen)\n`);
  }
  return { ok: true, input: { kind: 'text', text: offer.text, name } };
}

const OFFER_EXTENSIONS = /\.(txt|md|markdown|pdf)$/i;

/** Lista `offers/**` (profundidad ≤ 3, ≤ 500 entradas) ordenada por fecha de cambio descendente. */
export async function listOffers(context: CliContext): Promise<readonly { readonly path: string; readonly bytes: number; readonly modifiedAt: string }[]> {
  const root = resolve(context.cwd, 'offers');
  const found: { path: string; bytes: number; modifiedAt: string }[] = [];
  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > 3 || found.length >= 500) {
      return;
    }
    let entries;
    try {
      entries = await context.datasetFileSystem.readDirectory(directory);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= 500) {
        return;
      }
      const path = resolve(directory, entry.name);
      if (entry.kind === 'directory') {
        await walk(path, depth + 1);
      } else if (entry.kind === 'file' && OFFER_EXTENSIONS.test(entry.name)) {
        const info = await context.datasetFileSystem.stat(path);
        found.push({ path: relative(context.cwd, path), bytes: info.size, modifiedAt: new Date(info.mtimeMs).toISOString() });
      }
    }
  }
  await walk(root, 1);
  return found.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.path.localeCompare(b.path));
}
