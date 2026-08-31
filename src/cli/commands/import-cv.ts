/**
 * `cv import-cv <fichero>` (T-8.4b, docs/cv-import.md §2): la puerta de la CLI al núcleo compartido
 * `importCvDraft` — lee el fichero, importa el borrador a `import/<nombre>/` y resume por stderr;
 * los códigos de salida siguen el `AppError` (datos/conflicto = 1, entorno = 2).
 */
import { resolve } from 'node:path';

import { importCvDraft, type ImportCopilotOptions } from '../../app/import-cv';
import { selectCopilotProvider } from '../../app/copilot';
import { IMPORT_MAP_LIMITS, estimateBatch, loadImportMapPrompt } from '../../llm';
import type { CliContext } from '../context';
import { ensureProviderReady } from './remote';

export const EXIT_OK = 0;

export interface ImportCvOptions {
  readonly name?: string | undefined;
  readonly replace: boolean;
  /** Pide al co-piloto que PROPONGA sección para las líneas sin situar (nada se aplica al borrador). */
  readonly copilot?: boolean | undefined;
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  readonly yes?: boolean | undefined;
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

  const result = await importCvDraft(context, bytes, file, { name: options.name, replace: options.replace, ...(copilot === undefined ? {} : { copilot }) });
  if (!result.ok) {
    context.stderr(`${result.error.message}\n`);
    return result.error.exitCode;
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
