import type { Node } from 'unist';

export interface SourceSpan {
  readonly startLine: number;
  readonly startOffset: number;
  readonly endOffset: number;
}

/** Posición de un nodo mdast. `remark-parse` siempre la genera; su ausencia es un error de programación. */
export function spanOf(node: Node): SourceSpan {
  const { position } = node;
  if (position === undefined || position.start.offset === undefined || position.end.offset === undefined) {
    throw new Error(`Nodo Markdown «${node.type}» sin posición: el parser debe generar posiciones`);
  }
  return { startLine: position.start.line, startOffset: position.start.offset, endOffset: position.end.offset };
}

/** Texto fuente original de un nodo (no una versión renderizada). */
export function sliceSource(source: string, node: Node): string {
  const span = spanOf(node);
  return source.slice(span.startOffset, span.endOffset);
}
