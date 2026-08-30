/**
 * Medición del spike (T-8.4, docs/pdf-import-spike.md §4.3): para cada PDF del corpus, P0 (texto extraído por el
 * worker contenido del producto) y P1 (estructurador heurístico) frente a la verdad; tablas Markdown generadas,
 * nunca escritas a mano. Los PDF sin verdad (grupo C) se registran con el resultado del extractor.
 */
import { readFileSync } from 'node:fs';

import { parseMasterProfile, type MasterProfile } from '../../../src/core/schema';
import { extractPdfText } from '../../../src/pdf';
import { readCorpus, type CorpusEntry } from './corpus';
import { markdownTable, score, textCoverage, type Row } from './metrics';
import { structureCv, type DraftProfile } from './structure';

export type Candidate = 'p1';

export interface LimitRow {
  readonly name: string;
  readonly outcome: string;
  readonly milliseconds: number;
}

export interface Measurement {
  readonly rows: Row[];
  readonly limits: LimitRow[];
  /** Dos ejecuciones idénticas de P1 sobre el mismo texto (determinismo). */
  readonly deterministic: boolean;
}

export function candidateDraft(candidate: Candidate, text: string): DraftProfile {
  switch (candidate) {
    case 'p1':
      return structureCv(text);
  }
}

export async function measureEntry(entry: CorpusEntry, candidate: Candidate): Promise<{ readonly row: Row | undefined; readonly limit: LimitRow | undefined; readonly deterministic: boolean }> {
  const bytes = readFileSync(entry.pdf);
  const started = Date.now();
  const extracted = await extractPdfText(bytes);
  const extractionMs = Date.now() - started;
  if (!extracted.ok) {
    return { row: undefined, limit: { name: `${entry.group}/${entry.name}`, outcome: `${extracted.code}: ${extracted.message}`, milliseconds: extractionMs }, deterministic: true };
  }
  if (entry.truth === undefined) {
    return { row: undefined, limit: { name: `${entry.group}/${entry.name}`, outcome: `texto extraído (${extracted.pages} páginas, ${extracted.text.length} caracteres)`, milliseconds: extractionMs }, deterministic: true };
  }
  const truth: MasterProfile = parseMasterProfile(JSON.parse(readFileSync(entry.truth, 'utf8')));
  const structuringStarted = Date.now();
  const draft = candidateDraft(candidate, extracted.text);
  const structuringMs = Date.now() - structuringStarted;
  const again = candidateDraft(candidate, extracted.text);
  return {
    row: { name: `${entry.group}/${entry.name}`, candidate, coverage: textCoverage(truth, extracted.text), card: score(truth, draft), milliseconds: extractionMs + structuringMs },
    limit: undefined,
    deterministic: JSON.stringify(draft) === JSON.stringify(again),
  };
}

export async function measure(candidate: Candidate, entries: readonly CorpusEntry[] = readCorpus()): Promise<Measurement> {
  const rows: Row[] = [];
  const limits: LimitRow[] = [];
  let deterministic = true;
  for (const entry of entries) {
    const result = await measureEntry(entry, candidate);
    if (result.row !== undefined) {
      rows.push(result.row);
    }
    if (result.limit !== undefined) {
      limits.push(result.limit);
    }
    deterministic = deterministic && result.deterministic;
  }
  return { rows, limits, deterministic };
}

export function limitsTable(limits: readonly LimitRow[]): string {
  return ['| PDF | Resultado del extractor | ms |', '|---|---|---|', ...limits.map((limit) => `| ${limit.name} | ${limit.outcome} | ${limit.milliseconds} |`)].join('\n');
}

export function report(measurement: Measurement): string {
  return [
    `## Resultados (${measurement.rows[0]?.candidate ?? 'sin filas'})`,
    '',
    markdownTable(measurement.rows),
    '',
    `Determinismo del estructurador: ${measurement.deterministic ? 'dos ejecuciones idénticas en todos los PDF' : 'DIFERENCIAS entre ejecuciones'}.`,
    '',
    '## Casos límite',
    '',
    limitsTable(measurement.limits),
    '',
  ].join('\n');
}
