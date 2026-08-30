/**
 * Extractor DOCX mínimo (T-8.4b, docs/cv-import.md §2.3, decisión D3): un .docx es un zip; se lee SOLO
 * `word/document.xml` con el lector de zip contenido del producto (política de entradas cerrada, límites)
 * y se convierte a texto plano: un párrafo por línea, `<w:t>` concatenados, tabulador como espacio,
 * saltos `<w:br/>` como salto de línea y los párrafos numerados (`<w:numPr>`) como viñetas «- ».
 * La maquetación fina (columnas, tamaños) queda para PDF; aquí basta el orden natural del documento.
 */
import { describeError } from '../shared/errors';
import { readZipEntries } from '../themes/archive';

const DOCUMENT_PATH = 'word/document.xml';
/** Límite del XML descomprimido: un CV no llega ni de lejos; un zip-bomba se corta aquí. */
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export type DocxResult = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly message: string };

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** El texto de un párrafo `<w:p>…</w:p>`: los `<w:t>` en orden, con tabuladores y saltos de línea suaves. */
export function paragraphText(xml: string): string {
  const pieces: string[] = [];
  const pattern = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>/g;
  for (const match of xml.matchAll(pattern)) {
    if (match[1] !== undefined) {
      pieces.push(decodeXmlEntities(match[1]));
    } else if (match[0].startsWith('<w:tab')) {
      // Ojo: «<w:tab/>» también empieza por «<w:t»; el grupo capturado es lo que distingue un w:t real.
      pieces.push(' ');
    } else {
      pieces.push('\n');
    }
  }
  return pieces.join('');
}

/** Del XML del documento al texto plano, un párrafo por línea y las listas como viñetas. */
export function documentXmlToText(xml: string): string {
  const lines: string[] = [];
  // Un párrafo es <w:p …>…</w:p> (los <w:p/> vacíos no aportan); parar en el primer «/>» interior trocearía
  // los párrafos con <w:tab/> o <w:numPr> dentro.
  for (const match of xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
    const paragraph = match[0];
    const text = paragraphText(paragraph).replace(/[ \t]+/g, ' ').trim();
    if (text === '') {
      continue;
    }
    const bullet = /<w:numPr\b/.test(paragraph) ? '- ' : '';
    lines.push(bullet + text);
  }
  return lines.join('\n');
}

/** Extrae el texto de un .docx; cualquier problema (zip roto, sin document.xml) es un mensaje, nunca una excepción. */
export function extractDocxText(bytes: Uint8Array): DocxResult {
  let entries;
  try {
    entries = readZipEntries(bytes);
  } catch (error) {
    return { ok: false, message: `el .docx no se puede leer como zip: ${describeError(error)}` };
  }
  const entry = entries.find((candidate) => candidate.type === 'file' && candidate.path === DOCUMENT_PATH);
  if (entry === undefined || entry.type !== 'file') {
    return { ok: false, message: `el .docx no contiene ${DOCUMENT_PATH}` };
  }
  let xml: string;
  try {
    xml = new TextDecoder('utf-8', { fatal: false }).decode(entry.read(MAX_DOCUMENT_BYTES));
  } catch (error) {
    return { ok: false, message: `no se pudo descomprimir ${DOCUMENT_PATH}: ${describeError(error)}` };
  }
  const text = documentXmlToText(xml);
  return text === '' ? { ok: false, message: 'el documento no tiene texto' } : { ok: true, text };
}
