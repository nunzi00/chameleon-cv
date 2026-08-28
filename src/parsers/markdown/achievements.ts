/**
 * Logros como lista de viñetas (`docs/formato-dataset.md` §7): texto con `#hashtags` al
 * final y una sub-lista opcional de metadatos `clave: valor` (impact, date, id).
 */
import type { List } from 'mdast';
import type { z } from 'zod';

import type { AchievementSchema } from '../../core/schema';
import type { DatasetError } from '../dataset/types';
import { sliceSource, spanOf } from './positions';

export type AchievementInput = z.input<typeof AchievementSchema>;

export interface ParsedAchievement {
  readonly input: AchievementInput;
  /** Línea de la viñeta. */
  readonly line: number;
  /** Línea de cada campo (`text`, `tags`, `id`, `impact`, `date`). */
  readonly lines: ReadonlyMap<string, number>;
}

export type AchievementListResult =
  | { readonly ok: true; readonly achievements: readonly ParsedAchievement[] }
  | { readonly ok: false; readonly errors: readonly DatasetError[] };

type MetadataKey = 'impact' | 'date' | 'id';
const METADATA_KEYS: readonly MetadataKey[] = ['impact', 'date', 'id'];
const TRAILING_HASHTAGS = /(?:^|\s)(?:#\S+)(?:\s+#\S+)*\s*$/;

function isMetadataKey(key: string): key is MetadataKey {
  return METADATA_KEYS.some((candidate) => candidate === key);
}

/** Separa los `#hashtags` finales del texto y une las líneas de continuación con un espacio. */
export function splitTrailingHashtags(raw: string): { text: string; tags: string[] } {
  const collapsed = raw.replace(/\s*\n\s*/g, ' ');
  const match = TRAILING_HASHTAGS.exec(collapsed);
  if (match === null) {
    return { text: collapsed.trim(), tags: [] };
  }
  const tags = match[0]
    .trim()
    .split(/\s+/)
    .map((token) => token.slice(1));
  return { text: collapsed.slice(0, match.index).trimEnd(), tags };
}

function parseMetadata(
  list: List,
  source: string,
  file: string,
  label: string,
  errors: DatasetError[],
): Map<MetadataKey, { value: string; line: number }> | undefined {
  if (list.ordered === true) {
    errors.push({ file, line: spanOf(list).startLine, message: `${label}: los metadatos van en una sub-lista con viñetas «- »` });
    return undefined;
  }
  const entries = new Map<MetadataKey, { value: string; line: number }>();
  let failed = false;
  for (const item of list.children) {
    const line = spanOf(item).startLine;
    const [paragraph, ...rest] = item.children;
    if (paragraph === undefined || paragraph.type !== 'paragraph' || rest.length > 0) {
      errors.push({ file, line, message: `${label}: cada metadato es una línea «clave: valor», sin sub-listas` });
      failed = true;
      continue;
    }
    const raw = sliceSource(source, paragraph);
    const separator = raw.indexOf(':');
    if (separator <= 0) {
      errors.push({ file, line, message: `${label}: metadato mal formado; usa «clave: valor»` });
      failed = true;
      continue;
    }
    const key = raw.slice(0, separator).trim();
    const value = raw.slice(separator + 1).trim();
    if (!isMetadataKey(key)) {
      errors.push({ file, line, message: `${label}: metadato «${key}» no admitido (admitidos: ${METADATA_KEYS.join(', ')})` });
      failed = true;
      continue;
    }
    if (value === '') {
      errors.push({ file, line, message: `${label}: el metadato «${key}» no tiene valor` });
      failed = true;
      continue;
    }
    if (entries.has(key)) {
      errors.push({ file, line, message: `${label}: metadato «${key}» repetido` });
      failed = true;
      continue;
    }
    entries.set(key, { value, line });
  }
  return failed ? undefined : entries;
}

function applyMetadata(input: AchievementInput, key: MetadataKey, value: string): void {
  if (key === 'id') {
    input.id = value;
  } else if (key === 'date') {
    input.date = value;
  } else {
    input.impact = value;
  }
}

/**
 * Convierte una lista de viñetas en logros. Los ids por defecto son posicionales:
 * `<parentId>-<n>` con `n` 1-based.
 */
export function parseAchievementList(list: List, source: string, file: string, parentId: string): AchievementListResult {
  if (list.ordered === true) {
    return {
      ok: false,
      errors: [{ file, line: spanOf(list).startLine, message: 'Los logros se escriben como lista con viñetas «- », no numerada' }],
    };
  }
  const errors: DatasetError[] = [];
  const achievements: ParsedAchievement[] = [];

  list.children.forEach((item, index) => {
    const line = spanOf(item).startLine;
    const label = `Logro ${index + 1}`;
    const [paragraph, metadataList, ...rest] = item.children;
    if (paragraph === undefined || paragraph.type !== 'paragraph') {
      errors.push({ file, line, message: `${label}: la viñeta debe empezar por el texto del logro` });
      return;
    }
    if (rest.length > 0 || (metadataList !== undefined && metadataList.type !== 'list')) {
      errors.push({
        file,
        line,
        message: `${label}: solo se admite un párrafo y, opcionalmente, una sub-lista de metadatos «clave: valor»`,
      });
      return;
    }
    const metadata = metadataList === undefined ? new Map() : parseMetadata(metadataList, source, file, label, errors);
    if (metadata === undefined) {
      return;
    }
    const { text, tags } = splitTrailingHashtags(sliceSource(source, paragraph));
    const input: AchievementInput = { id: `${parentId}-${index + 1}`, text, tags };
    const lines = new Map<string, number>([
      ['text', line],
      ['tags', line],
      ['id', line],
    ]);
    for (const [key, entry] of metadata) {
      applyMetadata(input, key, entry.value);
      lines.set(key, entry.line);
    }
    achievements.push({ input, line, lines });
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, achievements };
}
