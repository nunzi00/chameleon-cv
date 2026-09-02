/**
 * `cv import-cv <fichero>` (T-8.4b, docs/cv-import.md §2): la puerta de la CLI al núcleo compartido
 * `importCvDraft` — lee el fichero, importa el borrador a `import/<nombre>/` y resume por stderr;
 * los códigos de salida siguen el `AppError` (datos/conflicto = 1, entorno = 2).
 */
import { basename, resolve } from 'node:path';

import { importCvDraft, importCvFolder, type ImportCopilotOptions, type ImportedDraft } from '../../app/import-cv';
import { selectCopilotProvider } from '../../app/copilot';
import { IMPORT_MAP_LIMITS, estimateBatch, loadImportMapPrompt } from '../../llm';
import type { CliContext } from '../context';
import { ensureProviderReady } from './remote';

export const EXIT_OK = 0;
/** Fallo de uso o del entorno, como en el resto de la CLI (`src/cli/output.ts`). */
const EXIT_FAILURE = 2;

export interface ImportCvOptions {
  readonly name?: string | undefined;
  readonly replace: boolean;
  /** T-9.14: el argumento es una carpeta y se importan todos los CV que haya en ella. */
  readonly all?: boolean | undefined;
  /** Pide al co-piloto que PROPONGA sección para las líneas sin situar (nada se aplica al borrador). */
  readonly copilot?: boolean | undefined;
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  readonly yes?: boolean | undefined;
}

/** Importa un CV (PDF/DOCX) a un borrador de fuentes; devuelve el código de salida. */
type ImportOneOutcome = { readonly ok: true; readonly draft: ImportedDraft } | { readonly ok: false; readonly message: string; readonly exitCode: number };

/** Leer el fichero e importarlo: el mismo camino para un CV suelto y para cada uno de los de una carpeta (C14). */
async function importOne(context: CliContext, file: string, options: ImportCvOptions, copilot?: ImportCopilotOptions): Promise<ImportOneOutcome> {
  let bytes: Uint8Array;
  try {
    bytes = await context.datasetFileSystem.readBinaryFile(resolve(context.cwd, file));
  } catch (error) {
    return { ok: false, message: `No se pudo leer ${file}: ${error instanceof Error ? error.message : String(error)}`, exitCode: 2 };
  }
  const result = await importCvDraft(context, bytes, file, { name: options.name, replace: options.replace, ...(copilot === undefined ? {} : { copilot }) });
  return result.ok ? { ok: true, draft: result.draft } : { ok: false, message: result.error.message, exitCode: result.error.exitCode };
}

/**
 * Importar una carpeta entera (T-9.14): el bucle vive en el núcleo (`importCvFolder`), porque la web pide lo
 * mismo (C14); aquí queda lo que es de la terminal —las dos combinaciones que no tienen sentido, y la tabla—.
 */
async function runImportAll(context: CliContext, directory: string, options: ImportCvOptions): Promise<number> {
  if (options.copilot === true) {
    context.stderr('--all y --copilot no se combinan: el co-piloto se pide borrador a borrador, con su coste y su confirmación. Importa primero y refina el que te interese con «cv import-cv --copilot».\n');
    return EXIT_FAILURE;
  }
  if (options.name !== undefined) {
    context.stderr('--all importa varios CV, así que --name no aplica: cada borrador toma el nombre de su perfil.\n');
    return EXIT_FAILURE;
  }
  const outcome = await importCvFolder(context, directory, { replace: options.replace });
  if (!outcome.ok) {
    context.stderr(`${outcome.error.message}\n`);
    return outcome.error.exitCode;
  }
  const { total, imported, failed } = outcome.result;
  const rows = imported.map(({ file, draft }) => [
    basename(file),
    `import/${draft.name}`,
    String(draft.profile.experience.length),
    String(draft.profile.education.length),
    String(draft.profile.skills.length),
    String(draft.issues.length),
    String(draft.unparsed.length),
  ]);
  const header = ['Fichero', 'Borrador', 'Exp.', 'Form.', 'Hab.', 'Avisos', 'Sin situar'];
  const widths = header.map((title, column) => rows.reduce((max, row) => Math.max(max, row[column]!.length), title.length));
  const line = (cells: readonly string[]): string => cells.map((cell, column) => (column <= 1 ? cell.padEnd(widths[column]!) : cell.padStart(widths[column]!))).join('  ');
  context.stdout(`${line(header)}\n`);
  for (const row of rows) {
    context.stdout(`${line(row)}\n`);
  }
  for (const failure of failed) {
    context.stderr(`No se pudo importar ${basename(failure.file)}: ${failure.message}\n`);
  }
  context.stderr(`${rows.length} de ${total} CV importados; revisa el README.md de cada borrador\n`);
  return rows.length === 0 ? EXIT_FAILURE : EXIT_OK;
}

export async function runImportCv(context: CliContext, file: string, options: ImportCvOptions): Promise<number> {
  if (options.all === true) {
    return runImportAll(context, file, options);
  }
  let copilot: ImportCopilotOptions | undefined;
  if (options.copilot === true) {
    const selected = await selectCopilotProvider(context, { provider: options.provider, model: options.model });
    if (!selected.ok) {
      context.stderr(`${selected.error.message}\n`);
      return selected.error.exitCode;
    }
    const { provider } = selected;
    const prompt = await loadImportMapPrompt(context.assets);
    context.stderr(`Las líneas sin situar (hasta ${IMPORT_MAP_LIMITS.maxLines}, seudonimizadas) saldrán hacia ${provider.id} (${provider.baseUrl}; modelo ${provider.model}) para PROPONER sección; nada se escribirá sin tu revisión\n`);
    const ready = await ensureProviderReady(
      context,
      provider,
      () =>
        // Se estima el peor caso (el lote lleno): el número real de líneas sin situar no se sabe hasta extraer.
        Promise.resolve(
          estimateBatch(
            [
              [
                { role: 'system', content: prompt },
                { role: 'user', content: 'x'.repeat(IMPORT_MAP_LIMITS.maxText * IMPORT_MAP_LIMITS.maxLines) },
              ],
            ],
            IMPORT_MAP_LIMITS.maxTokens,
          ),
        ),
      options.yes === true,
      false,
    );
    if (ready !== EXIT_OK) {
      return ready;
    }
    copilot = { provider, prompt };
  }

  const result = await importOne(context, file, options, copilot);
  if (!result.ok) {
    context.stderr(`${result.message}\n`);
    return result.exitCode;
  }

  const { draft } = result;
  const { profile } = draft;
  context.stderr(
    `Borrador escrito en import/${draft.name} (${draft.files} ficheros): ${profile.experience.length} experiencias · ${profile.projects.length} proyectos · ${profile.education.length} formaciones · ${profile.certifications.length} certificaciones · ${profile.skills.length} habilidades · ${profile.achievements.length} logros · ${profile.languages.length} idiomas\n`,
  );
  if (draft.backup !== undefined) {
    context.stderr(`El borrador anterior se apartó completo en ${basename(draft.backup)} (no se ha borrado nada)\n`);
  }
  if (draft.proposals.length > 0) {
    context.stderr(`El co-piloto propuso sección para ${draft.proposals.length} línea(s) sin situar: están en el README, sin aplicar\n`);
  }
  if (draft.issues.length > 0 || draft.unparsed.length > 0) {
    context.stderr(`Revisa el README.md del borrador: ${draft.issues.length} avisos y ${draft.unparsed.length} líneas sin situar\n`);
  }
  context.stdout(`import/${draft.name}\n`);
  return EXIT_OK;
}
