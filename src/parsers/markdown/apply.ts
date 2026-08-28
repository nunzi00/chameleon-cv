/**
 * Cirugía mínima sobre un fichero Markdown del dataset (T-4.7, `cv improve apply`): localizar el
 * tramo exacto del texto de un logro (sin su cola de `#hashtags` ni sus metadatos) o del resumen
 * (cuerpo anterior al primer encabezado) y sustituir solo eso. Funciones puras sobre cadenas: el
 * resto del fichero —frontmatter, otras viñetas, metadatos, espacios— queda byte a byte igual.
 */
import type { List, RootContent } from 'mdast';

import { rawTextLength, splitTrailingHashtags } from './achievements';
import { parseMarkdownDocument, sliceNodes } from './document';
import { sliceSource, spanOf } from './positions';

export interface SourceRange {
  /** Desplazamientos en el fichero (`[start, end)`) y línea de inicio. */
  readonly start: number;
  readonly end: number;
  readonly line: number;
  /** Texto actual del tramo tal como lo entiende el parser (comparable con el original de la revisión). */
  readonly text: string;
}

function listsOf(nodes: readonly RootContent[]): List[] {
  return nodes.filter((node): node is List => node.type === 'list');
}

/** Todas las viñetas de logros del fichero (listas de cualquier sección), en orden de documento. */
export function achievementRanges(source: string): SourceRange[] {
  const parsed = parseMarkdownDocument(source, 'fuente');
  if (!parsed.ok) {
    return [];
  }
  const ranges: SourceRange[] = [];
  const lists = [...listsOf(parsed.document.leading), ...parsed.document.sections.flatMap((section) => listsOf(section.nodes))];
  for (const list of lists) {
    for (const item of list.children) {
      const [paragraph] = item.children;
      if (paragraph === undefined || paragraph.type !== 'paragraph') {
        continue;
      }
      const raw = sliceSource(source, paragraph);
      const span = spanOf(paragraph);
      ranges.push({ start: span.startOffset, end: span.startOffset + rawTextLength(raw), line: span.startLine, text: splitTrailingHashtags(raw).text });
    }
  }
  return ranges;
}

/** Tramo del logro cuyo texto es exactamente `original`; si hay varios iguales, el más cercano a `nearLine`. */
export function locateAchievementText(source: string, original: string, nearLine?: number): SourceRange | undefined {
  const candidates = achievementRanges(source).filter((range) => range.text === original);
  if (candidates.length <= 1 || nearLine === undefined) {
    return candidates[0];
  }
  return candidates.reduce((best, candidate) => (Math.abs(candidate.line - nearLine) < Math.abs(best.line - nearLine) ? candidate : best));
}

export type SummaryLocation = { readonly kind: 'present'; readonly range: SourceRange } | { readonly kind: 'absent'; readonly insertAt: number };

/** Desplazamiento justo después del frontmatter (`---\n…\n---\n`), o 0 si no lo hay. */
export function afterFrontmatter(source: string): number {
  if (!source.startsWith('---\n')) {
    return 0;
  }
  const close = source.indexOf('\n---', 3);
  if (close === -1) {
    return 0;
  }
  const lineEnd = source.indexOf('\n', close + 4);
  return lineEnd === -1 ? source.length : lineEnd + 1;
}

/** El resumen es el cuerpo anterior al primer encabezado; si no existe, dónde insertarlo. */
export function locateSummary(source: string): SummaryLocation {
  const parsed = parseMarkdownDocument(source, 'fuente');
  const leading = parsed.ok ? parsed.document.leading : [];
  const slice = sliceNodes(source, leading);
  const first = leading[0];
  if (slice === undefined || first === undefined) {
    return { kind: 'absent', insertAt: afterFrontmatter(source) };
  }
  const start = spanOf(first).startOffset;
  const end = leading.reduce((offset, node) => Math.max(offset, spanOf(node).endOffset), start);
  return { kind: 'present', range: { start, end, line: slice.line, text: slice.text } };
}

export function replaceRange(source: string, start: number, end: number, text: string): string {
  return `${source.slice(0, start)}${text}${source.slice(end)}`;
}

/** Sustituye (o inserta) el resumen conservando el resto del fichero. */
export function replaceSummary(source: string, location: SummaryLocation, summary: string): string {
  if (location.kind === 'present') {
    return replaceRange(source, location.range.start, location.range.end, summary);
  }
  const before = source.slice(0, location.insertAt);
  const after = source.slice(location.insertAt);
  const separatorBefore = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const separatorAfter = after === '' ? '\n' : after.startsWith('\n') ? '\n' : '\n\n';
  return `${before}${separatorBefore}${summary}${separatorAfter}${after}`;
}
