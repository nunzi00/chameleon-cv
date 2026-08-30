/**
 * Descarga de una oferta desde URL (T-8.5 S1, docs/offers-from-url.md §4.2 y §7): la capa de red del extractor.
 * Solo `https`, límites de 2 MB y 15 s, guardia SSRF con resolutor DNS inyectable (loopback, rangos privados,
 * enlace local y metadatos), redirecciones re-validadas, cabeceras de navegador (la vista pública de LinkedIn lo
 * exige, §S0.5) y tipos de contenido cerrados: HTML → extractor, PDF → `extractPdfText`, texto → tal cual.
 * Sin cookies, sin credenciales y sin reintentos: una descarga por orden del usuario.
 */
import { lookup } from 'node:dns/promises';

import { describeError } from '../shared/errors';
import { downloadToBuffer, type Fetcher } from '../typst/download';
import { extractOffer, type ExtractedOffer } from './extract';

export const OFFER_URL_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  timeoutMs: 15_000,
} as const;

export const OFFER_URL_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) Chameleon-CV/offers';
const ACCEPT = 'text/html, application/pdf;q=0.9, text/plain;q=0.8, text/markdown;q=0.8';

export type OfferUrlErrorCode = 'invalid-url' | 'forbidden-address' | 'download' | 'content-type' | 'pdf' | 'empty';

export type ResolveHost = (host: string) => Promise<readonly string[]>;

export interface FetchOfferOptions {
  /** Doble de red para pruebas y arnés; por defecto, `fetch` de Node con las cabeceras de oferta. */
  readonly fetcher?: Fetcher | undefined;
  /** Resolutor DNS inyectable para la guardia SSRF; por defecto, `dns.lookup` con todas las direcciones. */
  readonly resolveHost?: ResolveHost | undefined;
  /** Extractor de PDF del contexto (contenido en un worker). */
  readonly pdfExtractor: (content: Uint8Array) => Promise<{ readonly ok: true; readonly text: string } | { readonly ok: false; readonly message: string }>;
  readonly acceptLanguage?: string | undefined;
}

export interface FetchedOffer extends ExtractedOffer {
  /** URL final tras redirecciones. */
  readonly url: string;
  readonly bytes: number;
  readonly kind: 'html' | 'pdf' | 'texto';
}

export type FetchOfferResult = { readonly ok: true; readonly offer: FetchedOffer } | { readonly ok: false; readonly code: OfferUrlErrorCode; readonly message: string };

/** IPv4/IPv6 que nunca se visitan (§7): loopback, privadas, enlace local (incluye 169.254.169.254), únicas locales y no especificadas. */
export function isForbiddenAddress(address: string): boolean {
  const ip = address.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4 !== null) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b! >= 64 && b! <= 127) || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168);
  }
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped !== null) {
    return isForbiddenAddress(mapped[1]!);
  }
  return ip === '::' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb');
}

async function defaultResolveHost(host: string): Promise<readonly string[]> {
  const results = await lookup(host, { all: true, verbatim: true });
  return results.map((entry) => entry.address);
}

/** La URL es admisible: `https`, con host, y ni el host literal ni ninguna de sus direcciones son privados. */
async function guard(raw: string, resolveHost: ResolveHost): Promise<{ readonly ok: true; readonly url: URL } | { readonly ok: false; readonly code: OfferUrlErrorCode; readonly message: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: 'invalid-url', message: `«${raw}» no es una URL válida` };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, code: 'invalid-url', message: `Solo se admiten URL https (la oferta llegó por «${url.protocol}//»); copia el texto o guarda la página y usa el fichero` };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, code: 'invalid-url', message: 'La URL no puede llevar credenciales' };
  }
  const host = url.hostname;
  if (isForbiddenAddress(host)) {
    return { ok: false, code: 'forbidden-address', message: `La dirección «${host}» es privada o local: no se descarga` };
  }
  // Un host literal (IPv4 o IPv6, ya vetado arriba si es privado) no pasa por DNS.
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !host.includes(':')) {
    let addresses: readonly string[];
    try {
      addresses = await resolveHost(host);
    } catch (error) {
      return { ok: false, code: 'download', message: `No se pudo resolver «${host}»: ${describeError(error)}` };
    }
    const banned = addresses.find(isForbiddenAddress);
    if (banned !== undefined) {
      return { ok: false, code: 'forbidden-address', message: `«${host}» resuelve a la dirección privada o local ${banned}: no se descarga` };
    }
  }
  return { ok: true, url };
}

/** El `fetch` real con las cabeceras de oferta (UA de navegador, accept y accept-language); exportado para probarlo contra un servidor local. */
export function offerFetcher(acceptLanguage: string | undefined): Fetcher {
  return async (url, timeoutMs) => {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs ?? OFFER_URL_LIMITS.timeoutMs),
      headers: {
        'user-agent': OFFER_URL_USER_AGENT,
        accept: ACCEPT,
        ...(acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage }),
      },
    });
    const length = response.headers.get('content-length');
    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      body: response.body as unknown as AsyncIterable<Uint8Array> | null,
      contentLength: length === null ? undefined : Number(length),
      contentType: response.headers.get('content-type') ?? undefined,
    };
  };
}

/** El juego de caracteres: cabecera `content-type` o `<meta charset>`; UTF-8 si no consta o no se reconoce. */
export function decodeBody(content: Uint8Array, contentType: string | undefined, html: boolean): string {
  const fromHeader = contentType?.match(/charset=([\w-]+)/i)?.[1];
  let charset = fromHeader;
  if (charset === undefined && html) {
    const head = new TextDecoder('utf-8', { fatal: false }).decode(content.slice(0, 4096));
    charset = head.match(/<meta[^>]+charset\s*=\s*"?([\w-]+)/i)?.[1];
  }
  try {
    return new TextDecoder(charset ?? 'utf-8', { fatal: false }).decode(content);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(content);
  }
}

/** Descarga y extrae una oferta desde su URL. La confirmación (C3) ocurre ANTES de llamar aquí. */
export async function fetchOffer(raw: string, options: FetchOfferOptions): Promise<FetchOfferResult> {
  const fetcher = options.fetcher ?? offerFetcher(options.acceptLanguage);
  const guarded = await guard(raw, options.resolveHost ?? defaultResolveHost);
  if (!guarded.ok) {
    return guarded;
  }
  let downloaded;
  try {
    downloaded = await downloadToBuffer(guarded.url.href, {
      maxBytes: OFFER_URL_LIMITS.maxBytes,
      timeoutMs: OFFER_URL_LIMITS.timeoutMs,
      fetcher,
    });
  } catch (error) {
    // downloadToBuffer siempre lanza DownloadError con el mensaje completo; describeError lo conserva.
    return { ok: false, code: 'download', message: describeError(error) };
  }
  const final = new URL(downloaded.url);
  if (isForbiddenAddress(final.hostname)) {
    return { ok: false, code: 'forbidden-address', message: `La descarga acabó en la dirección privada o local «${final.hostname}»: se descarta` };
  }
  const type = (downloaded.contentType ?? 'text/html').split(';')[0]!.trim().toLowerCase();
  if (type === 'application/pdf') {
    const extracted = await options.pdfExtractor(downloaded.content);
    if (!extracted.ok) {
      return { ok: false, code: 'pdf', message: `No se pudo extraer el texto del PDF de «${downloaded.url}»: ${extracted.message}` };
    }
    if (extracted.text.trim() === '') {
      return { ok: false, code: 'empty', message: 'El PDF descargado no contiene texto' };
    }
    return { ok: true, offer: { text: extracted.text, title: undefined, company: undefined, location: undefined, datePosted: undefined, salary: undefined, source: 'contenido', warnings: [], url: downloaded.url, bytes: downloaded.bytes, kind: 'pdf' } };
  }
  if (type === 'text/plain' || type === 'text/markdown') {
    const text = decodeBody(downloaded.content, downloaded.contentType, false).trim();
    if (text === '') {
      return { ok: false, code: 'empty', message: 'La URL respondió un texto vacío' };
    }
    return { ok: true, offer: { text, title: undefined, company: undefined, location: undefined, datePosted: undefined, salary: undefined, source: 'contenido', warnings: [], url: downloaded.url, bytes: downloaded.bytes, kind: 'texto' } };
  }
  if (type !== 'text/html' && type !== 'application/xhtml+xml') {
    return { ok: false, code: 'content-type', message: `Tipo de contenido no admitido: «${type}» (se aceptan HTML, PDF y texto)` };
  }
  const extracted = extractOffer(decodeBody(downloaded.content, downloaded.contentType, true));
  if (extracted.text.trim() === '') {
    // Un texto vacío solo sale de la reserva de «página», que siempre deja el aviso de JavaScript.
    return { ok: false, code: 'empty', message: `La página no contiene texto de oferta (${extracted.warnings[0]!})` };
  }
  return { ok: true, offer: { ...extracted, url: downloaded.url, bytes: downloaded.bytes, kind: 'html' } };
}
