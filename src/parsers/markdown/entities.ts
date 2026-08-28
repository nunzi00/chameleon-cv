/**
 * Ficheros de entidad (`docs/formato-dataset.md` §4 y §8): frontmatter con las claves del
 * esquema (más los azúcares `start`/`end`, `id` por nombre de fichero) y cuerpo con el
 * resumen y la sección `## Logros`.
 */
import type { z } from 'zod';

import {
  EducationSchema,
  ExperienceSchema,
  ProjectSchema,
  SpecialtySchema,
  type Education,
  type Experience,
  type Project,
  type Specialty,
} from '../../core/schema';
import type { EntityDirectory } from '../dataset/layout';
import type { DatasetError, ParseResult, ProfileContribution, Provenance } from '../dataset/types';
import { stripEmptyValues } from '../shared/objects';
import { parseAchievementList, type ParsedAchievement } from './achievements';
import { onlyList, parseMarkdownDocument, sliceNodes, type DocumentSection } from './document';
import { parseFrontmatter } from './frontmatter';
import { createLocator, validateSection } from '../shared/section-validation';

export interface EntityKind {
  readonly directory: EntityDirectory;
  readonly section: 'specialties' | 'experience' | 'projects' | 'education';
  /** Prefijo del id por defecto; `undefined` = el id es el nombre del fichero y `id:` está prohibido. */
  readonly idPrefix: string | undefined;
  readonly hasDates: boolean;
  readonly allowsAchievements: boolean;
  readonly schema: z.ZodType;
  readonly contribute: (item: unknown) => ProfileContribution;
}

export const ENTITY_KINDS: readonly EntityKind[] = [
  {
    directory: 'specialties',
    section: 'specialties',
    idPrefix: undefined,
    hasDates: false,
    allowsAchievements: false,
    schema: SpecialtySchema,
    contribute: (item) => ({ specialties: [item as Specialty] }),
  },
  {
    directory: 'experience',
    section: 'experience',
    idPrefix: 'exp',
    hasDates: true,
    allowsAchievements: true,
    schema: ExperienceSchema,
    contribute: (item) => ({ experience: [item as Experience] }),
  },
  {
    directory: 'projects',
    section: 'projects',
    idPrefix: 'proj',
    hasDates: true,
    allowsAchievements: true,
    schema: ProjectSchema,
    contribute: (item) => ({ projects: [item as Project] }),
  },
  {
    directory: 'education',
    section: 'education',
    idPrefix: 'edu',
    hasDates: true,
    allowsAchievements: false,
    schema: EducationSchema,
    contribute: (item) => ({ education: [item as Education] }),
  },
];

export function entityKindForDirectory(directory: string): EntityKind | undefined {
  return ENTITY_KINDS.find((kind) => kind.directory === directory);
}

const FORBIDDEN_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['summary', 'el resumen se escribe en el cuerpo del fichero, antes del primer encabezado'],
  ['achievements', 'los logros se escriben en la sección «## Logros»'],
  ['dates', 'usa las claves planas «start» y «end»'],
];

const ACHIEVEMENTS_SECTION = /^(?:logros|achievements)$/i;

interface CollectedAchievements {
  readonly items: readonly ParsedAchievement[];
  readonly line: number;
}

function collectAchievements(
  kind: EntityKind,
  sections: readonly DocumentSection[],
  source: string,
  file: string,
  parentId: string,
  errors: DatasetError[],
): CollectedAchievements | undefined {
  let collected: CollectedAchievements | undefined;
  for (const section of sections) {
    if (!ACHIEVEMENTS_SECTION.test(section.name)) {
      errors.push({ file, line: section.line, message: `Sección «## ${section.name}» no reconocida (admitida: ## Logros)` });
      continue;
    }
    if (!kind.allowsAchievements) {
      errors.push({ file, line: section.line, message: 'Esta entidad no admite la sección «## Logros»' });
      continue;
    }
    if (collected !== undefined) {
      errors.push({ file, line: section.line, message: 'La sección «## Logros» solo puede aparecer una vez' });
      continue;
    }
    const list = onlyList(section.nodes);
    if (list === undefined) {
      errors.push({ file, line: section.line, message: 'La sección «## Logros» debe contener únicamente una lista de viñetas' });
      continue;
    }
    const parsed = parseAchievementList(list, source, file, parentId);
    if (parsed.ok) {
      collected = { items: parsed.achievements, line: section.line };
    } else {
      errors.push(...parsed.errors);
    }
  }
  return collected;
}

function copyLine(lines: Map<string, number>, from: string, to: string): void {
  const line = lines.get(from);
  if (line !== undefined) {
    lines.set(to, line);
  }
}

const DATE_PATH_ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^dates\.start:/, 'start:'],
  [/^dates\.end:/, 'end:'],
  [/^dates:/, 'start:'],
];

/** El usuario escribe `start`/`end`; los mensajes no deben hablar de `dates.start`. */
export function aliasDatePaths(error: DatasetError): DatasetError {
  for (const [pattern, replacement] of DATE_PATH_ALIASES) {
    if (pattern.test(error.message)) {
      return { ...error, message: error.message.replace(pattern, replacement) };
    }
  }
  return error;
}

export function parseEntityFile(kind: EntityKind, fileName: string, source: string, file: string): ParseResult {
  const documentResult = parseMarkdownDocument(source, file);
  if (!documentResult.ok) {
    return documentResult;
  }
  const { document } = documentResult;
  if (document.frontmatter === undefined) {
    return {
      ok: false,
      errors: [{ file, line: 1, message: 'Falta el frontmatter: el fichero debe empezar por un bloque «---» con los datos de la entidad' }],
    };
  }
  const frontmatterResult = parseFrontmatter(document.frontmatter.yaml, file, document.frontmatter.line);
  if (!frontmatterResult.ok) {
    return frontmatterResult;
  }
  const { data, line: blockLine } = frontmatterResult.frontmatter;
  const lines = new Map(frontmatterResult.frontmatter.lines);
  const errors: DatasetError[] = [];

  for (const [key, hint] of FORBIDDEN_KEYS) {
    if (key in data) {
      errors.push({ file, line: lines.get(key), message: `${key}: clave no admitida; ${hint}` });
    }
  }
  if (kind.idPrefix === undefined && 'id' in data) {
    errors.push({ file, line: lines.get('id'), message: 'id: clave no admitida; el id de una especialidad es el nombre del fichero' });
  }
  if (!kind.hasDates) {
    for (const key of ['start', 'end']) {
      if (key in data) {
        errors.push({ file, line: lines.get(key), message: `${key}: clave no admitida; esta entidad no lleva fechas` });
      }
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const { start, end, ...input } = stripEmptyValues(data) as Record<string, unknown>;
  if (start !== undefined) {
    input['dates'] = end === undefined ? { start } : { start, end };
    copyLine(lines, 'start', 'dates');
    copyLine(lines, 'start', 'dates.start');
    copyLine(lines, 'end', 'dates.end');
  } else if (end !== undefined) {
    return { ok: false, errors: [{ file, line: lines.get('end'), message: 'end: no se admite una fecha de fin sin fecha de inicio (start)' }] };
  }
  if (input['id'] === undefined) {
    input['id'] = kind.idPrefix === undefined ? fileName : `${kind.idPrefix}-${fileName}`;
    lines.set('id', blockLine);
  }
  const summary = sliceNodes(source, document.leading);
  if (summary !== undefined) {
    input['summary'] = summary.text;
    lines.set('summary', summary.line);
  }

  const achievements = collectAchievements(kind, document.sections, source, file, String(input['id']), errors);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  if (achievements !== undefined) {
    input['achievements'] = achievements.items.map((achievement) => achievement.input);
    lines.set('achievements', achievements.line);
    achievements.items.forEach((achievement, index) => {
      lines.set(`achievements[${index}]`, achievement.line);
      for (const [key, line] of achievement.lines) {
        lines.set(`achievements[${index}].${key}`, line);
      }
    });
  }

  const validated = validateSection(kind.schema, input, { file, locate: createLocator(lines, blockLine) });
  if (!validated.ok) {
    return { ok: false, errors: validated.errors.map(aliasDatePaths) };
  }

  const provenance: Provenance[] = [{ path: [kind.section, 0], file, line: lines.get('id') }];
  for (const key of Object.keys(input)) {
    provenance.push({ path: [kind.section, 0, key], file, line: lines.get(key) });
  }
  achievements?.items.forEach((achievement, index) => {
    provenance.push({ path: [kind.section, 0, 'achievements', index], file, line: achievement.line });
    for (const [key, line] of achievement.lines) {
      provenance.push({ path: [kind.section, 0, 'achievements', index, key], file, line });
    }
  });
  return { ok: true, contribution: kind.contribute(validated.value), provenance };
}
