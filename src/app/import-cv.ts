/**
 * Importar un CV maquetado (T-8.4b, docs/cv-import.md §2): el núcleo compartido por la CLI (`cv import-cv`)
 * y la API (`POST /import`). Detecta el formato por cabecera (PDF/DOCX), extrae con los mismos límites del
 * producto, estructura de forma determinista y escribe el BORRADOR en `import/<nombre>/` — nunca sobre
 * `data/sources/` — con su `README.md` (informe). Los fallos son `AppError` (datos, conflicto o entorno).
 */
import { basename, dirname, resolve } from 'node:path';

import { DEFAULT_PDF_LIMITS } from '../pdf';
import { createItemsRunner, draftFiles, draftReport, extractDocxText, extractItems, itemsWorkerSource, layoutText, qualityWarnings, structureCv, type DraftFiles } from '../import';
import { importMapFragment, runImportMap, type ImportMapLine, type ImportMapProposal } from '../llm/tasks/import-map';
import type { LlmProvider } from '../llm/provider';
import type { MasterProfile } from '../core/schema';
import type { AppContext } from './context';
import { conflictError, dataError, environmentError, type AppError } from './errors';
import { slugify } from './slug';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((byte, index) => bytes[index] === byte);
}

/** El co-piloto propone secciones para las líneas sin situar; nunca escribe en el borrador (C2, docs/cv-import.md §2.2). */
export interface ImportCopilotOptions {
  readonly provider: LlmProvider;
  readonly prompt: string;
  readonly locale?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface ImportCvOptions {
  /** Carpeta destino dentro de `import/`; sin él, el nombre del perfil o del fichero de origen. */
  readonly name?: string | undefined;
  /** Sustituir un borrador existente con el mismo nombre. */
  readonly replace?: boolean | undefined;
  /** Con él, las líneas sin situar se envían al co-piloto para que PROPONGA sección (nada se aplica). */
  readonly copilot?: ImportCopilotOptions | undefined;
}

export interface ImportedDraft {
  /** Carpeta del borrador (`import/<nombre>`). */
  readonly name: string;
  /** Ficheros escritos (README incluido). */
  readonly files: number;
  readonly profile: MasterProfile;
  readonly issues: DraftFiles['issues'];
  readonly unparsed: DraftFiles['unparsed'];
  readonly readme: string;
  /** Propuestas del co-piloto verificadas por código; vacío sin `copilot`. */
  readonly proposals: readonly ImportMapProposal[];
}

export type ImportCvResult = { readonly ok: true; readonly draft: ImportedDraft } | { readonly ok: false; readonly error: AppError };

/** Del fichero (bytes + nombre de origen) al borrador escrito; `origin` solo se usa en mensajes y cabeceras. */
export async function importCvDraft(context: AppContext, bytes: Uint8Array, origin: string, options: ImportCvOptions = {}): Promise<ImportCvResult> {
  let text: string;
  if (startsWith(bytes, PDF_MAGIC)) {
    const extractor = context.itemsExtractor ?? (async (content: Uint8Array) => extractItems(content, DEFAULT_PDF_LIMITS, createItemsRunner(await itemsWorkerSource(context.assets))));
    const items = await extractor(bytes);
    if (!items.ok) {
      const message = `No se pudo extraer el PDF (${items.code}): ${items.message}`;
      return { ok: false, error: items.code === 'invalid' ? dataError(message) : environmentError(message) };
    }
    text = layoutText(items.items);
  } else if (startsWith(bytes, ZIP_MAGIC)) {
    const docx = extractDocxText(bytes);
    if (!docx.ok) {
      return { ok: false, error: dataError(`No se pudo extraer el DOCX: ${docx.message}`) };
    }
    text = docx.text;
  } else {
    return { ok: false, error: dataError(`«${origin}» no es un PDF ni un DOCX (cabecera desconocida); el borrador se importa desde el CV maquetado`) };
  }

  const draft = structureCv(text);
  const importedAt = (context.now?.() ?? new Date()).toISOString();
  const plain = draftFiles(draft);
  // Los avisos de calidad del texto encabezan los del borrador: explican por qué falta lo que falta.
  const entries = plain.profile.experience.length + plain.profile.projects.length + plain.profile.education.length + plain.profile.certifications.length;
  const warnings = [...qualityWarnings({ text, entries }).map((reason) => ({ reason }))];
  const proposals: ImportMapProposal[] = [];
  const unplaced: ImportMapLine[] = plain.unparsed.map((item) => ({ n: item.line, text: item.text })).filter((line) => line.text.trim() !== '');
  if (options.copilot !== undefined && unplaced.length > 0) {
    // Con líneas no vacías el fragmento siempre existe (solo devuelve `undefined` cuando no queda texto que enviar).
    const fragment = importMapFragment(unplaced, { fullName: plain.profile.personal.fullName, locale: options.copilot.locale ?? plain.profile.meta.locale })!;
    const mapped = await runImportMap(options.copilot.provider, fragment, unplaced, options.copilot.prompt, options.copilot.timeoutMs, options.copilot.signal);
    if (mapped.ok) {
      proposals.push(...mapped.proposals);
      if (mapped.rejected > 0) {
        warnings.push({ reason: `el co-piloto propuso ${mapped.rejected} línea(s) que el código rechazó (sección desconocida, línea inexistente o repetida)` });
      }
    } else {
      warnings.push({ reason: `el co-piloto no pudo proponer secciones (${mapped.code}): ${mapped.message}` });
    }
  }
  const result: DraftFiles = { ...plain, issues: [...warnings, ...plain.issues] };

  return writeDraft(context, result, origin, importedAt, proposals, options);
}

/**
 * Del `DraftFiles` ya validado al borrador escrito en `import/<nombre>/`. Compartido por todos los orígenes
 * —PDF, DOCX y la exportación de LinkedIn— para que el destino, el nombre de la carpeta, los permisos y el
 * informe sean exactamente los mismos vengan de donde vengan (C14).
 */
export async function writeDraft(
  context: AppContext,
  result: DraftFiles,
  origin: string,
  importedAt: string,
  proposals: readonly ImportMapProposal[],
  options: Pick<ImportCvOptions, 'name' | 'replace'>,
): Promise<ImportCvResult> {
  // slugify reduce a [a-z0-9-]: el nombre no puede contener separadores ni «..», así que siempre queda dentro de import/.
  // Sin nombre reconocido el perfil lleva «Nombre pendiente» (T-9.1): la carpeta se nombra por el fichero, no por el aviso.
  const recognized = result.profile.personal.fullName === 'Nombre pendiente' ? undefined : result.profile.personal.fullName;
  const name = slugify(options.name ?? recognized ?? '') || slugify(basename(origin).replace(/\.[a-z0-9]+$/i, '')) || 'cv-importado';
  const root = resolve(context.cwd, 'import');
  const target = resolve(root, name);
  let exists = false;
  try {
    await context.datasetFileSystem.stat(target);
    exists = true;
  } catch {
    exists = false;
  }
  if (exists && options.replace !== true) {
    return { ok: false, error: conflictError(`Ya existe import/${name}; usa --replace para sustituirlo o --name para otro destino`) };
  }

  const readme = draftReport(result, basename(origin), importedAt, proposals);
  try {
    for (const planned of [...result.files, { path: 'README.md', content: readme }]) {
      const destination = resolve(target, planned.path);
      await context.artifactFileSystem.mkdir(dirname(destination));
      await context.artifactFileSystem.writeFile(destination, planned.content, 0o600);
    }
  } catch (error) {
    return { ok: false, error: environmentError(`No se pudo escribir el borrador en import/${name}: ${error instanceof Error ? error.message : String(error)}`) };
  }

  return { ok: true, draft: { name, files: result.files.length + 1, profile: result.profile, issues: result.issues, unparsed: result.unparsed, readme, proposals } };
}
