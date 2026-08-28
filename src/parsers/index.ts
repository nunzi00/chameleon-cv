/**
 * Parsers de fuentes (T-1.2): cargador del dataset y plugin Markdown.
 */
import type { SourceParser } from './dataset/types';
import { MarkdownParser } from './markdown/markdown-parser';

export * from './dataset';
export * from './markdown';
export * from './shared/objects';

/** Parsers registrados por defecto en la CLI. */
export function defaultSourceParsers(): SourceParser[] {
  return [new MarkdownParser()];
}
