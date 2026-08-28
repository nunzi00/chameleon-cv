/**
 * Lectura genérica de un CSV del dataset (`docs/formato-csv.md` §2): cabecera con las
 * claves del esquema, delimitador `,` (o `;` detectado en la cabecera), celdas vacías
 * omitidas, valores múltiples con `|`, y la línea física de cada fila para los errores.
 */
import { parse } from 'csv-parse/sync';

import type { DatasetError } from '../dataset/types';
import { firstLine } from '../shared/text';

export interface TableSpec {
  /** Columnas admitidas (claves del esquema). */
  readonly columns: readonly string[];
  readonly required: readonly string[];
  /** Columnas cuyo valor se divide por `|`. */
  readonly multiValue: readonly string[];
  /** Columnas que se convierten a entero cuando la celda es un número. */
  readonly integer: readonly string[];
}

export interface TableRow {
  readonly values: Record<string, unknown>;
  /** Línea física en la que empieza la fila. */
  readonly line: number;
}

export type TableResult =
  | { readonly ok: true; readonly rows: readonly TableRow[] }
  | { readonly ok: false; readonly errors: readonly DatasetError[] };

export const MULTI_VALUE_SEPARATOR = '|';

interface RawRecord {
  readonly record: readonly string[];
  readonly info: { readonly lines: number };
}

/** `;` solo si la cabecera lo usa y no contiene comas (exportaciones es-ES de Excel/LibreOffice). */
export function detectDelimiter(content: string): ',' | ';' {
  const newline = content.indexOf('\n');
  const header = newline === -1 ? content : content.slice(0, newline);
  return header.includes(';') && !header.includes(',') ? ';' : ',';
}

/** Línea y mensaje de un error de `csv-parse` (o de cualquier otro valor lanzado). */
export function describeCsvError(error: unknown): { line: number | undefined; message: string } {
  const line =
    typeof error === 'object' && error !== null && 'lines' in error && typeof error.lines === 'number' ? error.lines : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return { line, message: firstLine(message) };
}

export function validateHeader(header: readonly string[], spec: TableSpec, file: string): DatasetError[] {
  const errors: DatasetError[] = [];
  const seen = new Set<string>();
  for (const column of header) {
    if (!spec.columns.includes(column)) {
      errors.push({ file, line: 1, message: `Columna «${column}» no reconocida (admitidas: ${spec.columns.join(', ')})` });
    } else if (seen.has(column)) {
      errors.push({ file, line: 1, message: `Columna «${column}» repetida` });
    }
    seen.add(column);
  }
  for (const required of spec.required) {
    if (!seen.has(required)) {
      errors.push({ file, line: 1, message: `Falta la columna obligatoria «${required}»` });
    }
  }
  return errors;
}

function convertCell(cell: string, column: string, spec: TableSpec): unknown {
  if (spec.multiValue.includes(column)) {
    return cell
      .split(MULTI_VALUE_SEPARATOR)
      .map((item) => item.trim())
      .filter((item) => item !== '');
  }
  if (spec.integer.includes(column) && /^\d+$/.test(cell)) {
    return Number(cell);
  }
  return cell;
}

/** Objeto de una fila: una clave por columna con celda no vacía, ya convertida. */
export function buildRow(header: readonly string[], cells: readonly string[], spec: TableSpec): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  header.forEach((column, index) => {
    const cell = cells[index];
    if (cell === undefined || cell === '') {
      return;
    }
    values[column] = convertCell(cell, column, spec);
  });
  return values;
}

function newlinesIn(cells: readonly string[]): number {
  return cells.reduce((count, cell) => count + cell.split('\n').length - 1, 0);
}

export function parseTable(content: string, file: string, spec: TableSpec): TableResult {
  let records: RawRecord[];
  try {
    // Los tipos de csv-parse no reflejan la forma `{ record, info }` que produce `info: true`.
    records = parse(content, {
      bom: true,
      trim: true,
      skip_empty_lines: true,
      info: true,
      relax_column_count: true,
      delimiter: detectDelimiter(content),
    }) as unknown as RawRecord[];
  } catch (error) {
    const { line, message } = describeCsvError(error);
    return { ok: false, errors: [{ file, line, message: `CSV inválido: ${message}` }] };
  }

  const [headerRecord, ...dataRecords] = records;
  if (headerRecord === undefined) {
    return { ok: false, errors: [{ file, line: 1, message: `Falta la cabecera (columnas admitidas: ${spec.columns.join(', ')})` }] };
  }
  const header = headerRecord.record;
  const headerErrors = validateHeader(header, spec, file);
  if (headerErrors.length > 0) {
    return { ok: false, errors: headerErrors };
  }

  const errors: DatasetError[] = [];
  const rows: TableRow[] = [];
  for (const { record, info } of dataRecords) {
    const line = info.lines - newlinesIn(record);
    if (record.length !== header.length) {
      errors.push({ file, line, message: `La fila tiene ${record.length} campos y la cabecera ${header.length}` });
      continue;
    }
    rows.push({ values: buildRow(header, record, spec), line });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, rows };
}
