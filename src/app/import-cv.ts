/**
 * Importar un CV maquetado (T-8.4b, docs/cv-import.md §2): el núcleo compartido por la CLI (`cv import-cv`)
 * y la API (`POST /import`). Detecta el formato por cabecera (PDF/DOCX), extrae con los mismos límites del
 * producto, estructura de forma determinista y escribe el BORRADOR en `import/<nombre>/` — nunca sobre
 * `data/sources/` — con su `README.md` (informe). Los fallos son `AppError` (datos, conflicto o entorno).
 */
import { basename, dirname, join, resolve } from 'node:path';

import { DEFAULT_PDF_LIMITS } from '../pdf';
import { createItemsRunner, draftFiles, draftReport, extractDocxText, extractItems, itemsWorkerSource, layoutText, qualityWarnings, structureCv, type DraftFiles } from '../import';
import { importMapFragment, runImportMap, type ImportMapLine, type ImportMapProposal } from '../llm/tasks/import-map';
import type { LlmProvider } from '../llm/provider';
import type { MasterProfile } from '../core/schema';
import { describeError } from '../shared/errors';
import type { AppContext } from './context';
import { conflictError, dataError, environmentError, notFoundError, type AppError } from './errors';
import { backupDirectory } from './portability';
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
  /** Con `replace`, la carpeta a la que se apartó el borrador anterior; ausente si no había ninguno. */
  readonly backup?: string | undefined;
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

  // Sustituir es APARTAR y escribir de cero, no escribir encima: un borrador con menos entradas que el anterior
  // dejaba vivos los ficheros sobrantes y `cv build --data import/<nombre>` cargaba la suma de las dos pasadas.
  // Se aparta con el mismo procedimiento que `cv import --replace` (C9: la herramienta no borra tu trabajo, y un
  // borrador ya se puede editar a mano); las copias quedan como `import/<nombre>.<marca>.bak`.
  let backup: string | undefined;
  if (exists) {
    backup = await backupDirectory(context, target);
    try {
      await context.artifactFileSystem.rename(target, backup);
    } catch (error) {
      return { ok: false, error: environmentError(`No se pudo apartar el borrador anterior «import/${name}» como «${basename(backup)}»: ${describeError(error)}`) };
    }
  }

  const readme = draftReport(result, basename(origin), importedAt, proposals);
  try {
    for (const planned of [...result.files, { path: 'README.md', content: readme }]) {
      const destination = resolve(target, planned.path);
      await context.artifactFileSystem.mkdir(dirname(destination));
      await context.artifactFileSystem.writeFile(destination, planned.content, 0o600);
    }
  } catch (error) {
    return { ok: false, error: environmentError(`No se pudo escribir el borrador en import/${name}: ${describeError(error)}`) };
  }

  return { ok: true, draft: { name, files: result.files.length + 1, profile: result.profile, issues: result.issues, unparsed: result.unparsed, readme, proposals, backup } };
}


/** Lo que el importador sabe leer, para elegir qué ficheros de una carpeta son un CV. */
export const IMPORTABLE_CV = /\.(?:pdf|docx)$/i;

/** Una fila de la comparación: el CV, su borrador y los recuentos que deciden cuál merece la pena revisar. */
export interface ImportedFromFolder {
  readonly file: string;
  readonly draft: ImportedDraft;
}

export interface FolderImportResult {
  /** Los CV que había en la carpeta, se importaran o no. */
  readonly total: number;
  readonly imported: readonly ImportedFromFolder[];
  /** Los que fallaron, con su motivo: uno roto no detiene a los demás. */
  readonly failed: ReadonlyArray<{ readonly file: string; readonly message: string }>;
}

export type FolderImportOutcome = { readonly ok: true; readonly result: FolderImportResult } | { readonly ok: false; readonly error: AppError };

/**
 * Importar una carpeta entera (T-9.14). No es un importador aparte: es un bucle sobre el de siempre, y por eso
 * vive aquí y no en la CLI —la web pide exactamente lo mismo (C14)—. Un fichero que falla se anota y se sigue,
 * porque lo útil es ver el conjunto.
 *
 * Cada borrador toma el nombre del **fichero**, no el del perfil: al mirar un corpus lo normal es que todos los
 * CV sean de la misma persona, y con el nombre del perfil todos querrían la misma carpeta y solo entraría el
 * primero. Además así se ve de dónde salió cada uno.
 */
export async function importCvFolder(context: AppContext, directory: string, options: { readonly replace?: boolean | undefined } = {}): Promise<FolderImportOutcome> {
  let entries;
  try {
    entries = await context.datasetFileSystem.readDirectory(resolve(context.cwd, directory));
  } catch {
    return { ok: false, error: notFoundError(`No se pudo leer la carpeta ${directory}`) };
  }
  const files = entries
    .filter((entry) => entry.kind === 'file' && IMPORTABLE_CV.test(entry.name))
    .map((entry) => join(directory, entry.name))
    .sort((a, b) => a.localeCompare(b, 'es'));
  if (files.length === 0) {
    return { ok: false, error: notFoundError(`No hay CV que importar en ${directory} (se buscan .pdf y .docx en el primer nivel)`) };
  }
  const imported: ImportedFromFolder[] = [];
  const failed: Array<{ file: string; message: string }> = [];
  for (const file of files) {
    let bytes: Uint8Array;
    try {
      bytes = await context.datasetFileSystem.readBinaryFile(resolve(context.cwd, file));
    } catch (error) {
      failed.push({ file, message: `No se pudo leer ${file}: ${describeError(error)}` });
      continue;
    }
    const result = await importCvDraft(context, bytes, file, { name: basename(file).replace(IMPORTABLE_CV, ''), replace: options.replace === true });
    if (result.ok) {
      imported.push({ file, draft: result.draft });
    } else {
      failed.push({ file, message: result.error.message });
    }
  }
  return { ok: true, result: { total: files.length, imported, failed } };
}
