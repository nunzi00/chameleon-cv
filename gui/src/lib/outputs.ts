/** Los ficheros de output/ para la pantalla Salidas: tipo por extensión y orden estable. */
import type { OutputEntry } from './api/types';

export type OutputKind = 'pdf' | 'odt' | 'markdown' | 'review' | 'other';

export interface OutputItem extends OutputEntry {
  readonly kind: OutputKind;
}

export function outputKind(name: string): OutputKind {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) {
    return 'pdf';
  }
  if (lower.endsWith('.odt')) {
    return 'odt';
  }
  if (lower.startsWith('revision-') && lower.endsWith('.md')) {
    return 'review';
  }
  return lower.endsWith('.md') ? 'markdown' : 'other';
}

/** Primero los CV (PDF, ODT y Markdown), después las revisiones y el resto, cada grupo por nombre. */
export function classifyOutputs(entries: readonly OutputEntry[]): readonly OutputItem[] {
  const order: Readonly<Record<OutputKind, number>> = { pdf: 0, odt: 1, markdown: 2, review: 3, other: 4 };
  return entries
    .map((entry) => ({ ...entry, kind: outputKind(entry.name) }))
    .sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name, 'es'));
}

/** Un fichero se muestra como texto si lo es (Markdown, texto plano); un PDF, en el visor. */
export function isTextual(contentType: string): boolean {
  return contentType.startsWith('text/') || contentType.startsWith('application/json');
}
