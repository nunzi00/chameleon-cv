/**
 * Extractor de ofertas desde HTML (T-8.5 S1, docs/offers-from-url.md §4.1 y §S1): puro y sin dependencias.
 * Cascada con procedencia, fijada por el corpus real de §S0: (1) JSON-LD `JobPosting` (título, empresa, lugar,
 * fecha, salario y descripción); (2) si la descripción es corta (menos de ~250 palabras), se completa con el
 * contenido principal del cuerpo (sin `nav`/`header`/`footer`/`aside` ni scripts); (3) `og:*` y `<title>` como
 * reserva. El texto es literal (C2/C6): no se resume ni se «arregla»; los metadatos solo salen si la página los
 * declara, y `source` dice de dónde vino cada cosa. La calidad se mide en tests/offers/quality.test.ts (§4.6).
 */

/** Umbral de §S1.2: por debajo de estas palabras, la descripción del JSON-LD se considera un resumen (caso Manfred). */
export const SHORT_DESCRIPTION_WORDS = 250;
/** Por debajo de esto, el contenido de la página no da para analizar una oferta (SPA vacía, anti-bot…). */
export const MINIMUM_CONTENT_WORDS = 40;

export type OfferSource = 'json-ld' | 'json-ld+cuerpo' | 'contenido' | 'página';

export interface ExtractedOffer {
  /** Texto plano final: metadatos declarados y cuerpo de la oferta. */
  readonly text: string;
  readonly title: string | undefined;
  readonly company: string | undefined;
  readonly location: string | undefined;
  readonly datePosted: string | undefined;
  readonly salary: string | undefined;
  /** De dónde salió el cuerpo (procedencia, §4.3 `--explain`). */
  readonly source: OfferSource;
  readonly warnings: readonly string[];
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  shy: '',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  uuml: 'ü',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  Ntilde: 'Ñ',
  euro: '€',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  middot: '·',
  deg: '°',
};

/** Entidades HTML → texto: numéricas (decimales y hexadecimales) y las con nombre habituales en ofertas. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (whole, name: string) => NAMED_ENTITIES[name] ?? whole);
}

const DROP_SUBTREES = ['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'canvas', 'select'];
const CHROME_SUBTREES = ['nav', 'header', 'footer', 'aside'];
// `li` no está aquí: su apertura ya emite «\n- » y su cierre no debe añadir otra línea (viñetas compactas).
const BLOCK_TAGS = 'p|div|ul|ol|br|h1|h2|h3|h4|h5|h6|tr|table|section|article|main|blockquote|dt|dd|figure|figcaption|form';

function dropSubtrees(html: string, tags: readonly string[]): string {
  let result = html;
  for (const tag of tags) {
    result = result.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), ' ');
  }
  return result;
}

/**
 * HTML → texto plano tolerante (sin DOM): descarta scripts y compañía, corta línea en los bloques, pone viñeta
 * en `li`, quita el resto de etiquetas, decodifica entidades y normaliza espacios y saltos.
 */
export function htmlToText(html: string): string {
  const cleaned = dropSubtrees(html.replace(/<!--[\s\S]*?-->/g, ' '), DROP_SUBTREES)
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi'), '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(cleaned)
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function wordCount(text: string): number {
  return text === '' ? 0 : text.split(/\s+/).filter((word) => word !== '').length;
}

/* ── JSON-LD ─────────────────────────────────────────────────────────────────────────────────── */

interface JobPosting {
  readonly title?: unknown;
  readonly description?: unknown;
  readonly datePosted?: unknown;
  readonly hiringOrganization?: unknown;
  readonly jobLocation?: unknown;
  readonly jobLocationType?: unknown;
  readonly baseSalary?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function candidates(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap(candidates);
  }
  const record = asRecord(value);
  if (record === undefined) {
    return [];
  }
  const graph = record['@graph'];
  return [record, ...(Array.isArray(graph) ? graph.flatMap(candidates) : [])];
}

/** El primer `JobPosting` de los bloques `application/ld+json` de la página (también dentro de listas y `@graph`). */
export function findJobPosting(html: string): JobPosting | undefined {
  for (const match of html.matchAll(/<script[^>]*type\s*=\s*"application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]!.trim());
    } catch {
      continue;
    }
    for (const candidate of candidates(parsed)) {
      if (candidate['@type'] === 'JobPosting') {
        return candidate;
      }
    }
  }
  return undefined;
}

function organizationName(value: unknown): string | undefined {
  return asText(asRecord(value)?.['name']) ?? asText(value);
}

function placeText(value: unknown, remote: boolean): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  const address = asRecord(asRecord(first)?.['address']);
  const parts = [asText(address?.['addressLocality']), asText(address?.['addressRegion']), asText(address?.['addressCountry'])].filter(
    (part): part is string => part !== undefined,
  );
  const where = parts.join(', ');
  if (remote) {
    return where === '' ? 'Remoto' : `Remoto (${where})`;
  }
  return where === '' ? undefined : where;
}

function salaryText(value: unknown): string | undefined {
  const salary = asRecord(value);
  if (salary === undefined) {
    return undefined;
  }
  const currency = asText(salary['currency']) ?? '';
  const amount = asRecord(salary['value']);
  const single = amount === undefined ? undefined : (asText(amount['value']) ?? (typeof amount['value'] === 'number' ? String(amount['value']) : undefined));
  const low = amount?.['minValue'];
  const high = amount?.['maxValue'];
  const unit = asText(amount?.['unitText']);
  const range =
    typeof low === 'number' && typeof high === 'number' ? `${low}–${high}` : typeof low === 'number' ? `desde ${low}` : typeof high === 'number' ? `hasta ${high}` : single;
  if (range === undefined) {
    return undefined;
  }
  return [range, currency, unit === undefined ? undefined : `(${unit})`].filter((part) => part !== undefined && part !== '').join(' ');
}

/* ── Contenido principal y og:* ──────────────────────────────────────────────────────────────── */

/** El texto del contenido: `main`/`article` si existen; si no, el cuerpo sin la cromada (`nav`, `header`, `footer`, `aside`). */
export function mainText(html: string): string {
  const withoutChrome = dropSubtrees(html, CHROME_SUBTREES);
  for (const tag of ['main', 'article']) {
    const match = withoutChrome.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    if (match !== null) {
      const text = htmlToText(match[1]!);
      if (wordCount(text) >= MINIMUM_CONTENT_WORDS) {
        return text;
      }
    }
  }
  const body = withoutChrome.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
  return htmlToText(body === null ? withoutChrome : body[1]!);
}

function meta(html: string, property: string): string | undefined {
  const byProperty = html.match(new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*"${property}"[^>]+content\\s*=\\s*"([^"]*)"`, 'i'));
  const byContent = html.match(new RegExp(`<meta[^>]+content\\s*=\\s*"([^"]*)"[^>]+(?:property|name)\\s*=\\s*"${property}"`, 'i'));
  const value = byProperty?.[1] ?? byContent?.[1];
  return value === undefined ? undefined : asText(decodeEntities(value));
}

function pageTitle(html: string): string | undefined {
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return title === null ? undefined : asText(decodeEntities(title[1]!));
}

/* ── Cascada ─────────────────────────────────────────────────────────────────────────────────── */

/** Monta el texto final: metadatos declarados (con etiqueta) y el cuerpo. */
function assemble(fields: readonly (readonly [string, string | undefined])[], body: string): string {
  const header = fields
    .filter((field): field is [string, string] => field[1] !== undefined)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
  return header === '' ? body : `${header}\n\n${body}`;
}

export function extractOffer(html: string): ExtractedOffer {
  const warnings: string[] = [];
  const posting = findJobPosting(html);
  const content = mainText(html);
  const ogTitle = meta(html, 'og:title');
  const ogDescription = meta(html, 'og:description');

  if (posting !== undefined) {
    const title = asText(posting.title);
    const company = organizationName(posting.hiringOrganization);
    const location = placeText(posting.jobLocation, asText(posting.jobLocationType) === 'TELECOMMUTE');
    const datePosted = asText(posting.datePosted);
    const salary = salaryText(posting.baseSalary);
    const description = htmlToText(asText(posting.description) ?? '');
    let body = description;
    let source: OfferSource = 'json-ld';
    // El cuerpo solo sustituye a la descripción si es claramente más rico (×1,5): así una descripción completa
    // que también aparece en el cuerpo (caso LinkedIn) no cambia de procedencia.
    if (wordCount(description) < SHORT_DESCRIPTION_WORDS && wordCount(content) > wordCount(description) * 1.5) {
      // Descripción-resumen (caso Manfred, §S0): el cuerpo de la página trae la oferta completa.
      body = content;
      source = 'json-ld+cuerpo';
      warnings.push(`la descripción del JSON-LD tiene ${wordCount(description)} palabras; el cuerpo se toma del contenido de la página (${wordCount(content)})`);
    }
    if (wordCount(body) < MINIMUM_CONTENT_WORDS) {
      warnings.push('la oferta declarada apenas tiene texto');
    }
    return {
      text: assemble(
        [
          ['Título', title],
          ['Empresa', company],
          ['Lugar', location],
          ['Fecha de publicación', datePosted],
          ['Salario', salary],
        ],
        body,
      ),
      title,
      company,
      location,
      datePosted,
      salary,
      source,
      warnings,
    };
  }

  const title = ogTitle ?? pageTitle(html);
  if (wordCount(content) >= MINIMUM_CONTENT_WORDS) {
    return {
      text: assemble([['Título', title]], content),
      title,
      company: undefined,
      location: undefined,
      datePosted: undefined,
      salary: undefined,
      source: 'contenido',
      warnings,
    };
  }

  warnings.push('la página apenas tiene texto: puede pintarse con JavaScript; pega la oferta o guárdala como PDF y usa el fichero');
  const fallback = [title, ogDescription, content === '' ? undefined : content].filter((part): part is string => part !== undefined && part !== '').join('\n\n');
  return { text: fallback, title, company: undefined, location: undefined, datePosted: undefined, salary: undefined, source: 'página', warnings };
}
