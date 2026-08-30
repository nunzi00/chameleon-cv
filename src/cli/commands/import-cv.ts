/**
 * `cv import-cv <fichero>` (T-8.4b, docs/cv-import.md §2): la puerta de la CLI al núcleo compartido
 * `importCvDraft` — lee el fichero, importa el borrador a `import/<nombre>/` y resume por stderr;
 * los códigos de salida siguen el `AppError` (datos/conflicto = 1, entorno = 2).
 */
import { resolve } from 'node:path';

import { importCvDraft } from '../../app/import-cv';
import type { CliContext } from '../context';

export const EXIT_OK = 0;

export interface ImportCvOptions {
  readonly name?: string | undefined;
  readonly replace: boolean;
}

/** Importa un CV (PDF/DOCX) a un borrador de fuentes; devuelve el código de salida. */
export async function runImportCv(context: CliContext, file: string, options: ImportCvOptions): Promise<number> {
  let bytes: Uint8Array;
  try {
    bytes = await context.datasetFileSystem.readBinaryFile(resolve(context.cwd, file));
  } catch (error) {
    context.stderr(`No se pudo leer ${file}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  const result = await importCvDraft(context, bytes, file, options);
  if (!result.ok) {
    context.stderr(`${result.error.message}\n`);
    return result.error.exitCode;
  }

  const { draft } = result;
  const { profile } = draft;
  context.stderr(
    `Borrador escrito en import/${draft.name} (${draft.files} ficheros): ${profile.experience.length} experiencias · ${profile.projects.length} proyectos · ${profile.education.length} formaciones · ${profile.certifications.length} certificaciones · ${profile.skills.length} habilidades · ${profile.achievements.length} logros · ${profile.languages.length} idiomas\n`,
  );
  if (draft.issues.length > 0 || draft.unparsed.length > 0) {
    context.stderr(`Revisa el README.md del borrador: ${draft.issues.length} avisos y ${draft.unparsed.length} líneas sin situar\n`);
  }
  context.stdout(`import/${draft.name}\n`);
  return EXIT_OK;
}
