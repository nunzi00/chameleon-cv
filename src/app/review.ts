/**
 * Revisiones del co-piloto (T-4.7, docs/api-headless.md §5): aplicar a las fuentes lo marcado `[x]` —la
 * única escritura en `data/sources` que hace el producto (canon C9: acción explícita del usuario)— con
 * cuatro garantías (solo lo marcado; cambio mínimo; copia `.bak` nunca sobrescrita; huella comprobada), y
 * listar y leer las revisiones de `output/` para los clientes.
 *
 * Y qué hacer con una revisión **después** (T-9.24): archivarla —apartarla a `revisiones-archivadas/` sin
 * borrarla, que es lo que le pasa sola a la que ya no deja nada pendiente— o eliminarla. Deshacer lo que
 * escribió vive en `review-undo.ts`, sobre el histórico de fuentes.
 */
import { basename, dirname, relative, resolve } from 'node:path';

import { fingerprint, parseReview, type ParsedReview, type ParsedReviewItem, type ReviewSource, type ReviewTask } from '../llm';
import { locateAchievementText, locateSummary, replaceRange, replaceSummary } from '../parsers';
import { describeError } from '../shared/errors';
import type { AppContext } from './context';
import { DEFAULT_DATA_DIR } from './defaults';
import { dataError, environmentError, unsafePathError, type AppError } from './errors';
import { isSafeSourcePath } from './paths';
import { isMissingFile } from '../artifact';
import { contentHash } from './sources';
import { historyVersionPath, recordSourceVersions, type SourceHistoryEntry } from './source-history';

/** Los ficheros de fuentes contienen datos personales: solo el propietario puede leerlos. */
export const SOURCE_MODE = 0o600;
export const REVIEW_NAME = /^revision-[\w.-]+\.md$/;

/**
 * Dónde se apartan las revisiones archivadas: un subdirectorio del propio directorio de salida, como el
 * histórico de fuentes. Así `listReviews` deja de verlas sin más —solo mira ficheros del primer nivel— y
 * siguen a la vista de quien abra la carpeta.
 */
export const REVIEW_ARCHIVE_DIRNAME = 'revisiones-archivadas';

export function reviewArchiveRoot(cwd: string, directory: string): string {
  return resolve(cwd, directory, REVIEW_ARCHIVE_DIRNAME);
}

/** `x.bak`; si ya existe, `x.bak.1`, `x.bak.2`…: una copia anterior nunca se sobrescribe. */
export async function backupPath(context: Pick<AppContext, 'datasetFileSystem'>, path: string): Promise<string> {
  const exists = async (candidate: string): Promise<boolean> => {
    try {
      await context.datasetFileSystem.stat(candidate);
      return true;
    } catch {
      return false;
    }
  };
  let candidate = `${path}.bak`;
  for (let attempt = 1; await exists(candidate); attempt += 1) {
    candidate = `${path}.bak.${attempt}`;
  }
  return candidate;
}

interface PlannedEdit {
  readonly id: string;
  readonly start: number;
  readonly text: string;
  readonly apply: (content: string) => string;
}

interface PlannedFile {
  readonly path: string;
  readonly content: string;
  readonly edits: PlannedEdit[];
}

/**
 * Tres desenlaces, no dos: además de «se puede escribir» y «algo no cuadra», está **«ya está aplicada»**. Es el
 * caso más probable cuando el original no aparece —lo normal es haber aplicado la revisión antes, no haber
 * editado la fuente a mano—, y tratarlo como un error decía justo lo contrario de lo que pasaba (encontrado por
 * el PO el 1-sep, aplicando una revisión por segunda vez).
 */
type EditPlan =
  | { readonly kind: 'edit'; readonly edit: PlannedEdit }
  | { readonly kind: 'already' }
  | { readonly kind: 'error'; readonly message: string };

function planEdit(task: ReviewTask, item: ParsedReviewItem, source: ReviewSource, text: string, content: string): EditPlan {
  if (task === 'improve') {
    const range = locateAchievementText(content, item.original, source.line);
    if (range === undefined) {
      // Si lo que hay en la fuente es exactamente la propuesta, esta revisión ya se aplicó: no hay nada roto.
      return locateAchievementText(content, text, source.line) === undefined
        ? { kind: 'error', message: `el logro original no está tal cual en ${source.file} (¿editado a mano?)` }
        : { kind: 'already' };
    }
    const current = fingerprint(range.text);
    if (current !== source.hash) {
      return { kind: 'error', message: `el original cambió desde la revisión (huella ${current} ≠ ${source.hash})` };
    }
    return { kind: 'edit', edit: { id: item.id, start: range.start, text, apply: (updated) => replaceRange(updated, range.start, range.end, text) } };
  }
  const location = locateSummary(content);
  const present = location.kind === 'present' ? location.range.text : '';
  const current = fingerprint(present);
  if (current !== source.hash) {
    return present.trim() === text.trim() ? { kind: 'already' } : { kind: 'error', message: `el resumen de ${source.file} cambió desde la revisión (huella ${current} ≠ ${source.hash})` };
  }
  return { kind: 'edit', edit: { id: item.id, start: location.kind === 'present' ? location.range.start : location.insertAt, text, apply: (updated) => replaceSummary(updated, location, text) } };
}

/** Las ediciones de un fichero, aplicadas de atrás hacia delante para que los tramos anteriores no se muevan. */
function applyEdits(planned: PlannedFile): string {
  let content = planned.content;
  for (const edit of [...planned.edits].sort((a, b) => b.start - a.start)) {
    content = edit.apply(content);
  }
  return content;
}

/** `revision-x.md`; si ya hay una así en el destino, `revision-x-2.md`, `revision-x-3.md`…: nada se sobrescribe. */
async function freeReviewPath(context: Pick<AppContext, 'datasetFileSystem'>, path: string): Promise<string> {
  const exists = async (candidate: string): Promise<boolean> => {
    try {
      await context.datasetFileSystem.stat(candidate);
      return true;
    } catch {
      return false;
    }
  };
  const base = path.replace(/\.md$/, '');
  let candidate = path;
  for (let attempt = 2; await exists(candidate); attempt += 1) {
    candidate = `${base}-${attempt}.md`;
  }
  return candidate;
}

/** Mueve un fichero de revisión a otro directorio (se crea si falta) y devuelve dónde quedó. */
async function moveReview(context: Pick<AppContext, 'datasetFileSystem' | 'artifactFileSystem'>, from: string, toDirectory: string): Promise<string> {
  await context.artifactFileSystem.mkdir(toDirectory);
  const target = await freeReviewPath(context, resolve(toDirectory, basename(from)));
  await context.artifactFileSystem.rename(from, target);
  return target;
}

export interface ApplyRequest {
  /** Fichero de revisión (relativo al directorio de trabajo o absoluto). */
  readonly review: string;
  /** Directorio de fuentes; por defecto el registrado en la revisión o `data/sources`. */
  readonly data?: string | undefined;
  readonly dryRun: boolean;
  readonly deleteReview: boolean;
  /**
   * Aparta la revisión a `revisiones-archivadas/` cuando ya no deja **nada pendiente** (T-9.24). Por defecto
   * sí: una revisión aplicada del todo solo estorba en la lista, y archivarla —no borrarla— la deja donde
   * se pueda volver a mirar y donde «deshacer» pueda devolverla.
   */
  readonly archive?: boolean | undefined;
}

export interface PlannedEditSummary {
  readonly id: string;
  readonly text: string;
}

export interface PlannedFileSummary {
  readonly path: string;
  readonly edits: readonly PlannedEditSummary[];
  /** El fichero entero tal como está y tal como quedaría con las ediciones aplicadas (T-8.6 S3: antes y después completos). */
  readonly before: string;
  readonly after: string;
}

export interface WrittenFile {
  readonly path: string;
  /** Versión anterior completa, guardada en el histórico (`output/historial-fuentes/<entrada>/<ruta>`). */
  readonly backup: string;
  readonly ids: readonly string[];
}

export interface ApplyOutcome {
  readonly reviewPath: string;
  readonly plan: readonly PlannedFileSummary[];
  readonly written: readonly WrittenFile[];
  readonly deleted: boolean;
  readonly changes: number;
  /** Ítems cuya propuesta YA estaba en la fuente: esta revisión se aplicó antes (no es un fallo). */
  readonly already: readonly string[];
  /** La entrada del histórico de fuentes creada al escribir (T-8.10); ausente en seco. */
  readonly history: SourceHistoryEntry | undefined;
  /** Ruta a la que se apartó la revisión por no dejar nada pendiente (T-9.24); ausente si sigue donde estaba. */
  readonly archived: string | undefined;
}

export type ApplyResult = { readonly ok: true; readonly outcome: ApplyOutcome } | { readonly ok: false; readonly error: AppError; readonly written: readonly WrittenFile[] };

export async function applyReview(context: AppContext, request: ApplyRequest): Promise<ApplyResult> {
  const reviewPath = resolve(context.cwd, request.review);
  let reviewText: string;
  try {
    reviewText = await context.datasetFileSystem.readTextFile(reviewPath);
  } catch (error) {
    return { ok: false, error: dataError(`No se pudo leer la revisión «${reviewPath}»: ${describeError(error)}`), written: [] };
  }
  const parsed = parseReview(reviewText);
  if (!parsed.ok) {
    return { ok: false, error: dataError(`${reviewPath}: ${parsed.message}`), written: [] };
  }
  const review = parsed.review;
  const root = resolve(context.cwd, request.data ?? review.dataDir ?? DEFAULT_DATA_DIR);

  // 1. Solo lo marcado, y una sola propuesta por ítem.
  const errors: string[] = [];
  const selected: Array<{ readonly item: ParsedReviewItem; readonly text: string }> = [];
  for (const item of review.items) {
    const checked = item.proposals.filter((proposal) => proposal.checked);
    if (checked.length > 1) {
      errors.push(`«${item.id}»: hay ${checked.length} propuestas marcadas con [x]; marca solo una`);
      continue;
    }
    for (const proposal of checked) {
      if (proposal.text.trim() === '') {
        errors.push(`«${item.id}»: la propuesta ${proposal.number} marcada está vacía`);
      } else {
        selected.push({ item, text: proposal.text.trim() });
      }
    }
  }
  if (selected.length === 0 && errors.length === 0) {
    return { ok: false, error: dataError(`Nada que aplicar: ninguna propuesta marcada con [x] en ${reviewPath}`), written: [] };
  }

  // 2. Localizar cada original en su fuente y comprobar la huella; nada se escribe si algo falla.
  const files = new Map<string, PlannedFile>();
  /** Ítems cuya propuesta ya está en la fuente: la revisión se aplicó antes. */
  const already: string[] = [];
  for (const { item, text } of selected) {
    if (item.source === undefined) {
      errors.push(`«${item.id}»: la revisión no registra su fuente (se generó con fuentes inválidas u obsoletas, o el resumen no tiene destino); cópiala a mano`);
      continue;
    }
    if (!isSafeSourcePath(item.source.file)) {
      errors.push(`«${item.id}»: ruta de fuente no admitida «${item.source.file}»`);
      continue;
    }
    const path = resolve(root, item.source.file);
    let planned = files.get(path);
    if (planned === undefined) {
      try {
        planned = { path, content: await context.datasetFileSystem.readTextFile(path), edits: [] };
      } catch (error) {
        errors.push(`«${item.id}»: no se pudo leer ${path}: ${describeError(error)}`);
        continue;
      }
      files.set(path, planned);
    }
    const plan = planEdit(review.task, item, item.source, text, planned.content);
    if (plan.kind === 'edit') {
      planned.edits.push(plan.edit);
    } else if (plan.kind === 'already') {
      already.push(item.id);
    } else {
      errors.push(`«${item.id}»: ${plan.message}`);
    }
  }
  if (errors.length > 0) {
    return { ok: false, error: dataError('No se ha modificado ningún fichero', [...errors, 'No se ha modificado ningún fichero']), written: [] };
  }
  const plan: PlannedFileSummary[] = [...files.values()].filter((planned) => planned.edits.length > 0).map((planned) => ({
    path: planned.path,
    edits: planned.edits.map((edit) => ({ id: edit.id, text: edit.text })),
    before: planned.content,
    after: applyEdits(planned),
  }));
  if (request.dryRun) {
    return { ok: true, outcome: { reviewPath, plan, written: [], deleted: false, changes: 0, already, history: undefined, archived: undefined } };
  }

  // 3. Histórico de las versiones anteriores (fichero completo) y escritura (los tramos se sustituyen de atrás hacia delante).
  // Solo los ficheros con alguna edición: si una propuesta ya estaba aplicada, su fichero no se toca —ni se
  // reescribe idéntico ni entra en el histórico—, porque no ha cambiado nada.
  const versions = [...files.values()]
    .filter((planned) => planned.edits.length > 0)
    .map((planned) => ({ path: planned.path, before: planned.content, after: applyEdits(planned), ids: planned.edits.map((edit) => edit.id) }));
  if (versions.length === 0) {
    // Todo estaba ya puesto: no se escribe nada, pero la revisión sí se cierra (se archiva o se borra), que es
    // justo lo que quiere quien la aplica por segunda vez.
    const settled = await settleReview(context, reviewPath, review, root, request);
    return { ok: true, outcome: { reviewPath, plan, written: [], changes: 0, already, history: undefined, ...settled } };
  }
  const recorded = await recordSourceVersions(context, { action: 'apply', origin: basename(reviewPath), root, versions, at: context.now?.() });
  if (!recorded.ok) {
    return { ok: false, error: recorded.error, written: [] };
  }
  const written: WrittenFile[] = [];
  let changes = 0;
  for (const version of versions) {
    const backup = historyVersionPath(context.cwd, recorded.entry.id, relative(root, version.path));
    try {
      await context.artifactFileSystem.writeFile(version.path, version.after, SOURCE_MODE);
    } catch (error) {
      return { ok: false, error: environmentError(`No se pudo escribir ${version.path}: ${describeError(error)}`), written };
    }
    changes += version.ids.length;
    written.push({ path: version.path, backup, ids: version.ids });
  }
  const settled = await settleReview(context, reviewPath, review, root, request);
  return { ok: true, outcome: { reviewPath, plan, written, changes, already, history: recorded.entry, ...settled } };
}

/**
 * Qué le pasa al fichero de revisión una vez escritas las fuentes: se borra si lo pidieron o se aparta a
 * `revisiones-archivadas/` si ya no deja nada pendiente (T-9.24, encargo del PO: «las aplicadas deberían
 * archivarse»). Se mide contra las fuentes **recién escritas**, no contra lo que se acaba de aplicar: una
 * revisión con ítems que nadie marcó todavía tiene trabajo dentro y se queda donde está. Y se exige al menos
 * un ítem aplicado: una revisión que no se pudo aplicar —sin fuente registrada, o con la fuente ya cambiada
 * por otro camino— tampoco tiene nada pendiente, y archivarla sería esconderla.
 */
async function settleReview(context: AppContext, reviewPath: string, review: ParsedReview, root: string, request: ApplyRequest): Promise<{ readonly deleted: boolean; readonly archived: string | undefined }> {
  if (request.deleteReview) {
    await context.artifactFileSystem.remove(reviewPath);
    return { deleted: true, archived: undefined };
  }
  // Solo lo que el producto gestiona como revisión: `cv improve apply` acepta cualquier ruta, y apartar un
  // fichero con otro nombre lo dejaría en una carpeta donde el listado ni siquiera lo mira.
  if (request.archive === false || !REVIEW_NAME.test(basename(reviewPath))) {
    return { deleted: false, archived: undefined };
  }
  const progress = reviewProgress(await reviewStatus(context, review, { root }));
  if (progress.applied === 0 || progress.pending > 0) {
    return { deleted: false, archived: undefined };
  }
  return { deleted: false, archived: await moveReview(context, reviewPath, reviewArchiveRoot(dirname(reviewPath), '.')) };
}

/* ---------- Qué queda por aplicar de una revisión (encargo del PO del 1-sep) ---------- */

/**
 * El estado de un ítem frente a sus fuentes **ahora**, para poder decir qué revisiones ya se aplicaron sin
 * intentar aplicarlas. Se mira el texto, no una marca en el fichero: una revisión que se aplicó y luego se
 * deshizo vuelve a salir como pendiente, que es lo cierto.
 */
export type ReviewItemState =
  /** Alguna propuesta está ya, literalmente, en la fuente: eso ya se aplicó. */
  | 'applied'
  /** El original sigue ahí: se aplicaría si lo marcas. */
  | 'pending'
  /** Ni el original ni ninguna propuesta: la fuente cambió por otro camino. */
  | 'changed'
  /** No se puede saber: la revisión no registra la fuente, o no se pudo leer. */
  | 'unknown';

export interface ReviewItemStatus {
  readonly id: string;
  readonly state: ReviewItemState;
}

/** Cuenta por estado, que es lo que cabe en una lista de revisiones. */
export interface ReviewProgress {
  readonly applied: number;
  readonly pending: number;
  readonly changed: number;
  readonly unknown: number;
}

export function reviewProgress(items: readonly ReviewItemStatus[]): ReviewProgress {
  const count = (state: ReviewItemState): number => items.filter((item) => item.state === state).length;
  return { applied: count('applied'), pending: count('pending'), changed: count('changed'), unknown: count('unknown') };
}

function stateOf(task: ReviewTask, item: ParsedReviewItem, source: ReviewSource, content: string): ReviewItemState {
  const texts = item.proposals.map((proposal) => proposal.text.trim()).filter((text) => text !== '');
  if (task === 'improve') {
    if (texts.some((text) => locateAchievementText(content, text, source.line) !== undefined)) {
      return 'applied';
    }
    return locateAchievementText(content, item.original, source.line) === undefined ? 'changed' : 'pending';
  }
  const location = locateSummary(content);
  const present = (location.kind === 'present' ? location.range.text : '').trim();
  if (texts.some((text) => text === present)) {
    return 'applied';
  }
  return fingerprint(present) === source.hash ? 'pending' : 'changed';
}

/**
 * Lo que se lee de las fuentes para decidir el estado, compartible entre revisiones: al listarlas, varias suelen
 * tocar los mismos ficheros y no hay razón para leerlos una vez por revisión. `undefined` = no se pudo leer.
 */
export type SourceCache = Map<string, string | undefined>;

export interface ReviewStatusOptions {
  /** Lecturas compartidas entre las revisiones de un mismo listado. */
  readonly cache?: SourceCache | undefined;
  /** Directorio de fuentes cuando no es el que registra la revisión (`cv improve apply -d`). */
  readonly root?: string | undefined;
}

/**
 * Compara cada ítem de una revisión con lo que hay hoy en las fuentes. Cada fichero se lee una sola vez —y, con
 * `cache`, una sola vez para todas las revisiones del listado— y no se escribe nada: esto es lo que se enseña
 * *antes* de decidir si aplicar.
 */
export async function reviewStatus(context: Pick<AppContext, 'cwd' | 'datasetFileSystem'>, review: ParsedReview, options: ReviewStatusOptions = {}): Promise<readonly ReviewItemStatus[]> {
  const root = options.root ?? resolve(context.cwd, review.dataDir ?? DEFAULT_DATA_DIR);
  const contents = options.cache ?? new Map<string, string | undefined>();
  const statuses: ReviewItemStatus[] = [];
  for (const item of review.items) {
    const { source } = item;
    if (source === undefined || !isSafeSourcePath(source.file)) {
      statuses.push({ id: item.id, state: 'unknown' });
      continue;
    }
    const path = resolve(root, source.file);
    if (!contents.has(path)) {
      try {
        contents.set(path, await context.datasetFileSystem.readTextFile(path));
      } catch {
        contents.set(path, undefined);
      }
    }
    const content = contents.get(path);
    statuses.push({ id: item.id, state: content === undefined ? 'unknown' : stateOf(review.task, item, source, content) });
  }
  return statuses;
}

/* ---------- Listado y lectura de revisiones (clientes) ---------- */

export interface ReviewSummary {
  readonly name: string;
  readonly path: string;
  readonly sha256: string;
  readonly task: ReviewTask | undefined;
  readonly items: number;
  /** Propuestas marcadas `[x]`. */
  readonly marked: number;
  /** Motivo por el que no se pudo interpretar, si lo hay. */
  readonly error: string | undefined;
  /** Cuántos ítems están ya en las fuentes, cuántos quedan y cuántos no cuadran (encargo del PO del 1-sep). */
  readonly progress: ReviewProgress | undefined;
  /** Apartada en `revisiones-archivadas/`: no estorba en la lista, pero sigue ahí (T-9.24). */
  readonly archived: boolean;
}

async function summarize(context: Pick<AppContext, 'cwd' | 'datasetFileSystem'>, name: string, path: string, text: string, archived: boolean, cache?: SourceCache): Promise<ReviewSummary> {
  const parsed = parseReview(text);
  const sha256 = contentHash(text);
  if (!parsed.ok) {
    return { name, path, sha256, task: undefined, items: 0, marked: 0, error: parsed.message, progress: undefined, archived };
  }
  const marked = parsed.review.items.reduce((sum, item) => sum + item.proposals.filter((proposal) => proposal.checked).length, 0);
  const progress = reviewProgress(await reviewStatus(context, parsed.review, { cache }));
  return { name, path, sha256, task: parsed.review.task, items: parsed.review.items.length, marked, error: undefined, progress, archived };
}

/** Las revisiones (`revision-*.md`) de un directorio, por nombre; sin el directorio, ninguna. */
async function listIn(context: Pick<AppContext, 'cwd' | 'datasetFileSystem'>, root: string, archived: boolean, cache: SourceCache): Promise<ReviewSummary[]> {
  let names: string[];
  try {
    names = (await context.datasetFileSystem.readDirectory(root)).filter((entry) => entry.kind === 'file' && REVIEW_NAME.test(entry.name)).map((entry) => entry.name).sort();
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }
  const summaries: ReviewSummary[] = [];
  for (const name of names) {
    const path = resolve(root, name);
    summaries.push(await summarize(context, name, path, await context.datasetFileSystem.readTextFile(path), archived, cache));
  }
  return summaries;
}

export interface ReviewListing {
  /** Las que están a la vista, en el propio directorio de salida. */
  readonly reviews: readonly ReviewSummary[];
  /** Las apartadas en `revisiones-archivadas/`. */
  readonly archived: readonly ReviewSummary[];
}

/** Las revisiones de un directorio y las que se archivaron en él, cada grupo por nombre. */
export async function listReviews(context: AppContext, directory: string): Promise<ReviewListing> {
  // Un solo cache para los dos listados: varias revisiones del mismo día tocan las mismas fuentes.
  const cache: SourceCache = new Map();
  return {
    reviews: await listIn(context, resolve(context.cwd, directory), false, cache),
    archived: await listIn(context, reviewArchiveRoot(context.cwd, directory), true, cache),
  };
}

export interface ReviewLocation {
  readonly path: string;
  readonly archived: boolean;
}

/** Dónde está una revisión: en el directorio de salida o apartada en `revisiones-archivadas/`. */
export async function locateReview(context: Pick<AppContext, 'cwd' | 'datasetFileSystem'>, directory: string, name: string): Promise<ReviewLocation | undefined> {
  const candidates: readonly ReviewLocation[] = [
    { path: resolve(context.cwd, directory, name), archived: false },
    { path: resolve(reviewArchiveRoot(context.cwd, directory), name), archived: true },
  ];
  for (const candidate of candidates) {
    try {
      if ((await context.datasetFileSystem.stat(candidate.path)).kind === 'file') {
        return candidate;
      }
    } catch {
      // No está ahí: se prueba el siguiente sitio.
    }
  }
  return undefined;
}

/**
 * A qué directorio de revisiones pertenece un fichero y con qué nombre: el suyo, o el de arriba si está
 * apartado en `revisiones-archivadas/`. Con esto, la CLI acepta la ruta que el usuario tenga a mano —dentro o
 * fuera del archivo— y las órdenes siguen hablando del mismo par (directorio, nombre) que la API.
 */
export function reviewDirectoryOf(path: string): { readonly directory: string; readonly name: string } {
  const parent = dirname(path);
  return { directory: basename(parent) === REVIEW_ARCHIVE_DIRNAME ? dirname(parent) : parent, name: basename(path) };
}

export type ReviewMoveResult = { readonly ok: true; readonly name: string; readonly path: string; readonly archived: boolean; /** Si de verdad se movió el fichero (pedir lo que ya es no mueve nada). */ readonly moved: boolean } | { readonly ok: false; readonly error: AppError };

/**
 * Archiva o desarchiva una revisión moviéndola entre `output/` y `output/revisiones-archivadas/`. Es
 * **idempotente**: pedir lo que ya es no falla ni mueve nada. Nunca sobrescribe: si en el destino ya hay una
 * con ese nombre, la que llega toma `-2`, `-3`…
 */
export async function setReviewArchived(context: AppContext, directory: string, name: string, archived: boolean): Promise<ReviewMoveResult> {
  if (!REVIEW_NAME.test(name)) {
    return { ok: false, error: unsafePathError(`Nombre de revisión no válido «${name}»: se espera revision-<…>.md, sin directorios`) };
  }
  const located = await locateReview(context, directory, name);
  if (located === undefined) {
    return { ok: false, error: { code: 'not-found', message: `No existe la revisión «${name}»`, exitCode: 2 } };
  }
  if (located.archived === archived) {
    return { ok: true, name, path: located.path, archived, moved: false };
  }
  const target = archived ? reviewArchiveRoot(context.cwd, directory) : resolve(context.cwd, directory);
  try {
    const path = await moveReview(context, located.path, target);
    return { ok: true, name: basename(path), path, archived, moved: true };
  } catch (error) {
    return { ok: false, error: environmentError(`No se pudo ${archived ? 'archivar' : 'desarchivar'} la revisión «${name}»: ${describeError(error)}`) };
  }
}

export type ReviewDeleteResult = { readonly ok: true; readonly name: string; readonly path: string } | { readonly ok: false; readonly error: AppError };

/** Borra una revisión, esté a la vista o archivada. Las fuentes no se tocan. */
export async function removeReview(context: AppContext, directory: string, name: string): Promise<ReviewDeleteResult> {
  if (!REVIEW_NAME.test(name)) {
    return { ok: false, error: unsafePathError(`Nombre de revisión no válido «${name}»: se espera revision-<…>.md, sin directorios`) };
  }
  const located = await locateReview(context, directory, name);
  if (located === undefined) {
    return { ok: false, error: { code: 'not-found', message: `No existe la revisión «${name}»`, exitCode: 2 } };
  }
  try {
    await context.artifactFileSystem.remove(located.path);
  } catch (error) {
    return { ok: false, error: environmentError(`No se pudo eliminar la revisión «${name}»: ${describeError(error)}`) };
  }
  return { ok: true, name, path: located.path };
}

export interface ReviewFile extends ReviewSummary {
  readonly text: string;
  readonly review: ParsedReview | undefined;
  /** El estado de cada ítem frente a las fuentes de ahora; vacío si la revisión no se pudo interpretar. */
  readonly statuses: readonly ReviewItemStatus[];
}

export type ReviewReadResult = { readonly ok: true; readonly file: ReviewFile } | { readonly ok: false; readonly error: AppError };

/** Una revisión por su nombre (solo `revision-*.md`, sin directorios), con su texto, su huella y su estructura. */
export async function readReview(context: AppContext, directory: string, name: string): Promise<ReviewReadResult> {
  if (!REVIEW_NAME.test(name)) {
    return { ok: false, error: unsafePathError(`Nombre de revisión no válido «${name}»: se espera revision-<…>.md, sin directorios`) };
  }
  // Se busca donde esté: una revisión archivada se sigue pudiendo abrir, y su URL no cambia al archivarla.
  const located = await locateReview(context, directory, name);
  const path = located?.path ?? resolve(context.cwd, directory, name);
  const archived = located?.archived ?? false;
  try {
    const text = await context.datasetFileSystem.readTextFile(path);
    const parsed = parseReview(text);
    const statuses = parsed.ok ? await reviewStatus(context, parsed.review) : [];
    return { ok: true, file: { ...(await summarize(context, name, path, text, archived)), text, review: parsed.ok ? parsed.review : undefined, statuses } };
  } catch (error) {
    return { ok: false, error: isMissingFile(error) ? { code: 'not-found', message: `No existe la revisión «${name}»`, exitCode: 2 } : environmentError(`No se pudo leer la revisión «${name}»: ${describeError(error)}`) };
  }
}
