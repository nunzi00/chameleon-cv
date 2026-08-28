/**
 * Parsers de fuentes (T-1.2, T-1.3): cargador del dataset y plugins Markdown y CSV.
 */
import { CsvParser } from './csv/csv-parser';
import type { SourceParser } from './dataset/types';
import { MarkdownParser } from './markdown/markdown-parser';

export * from './csv';
export * from './dataset';
export * from './markdown';
export * from './shared/objects';
export * from './shared/section-validation';
export * from './shared/text';

/** Parsers registrados por defecto en la CLI. */
export function defaultSourceParsers(): SourceParser[] {
  return [new MarkdownParser(), new CsvParser()];
}
