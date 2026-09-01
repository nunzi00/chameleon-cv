/**
 * `cv import-cv <fichero>` (T-8.4b, docs/cv-import.md §2): la puerta de la CLI al núcleo compartido
 * `importCvDraft` — lee el fichero, importa el borrador a `import/<nombre>/` y resume por stderr;
 * los códigos de salida siguen el `AppError` (datos/conflicto = 1, entorno = 2).
 */
import { basename, join, resolve } from 'node:path';

import { importCvDraft, type ImportCopilotOptions, type ImportedDraft } from '../../app/import-cv';
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
/** Lo que el importador sabe leer. */
const IMPORTABLE = /\.(?:pdf|docx)$/i;

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

/** Los CV de una carpeta, en orden estable: solo el primer nivel, y solo lo que el importador sabe leer. */
async function cvsIn(context: CliContext, directory: string): Promise<readonly string[] | undefined> {
  let entries;
  try {
    entries = await context.datasetFileSystem.readDirectory(resolve(context.cwd, directory));
  } catch {
    return undefined;
  }
  return entries
    .filter((entry) => entry.kind === 'file' && IMPORTABLE.test(entry.name))
    .map((entry) => join(directory, entry.name))
    .sort((a, b) => a.localeCompare(b, 'es'));
}

/**
 * Importar una carpeta entera (T-9.14). Cada CV va a su propio borrador con el mismo camino de siempre —esto no
 * es un importador aparte, es un bucle— y al final se enseña una tabla comparativa. Es lo que hace falta para
 * mirar un corpus de una vez, y es justo lo que caza regresiones como B-13 o B-14.
 *
 * Un fichero que falla no detiene a los demás: se anota y se sigue, porque lo útil es ver el conjunto.
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
  const files = await cvsIn(context, directory);
  if (files === undefined) {
    context.stderr(`No se pudo leer la carpeta ${directory}\n`);
    return 2;
  }
  if (files.length === 0) {
    context.stderr(`No hay CV que importar en ${directory} (se buscan .pdf y .docx en el primer nivel)\n`);
    return EXIT_FAILURE;
  }
  const rows: string[][] = [];
  const failed: string[] = [];
  for (const file of files) {
    // El borrador toma el nombre del FICHERO, no el del perfil. Al importar un corpus lo normal es que todos los
    // CV sean de la misma persona —lo son, si estás comparando el tuyo— y con el nombre del perfil los seis
    // querrían la misma carpeta y solo entraría el primero. Además así se ve de un vistazo de dónde salió cada uno.
    const outcome = await importOne(context, file, { ...options, name: basename(file).replace(IMPORTABLE, '') });
    if (outcome.ok) {
      const { draft } = outcome;
      const { profile } = draft;
      rows.push([
        basename(file),
        `import/${draft.name}`,
        String(profile.experience.length),
        String(profile.education.length),
        String(profile.skills.length),
        String(draft.issues.length),
        String(draft.unparsed.length),
      ]);
    } else {
      failed.push(`${basename(file)}: ${outcome.message}`);
    }
  }
  const header = ['Fichero', 'Borrador', 'Exp.', 'Form.', 'Hab.', 'Avisos', 'Sin situar'];
  const widths = header.map((title, column) => rows.reduce((max, row) => Math.max(max, row[column]!.length), title.length));
  const line = (cells: readonly string[]): string => cells.map((cell, column) => (column <= 1 ? cell.padEnd(widths[column]!) : cell.padStart(widths[column]!))).join('  ');
  context.stdout(`${line(header)}\n`);
  for (const row of rows) {
    context.stdout(`${line(row)}\n`);
  }
  for (const failure of failed) {
    context.stderr(`No se pudo importar ${failure}\n`);
  }
  context.stderr(`${rows.length} de ${files.length} CV importados; revisa el README.md de cada borrador\n`);
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
  if (draft.proposals.length > 0) {
    context.stderr(`El co-piloto propuso sección para ${draft.proposals.length} línea(s) sin situar: están en el README, sin aplicar\n`);
  }
  if (draft.issues.length > 0 || draft.unparsed.length > 0) {
    context.stderr(`Revisa el README.md del borrador: ${draft.issues.length} avisos y ${draft.unparsed.length} líneas sin situar\n`);
  }
  context.stdout(`import/${draft.name}\n`);
  return EXIT_OK;
}
