/**
 * `CsvParser`: plugin `SourceParser` para `.csv` (`docs/formato-csv.md`). Despacha por
 * ruta (`skills.csv`, `certifications.csv`), valida cada fila con el esquema del núcleo
 * y asigna ids posicionales (`skill-<n>`, `cert-<n>`) salvo columna `id` explícita.
 */
import type { z } from 'zod';

import { CertificationSchema, SkillSchema, type Certification, type Skill } from '../../core/schema';
import type { DatasetError, ParseResult, ProfileContribution, Provenance, SourceFile, SourceParser } from '../dataset/types';
import { validateSection } from '../shared/section-validation';
import { parseTable, type TableSpec } from './table';

export interface CsvTable extends TableSpec {
  readonly file: string;
  readonly section: 'skills' | 'certifications';
  readonly idPrefix: string;
  readonly schema: z.ZodType;
  readonly contribute: (items: unknown[]) => ProfileContribution;
}

export const CSV_TABLES: readonly CsvTable[] = [
  {
    file: 'skills.csv',
    section: 'skills',
    idPrefix: 'skill',
    columns: ['name', 'category', 'level', 'years', 'aliases', 'tags', 'id'],
    required: ['name'],
    multiValue: ['aliases', 'tags'],
    integer: ['years'],
    schema: SkillSchema,
    contribute: (items) => ({ skills: items as Skill[] }),
  },
  {
    file: 'certifications.csv',
    section: 'certifications',
    idPrefix: 'cert',
    columns: ['name', 'issuer', 'date', 'url', 'tags', 'id'],
    required: ['name'],
    multiValue: ['tags'],
    integer: [],
    schema: CertificationSchema,
    contribute: (items) => ({ certifications: items as Certification[] }),
  },
];

export function parseCsvTable(table: CsvTable, content: string, file: string): ParseResult {
  const parsed = parseTable(content, file, table);
  if (!parsed.ok) {
    return parsed;
  }
  const errors: DatasetError[] = [];
  const items: unknown[] = [];
  const provenance: Provenance[] = [];
  parsed.rows.forEach((row, index) => {
    const values = { ...row.values };
    if (values['id'] === undefined) {
      values['id'] = `${table.idPrefix}-${index + 1}`;
    }
    const validated = validateSection(table.schema, values, { file, locate: () => row.line });
    if (validated.ok) {
      items.push(validated.value);
      provenance.push({ path: [table.section, index], file, line: row.line });
    } else {
      errors.push(...validated.errors);
    }
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, contribution: table.contribute(items), provenance };
}

export class CsvParser implements SourceParser {
  readonly name = 'csv';
  readonly extensions = ['.csv'];

  parse(file: SourceFile): ParseResult {
    const table = CSV_TABLES.find((candidate) => candidate.file === file.path);
    if (table === undefined) {
      return {
        ok: false,
        errors: [{ file: file.path, message: `Ruta no reconocida para el parser CSV (admitidas: ${CSV_TABLES.map((t) => t.file).join(', ')})` }],
      };
    }
    return parseCsvTable(table, file.content, file.path);
  }
}
