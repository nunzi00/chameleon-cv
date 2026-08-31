/**
 * `cv import-linkedin <archivo.zip>` (docs/cv-import.md §8): la puerta de la CLI a la exportación oficial de
 * datos de LinkedIn. Lee el zip, escribe el borrador en `import/<nombre>/` y resume por stderr; los códigos de
 * salida siguen el `AppError` (datos/conflicto = 1, entorno = 2), como el resto de la CLI.
 */
import { resolve } from 'node:path';

import { importLinkedInDraft } from '../../app/import-linkedin';
import { describeError } from '../../shared/errors';
import type { CliContext } from '../context';

export const EXIT_OK = 0;

export interface ImportLinkedInOptions {
  readonly name?: string | undefined;
  readonly replace: boolean;
}

export async function runImportLinkedIn(context: CliContext, file: string, options: ImportLinkedInOptions): Promise<number> {
  let bytes: Uint8Array;
  try {
    bytes = await context.datasetFileSystem.readBinaryFile(resolve(context.cwd, file));
  } catch (error) {
    context.stderr(`No se pudo leer ${file}: ${describeError(error)}\n`);
    return 2;
  }
  const result = await importLinkedInDraft(context, bytes, file, { name: options.name, replace: options.replace });
  if (!result.ok) {
    context.stderr(`${result.error.message}\n`);
    return result.error.exitCode;
  }
  const { draft } = result;
  const { profile } = draft;
  context.stderr(
    `Borrador escrito en import/${draft.name} (${draft.files} ficheros): ${profile.experience.length} experiencias · ${profile.projects.length} proyectos · ${profile.education.length} formaciones · ${profile.certifications.length} certificaciones · ${profile.skills.length} habilidades · ${profile.languages.length} idiomas\n`,
  );
  if (draft.issues.length > 0) {
    context.stderr(`Revisa el README.md del borrador: ${draft.issues.length} avisos\n`);
  }
  context.stdout(`import/${draft.name}\n`);
  return EXIT_OK;
}
