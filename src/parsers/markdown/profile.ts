/**
 * `profile.md` (`docs/formato-dataset.md` §5): frontmatter plano con `meta`, datos personales
 * e idiomas; el cuerpo es el resumen por defecto. No admite secciones.
 */
import { z } from 'zod';

import { LanguageSchema, MASTER_PROFILE_SCHEMA_VERSION, MetaSchema, PersonalSchema } from '../../core/schema';
import type { DatasetError, ParseResult, Provenance } from '../dataset/types';
import { stripEmptyValues } from '../shared/objects';
import { parseMarkdownDocument, sliceNodes } from './document';
import { parseFrontmatter } from './frontmatter';
import { createLocator, validateSection } from '../shared/section-validation';

const META_KEYS = ['schemaVersion', 'locale', 'updatedAt'] as const;

const FORBIDDEN_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['summary', 'el resumen se escribe en el cuerpo del fichero'],
  ['meta', 'usa las claves planas schemaVersion, locale y updatedAt'],
  ['personal', 'los datos personales van como claves planas (fullName, email…)'],
];

const LanguagesSchema = z.array(LanguageSchema);

function isMetaKey(key: string): key is (typeof META_KEYS)[number] {
  return META_KEYS.some((candidate) => candidate === key);
}

/** `schemaVersion` llega como texto (YAML failsafe); solo se convierte si es un entero. */
export function coerceInteger(value: unknown): unknown {
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
}

export function parseProfileFile(source: string, file: string): ParseResult {
  const documentResult = parseMarkdownDocument(source, file);
  if (!documentResult.ok) {
    return documentResult;
  }
  const { document } = documentResult;
  const errors: DatasetError[] = document.sections.map((section) => ({
    file,
    line: section.line,
    message: `Sección «## ${section.name}» no admitida: profile.md no lleva secciones`,
  }));
  if (document.frontmatter === undefined) {
    errors.push({ file, line: 1, message: 'Falta el frontmatter: profile.md debe empezar por un bloque «---» con los datos personales' });
    return { ok: false, errors };
  }
  const frontmatterResult = parseFrontmatter(document.frontmatter.yaml, file, document.frontmatter.line);
  if (!frontmatterResult.ok) {
    return { ok: false, errors: [...errors, ...frontmatterResult.errors] };
  }
  const { data, line: blockLine } = frontmatterResult.frontmatter;
  const lines = new Map(frontmatterResult.frontmatter.lines);
  for (const [key, hint] of FORBIDDEN_KEYS) {
    if (key in data) {
      errors.push({ file, line: lines.get(key), message: `${key}: clave no admitida; ${hint}` });
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const meta: Record<string, unknown> = {};
  const personal: Record<string, unknown> = {};
  let languages: unknown;
  for (const [key, value] of Object.entries(stripEmptyValues(data) as Record<string, unknown>)) {
    if (key === 'languages') {
      languages = value;
    } else if (isMetaKey(key)) {
      meta[key] = key === 'schemaVersion' ? coerceInteger(value) : value;
    } else {
      personal[key] = value;
    }
  }
  if (meta['schemaVersion'] === undefined) {
    meta['schemaVersion'] = MASTER_PROFILE_SCHEMA_VERSION;
  }
  const summary = sliceNodes(source, document.leading);
  if (summary !== undefined) {
    personal['summary'] = summary.text;
    lines.set('summary', summary.line);
  }

  const locate = createLocator(lines, blockLine);
  const metaResult = validateSection(MetaSchema, meta, { file, locate });
  const personalResult = validateSection(PersonalSchema, personal, { file, locate });
  const languagesResult = validateSection(LanguagesSchema, languages ?? [], { file, locate, prefix: ['languages'] });
  if (!metaResult.ok || !personalResult.ok || !languagesResult.ok) {
    return {
      ok: false,
      errors: [
        ...(metaResult.ok ? [] : metaResult.errors),
        ...(personalResult.ok ? [] : personalResult.errors),
        ...(languagesResult.ok ? [] : languagesResult.errors),
      ],
    };
  }

  const provenance: Provenance[] = [
    { path: ['meta'], file, line: blockLine },
    { path: ['personal'], file, line: blockLine },
    ...Object.keys(personal).map((key): Provenance => ({ path: ['personal', key], file, line: lines.get(key) })),
    ...languagesResult.value.map((_, index): Provenance => ({ path: ['languages', index], file, line: lines.get(`languages[${index}]`) })),
  ];
  return {
    ok: true,
    contribution: { meta: metaResult.value, personal: personalResult.value, languages: languagesResult.value },
    provenance,
  };
}
