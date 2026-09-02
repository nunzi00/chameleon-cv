/**
 * `cv import-manfred <fichero.json>` (T-9.22, `docs/cv-import.md` §12): la puerta de la CLI al MAC de Manfred.
 * Lee el JSON, escribe el borrador en `import/<nombre>/` y resume por stderr; los códigos de salida siguen el
 * `AppError` (datos/conflicto = 1, entorno = 2), como el resto de la CLI.
 */
import { resolve } from 'node:path';

import { importManfredDraft } from '../../app/import-manfred';
import { describeError } from '../../shared/errors';
import type { CliContext } from '../context';

export const EXIT_OK = 0;

export interface ImportManfredOptions {
  readonly name?: string | undefined;
  readonly replace: boolean;
}

export async function runImportManfred(context: CliContext, file: string, options: ImportManfredOptions): Promise<number> {
  let bytes: Uint8Array;
  try {
    bytes = await context.datasetFileSystem.readBinaryFile(resolve(context.cwd, file));
  } catch (error) {
    context.stderr(`No se pudo leer ${file}: ${describeError(error)}\n`);
    return 2;
  }
  const result = await importManfredDraft(context, bytes, file, { name: options.name, replace: options.replace });
  if (!result.ok) {
    context.stderr(`${result.error.message}\n`);
    return result.error.exitCode;
  }
  const { draft } = result;
  const { profile } = draft;
  context.stderr(
    `Borrador escrito en import/${draft.name} (${draft.files} ficheros): ${profile.experience.length} experiencias · ${profile.projects.length} proyectos · ${profile.education.length} formaciones · ${profile.certifications.length} certificaciones · ${profile.skills.length} habilidades · ${profile.languages.length} idiomas\n`,
  );
  if (draft.backup !== undefined) {
    context.stderr(`El borrador anterior se apartó completo en ${draft.backup.split('/').pop() ?? draft.backup} (no se ha borrado nada)\n`);
  }
  if (draft.issues.length > 0) {
    context.stderr(`Revisa el README.md del borrador: ${draft.issues.length} avisos (lo que el MAC trae y el perfil no guarda va el primero)\n`);
  }
  context.stdout(`import/${draft.name}\n`);
  return EXIT_OK;
}
