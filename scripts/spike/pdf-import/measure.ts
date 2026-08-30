/**
 * Medición del spike (T-8.4, docs/pdf-import-spike.md §4.3): para cada PDF del corpus y cada candidato —P1 (texto del
 * extractor del producto + heurística), P3 (items con coordenadas → texto reordenado + la misma heurística) y P2 (texto
 * + co-piloto local guiado por el esquema, verificado por código)— la tarjeta frente a la verdad y la tabla Markdown
 * generada. Los PDF sin verdad (grupo C) se registran con el resultado del extractor.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { parseMasterProfile, type MasterProfile } from '../../../src/core/schema';
import { selectProvider, type LlmProvider } from '../../../src/llm';
import { extractPdfText } from '../../../src/pdf';
import { CORPUS_ROOT, readCorpus, type CorpusEntry } from './corpus';
import { extractItems } from './items';
import { layoutText } from './layout';
import { markdownTable, score, textCoverage, type Row } from './metrics';
import { structureWithModel } from './model';
import { structureCv, type DraftProfile } from './structure';

export type Candidate = 'p1' | 'p2' | 'p3';
export const CANDIDATES: readonly Candidate[] = ['p1', 'p2', 'p3'];

export interface LimitRow {
  readonly name: string;
  readonly outcome: string;
  readonly milliseconds: number;
}

export interface Measurement {
  readonly candidate: Candidate;
  readonly rows: Row[];
  readonly limits: LimitRow[];
  /** Dos ejecuciones idénticas sobre la misma entrada (P1/P3 siempre; P2 con semilla fija, según el servidor). */
  readonly deterministic: boolean;
  /** P2: textos descartados por no estar en el CV, sumados. */
  readonly dropped: { entries: number; achievements: number; fields: number };
}

export interface MeasureOptions {
  readonly only?: string | undefined;
  readonly limit?: number | undefined;
  readonly provider?: LlmProvider | undefined;
  readonly log?: ((line: string) => void) | undefined;
}

/** El co-piloto local para P2: `CHAMELEON_LLM_BASE_URL`/`CHAMELEON_LLM_MODEL` o el llama-server de la máquina de referencia. */
export async function localProvider(env: NodeJS.ProcessEnv = process.env): Promise<LlmProvider> {
  const selection = await selectProvider(
    { provider: 'openai-compatible' },
    { env: { CHAMELEON_LLM_BASE_URL: env['CHAMELEON_LLM_BASE_URL'] ?? 'http://127.0.0.1:8080', CHAMELEON_LLM_MODEL: env['CHAMELEON_LLM_MODEL'] ?? 'qwen2.5:7b-instruct' } },
  );
  if (!selection.ok) {
    throw new Error(selection.message);
  }
  return selection.provider;
}

interface Structured {
  readonly draft: DraftProfile;
  readonly again: DraftProfile | undefined;
  readonly milliseconds: number;
  readonly dropped: { entries: number; achievements: number; fields: number };
  readonly text: string;
  /** P2: la respuesta del modelo tal cual, antes de la verificación (para el análisis de errores). */
  readonly raw?: unknown;
}

/** Borradores por candidato y PDF, para el análisis de errores: `build/spike/pdf-import/drafts/<candidato>/<grupo>-<nombre>.json`. */
export function draftsPath(candidate: Candidate, entry: CorpusEntry): string {
  return join(CORPUS_ROOT, '..', 'drafts', candidate, `${entry.group}-${entry.name}.json`);
}

async function structure(candidate: Candidate, bytes: Uint8Array, text: string, provider: LlmProvider | undefined): Promise<Structured | { readonly error: string }> {
  const none = { entries: 0, achievements: 0, fields: 0 };
  if (candidate === 'p1') {
    const started = Date.now();
    const draft = structureCv(text);
    return { draft, again: structureCv(text), milliseconds: Date.now() - started, dropped: none, text };
  }
  if (candidate === 'p3') {
    const started = Date.now();
    const items = await extractItems(bytes);
    if (!items.ok) {
      return { error: `${items.code}: ${items.message}` };
    }
    const laid = layoutText(items.items);
    const draft = structureCv(laid);
    return { draft, again: structureCv(laid), milliseconds: Date.now() - started, dropped: none, text: laid };
  }
  if (provider === undefined) {
    return { error: 'P2 exige un proveedor local' };
  }
  const first = await structureWithModel(provider, text);
  if (!first.ok) {
    return { error: first.message };
  }
  return { draft: first.draft, again: undefined, milliseconds: first.elapsedMs, dropped: first.dropped, text, raw: first.raw };
}

export async function measureEntry(entry: CorpusEntry, candidate: Candidate, provider: LlmProvider | undefined): Promise<{ readonly row: Row | undefined; readonly limit: LimitRow | undefined; readonly deterministic: boolean; readonly dropped: Structured['dropped'] }> {
  const none = { entries: 0, achievements: 0, fields: 0 };
  const bytes = readFileSync(entry.pdf);
  const started = Date.now();
  const extracted = await extractPdfText(bytes);
  const extractionMs = Date.now() - started;
  const name = `${entry.group}/${entry.name}`;
  if (!extracted.ok) {
    return { row: undefined, limit: { name, outcome: `${extracted.code}: ${extracted.message}`, milliseconds: extractionMs }, deterministic: true, dropped: none };
  }
  if (entry.truth === undefined) {
    return { row: undefined, limit: { name, outcome: `texto extraído (${extracted.pages} páginas, ${extracted.text.length} caracteres)`, milliseconds: extractionMs }, deterministic: true, dropped: none };
  }
  const truth: MasterProfile = parseMasterProfile(JSON.parse(readFileSync(entry.truth, 'utf8')));
  const structured = await structure(candidate, bytes, extracted.text, provider);
  if ('error' in structured) {
    return { row: undefined, limit: { name, outcome: `${candidate}: ${structured.error}`, milliseconds: extractionMs }, deterministic: true, dropped: none };
  }
  const target = draftsPath(candidate, entry);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify({ text: structured.text, draft: structured.draft, raw: structured.raw }, null, 1));
  return {
    row: { name, candidate, coverage: textCoverage(truth, structured.text), card: score(truth, structured.draft), milliseconds: extractionMs + structured.milliseconds },
    limit: undefined,
    deterministic: structured.again === undefined || JSON.stringify(structured.draft) === JSON.stringify(structured.again),
    dropped: structured.dropped,
  };
}

export async function measure(candidate: Candidate, entries: readonly CorpusEntry[] = readCorpus(), options: MeasureOptions = {}): Promise<Measurement> {
  const selected = entries.filter((entry) => options.only === undefined || entry.group === options.only || `${entry.group}/${entry.name}`.startsWith(options.only)).slice(0, options.limit ?? entries.length);
  const provider = candidate === 'p2' ? (options.provider ?? (await localProvider())) : undefined;
  const rows: Row[] = [];
  const limits: LimitRow[] = [];
  const dropped = { entries: 0, achievements: 0, fields: 0 };
  let deterministic = true;
  for (const entry of selected) {
    const result = await measureEntry(entry, candidate, provider);
    if (result.row !== undefined) {
      rows.push(result.row);
    }
    if (result.limit !== undefined) {
      limits.push(result.limit);
    }
    deterministic = deterministic && result.deterministic;
    dropped.entries += result.dropped.entries;
    dropped.achievements += result.dropped.achievements;
    dropped.fields += result.dropped.fields;
    options.log?.(`${candidate} ${entry.group}/${entry.name}: ${result.row === undefined ? result.limit?.outcome : `${result.row.milliseconds} ms`}`);
  }
  return { candidate, rows, limits, deterministic, dropped };
}

export function limitsTable(limits: readonly LimitRow[]): string {
  return ['| PDF | Resultado | ms |', '|---|---|---|', ...limits.map((limit) => `| ${limit.name} | ${limit.outcome} | ${limit.milliseconds} |`)].join('\n');
}

export function report(measurement: Measurement): string {
  const lines = [
    `## Resultados (${measurement.candidate})`,
    '',
    markdownTable(measurement.rows),
    '',
    `Determinismo: ${measurement.deterministic ? 'dos ejecuciones idénticas en todos los PDF' : 'DIFERENCIAS entre ejecuciones'}.`,
  ];
  if (measurement.candidate === 'p2') {
    lines.push('', `Descartado por no estar en el texto (verificación por código): ${measurement.dropped.entries} entradas, ${measurement.dropped.achievements} logros, ${measurement.dropped.fields} campos.`);
  }
  lines.push('', '## Casos límite y fallos', '', limitsTable(measurement.limits), '');
  return lines.join('\n');
}

/** Tabla comparativa: campos prefijados y logros inventados por PDF y candidato. */
export function compareTable(measurements: readonly Measurement[]): string {
  const names = [...new Set(measurements.flatMap((measurement) => measurement.rows.map((row) => row.name)))];
  const header = `| PDF | ${measurements.map((measurement) => `${measurement.candidate} prefijado | ${measurement.candidate} inventados`).join(' | ')} |`;
  const separator = `|---|${measurements.map(() => '---|---').join('|')}|`;
  const lines = names.map((name) => {
    const cells = measurements.map((measurement) => {
      const row = measurement.rows.find((candidate) => candidate.name === name);
      if (row === undefined) {
        return 'fallo | —';
      }
      const { prefilled } = row.card;
      return `${Math.round((100 * prefilled.hit) / prefilled.total)} % (${prefilled.hit}/${prefilled.total}) | ${row.card.experience.inventedAchievements + row.card.projects.inventedAchievements}`;
    });
    return `| ${name} | ${cells.join(' | ')} |`;
  });
  return [header, separator, ...lines].join('\n');
}
