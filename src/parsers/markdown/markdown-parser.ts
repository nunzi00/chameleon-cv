/**
 * `MarkdownParser`: plugin `SourceParser` para `.md`. Despacha por ruta dentro del dataset
 * (`profile.md`, `achievements.md`, `<directorio de entidad>/<nombre>.md`).
 */
import { z } from 'zod';

import { AchievementSchema } from '../../core/schema';
import type { DatasetError, ParseResult, Provenance, SourceFile, SourceParser } from '../dataset/types';
import { onlyList, parseMarkdownDocument } from './document';
import { parseAchievementList } from './achievements';
import { entityKindForDirectory, parseEntityFile } from './entities';
import { parseProfileFile } from './profile';
import { createLocator, validateSection } from '../shared/section-validation';

const AchievementsSchema = z.array(AchievementSchema);

/** `achievements.md`: solo una lista de viñetas con los logros transversales (ids `ach-<n>`). */
export function parseAchievementsFile(source: string, file: string): ParseResult {
  const documentResult = parseMarkdownDocument(source, file);
  if (!documentResult.ok) {
    return documentResult;
  }
  const { document } = documentResult;
  const errors: DatasetError[] = [];
  if (document.frontmatter !== undefined) {
    errors.push({ file, line: document.frontmatter.line, message: 'achievements.md no lleva frontmatter' });
  }
  for (const section of document.sections) {
    errors.push({ file, line: section.line, message: `Sección «## ${section.name}» no admitida: achievements.md no lleva secciones` });
  }
  const list = onlyList(document.leading);
  if (list === undefined) {
    errors.push({ file, line: 1, message: 'achievements.md debe contener únicamente una lista de viñetas con los logros' });
  }
  if (errors.length > 0 || list === undefined) {
    return { ok: false, errors };
  }
  const parsed = parseAchievementList(list, source, file, 'ach');
  if (!parsed.ok) {
    return parsed;
  }
  const lines = new Map<string, number>();
  parsed.achievements.forEach((achievement, index) => {
    lines.set(`achievements[${index}]`, achievement.line);
    for (const [key, line] of achievement.lines) {
      lines.set(`achievements[${index}].${key}`, line);
    }
  });
  const validated = validateSection(
    AchievementsSchema,
    parsed.achievements.map((achievement) => achievement.input),
    { file, locate: createLocator(lines, 1), prefix: ['achievements'] },
  );
  if (!validated.ok) {
    return validated;
  }
  const provenance = parsed.achievements.map((achievement, index): Provenance => ({
    path: ['achievements', index],
    file,
    line: achievement.line,
  }));
  return { ok: true, contribution: { achievements: validated.value }, provenance };
}

export class MarkdownParser implements SourceParser {
  readonly name = 'markdown';
  readonly extensions = ['.md'];

  parse(file: SourceFile): ParseResult {
    const separator = file.path.indexOf('/');
    if (separator === -1) {
      if (file.path === 'profile.md') {
        return parseProfileFile(file.content, file.path);
      }
      if (file.path === 'achievements.md') {
        return parseAchievementsFile(file.content, file.path);
      }
      return unrecognized(file.path);
    }
    const directory = file.path.slice(0, separator);
    const name = file.path.slice(separator + 1);
    const kind = entityKindForDirectory(directory);
    if (kind === undefined || name.includes('/') || !name.endsWith('.md')) {
      return unrecognized(file.path);
    }
    return parseEntityFile(kind, name.slice(0, -'.md'.length), file.content, file.path);
  }
}

function unrecognized(path: string): ParseResult {
  return { ok: false, errors: [{ file: path, message: 'Ruta no reconocida para el parser Markdown' }] };
}
