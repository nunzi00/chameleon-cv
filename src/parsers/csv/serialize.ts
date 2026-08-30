/**
 * La inversa de `csv-parser.ts` (T-8.1, `docs/portability.md` §4.4): tablas deterministas con delimitador
 * `,`, comillas RFC 4180 solo cuando el valor las exige, `|` para los campos multivalor, `\n` y salto
 * final. La columna `id` solo aparece cuando algún id no es el posicional que el parser derivaría.
 */
import type { Certification, Skill } from '../../core/schema';

import { MULTI_VALUE_SEPARATOR } from './table';

export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function serializeCsv(header: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  return `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function cell(value: string | number | undefined): string {
  return value === undefined ? '' : String(value);
}

function multi(values: readonly string[]): string {
  return values.join(MULTI_VALUE_SEPARATOR);
}

function withIds<T extends { readonly id: string }>(items: readonly T[], prefix: string): boolean {
  return items.some((item, index) => item.id !== `${prefix}-${index + 1}`);
}

/** `skills.csv`: `name,category,level,years,aliases,tags[,id]`. */
export function serializeSkills(skills: readonly Skill[]): string {
  const ids = withIds(skills, 'skill');
  const header = ['name', 'category', 'level', 'years', 'aliases', 'tags', ...(ids ? ['id'] : [])];
  const rows = skills.map((skill) => [
    skill.name,
    skill.category,
    cell(skill.level),
    cell(skill.years),
    multi(skill.aliases),
    multi(skill.tags),
    ...(ids ? [skill.id] : []),
  ]);
  return serializeCsv(header, rows);
}

/** `certifications.csv`: `name,issuer,date,url,tags[,id]`. */
export function serializeCertifications(certifications: readonly Certification[]): string {
  const ids = withIds(certifications, 'cert');
  const header = ['name', 'issuer', 'date', 'url', 'tags', ...(ids ? ['id'] : [])];
  const rows = certifications.map((certification) => [
    certification.name,
    cell(certification.issuer),
    cell(certification.date),
    cell(certification.url),
    multi(certification.tags),
    ...(ids ? [certification.id] : []),
  ]);
  return serializeCsv(header, rows);
}
