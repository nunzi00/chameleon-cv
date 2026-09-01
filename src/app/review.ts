/**
 * Revisiones del co-piloto (T-4.7, docs/api-headless.md §5): aplicar a las fuentes lo marcado `[x]` —la
 * única escritura en `data/sources` que hace el producto (canon C9: acción explícita del usuario)— con
 * cuatro garantías (solo lo marcado; cambio mínimo; copia `.bak` nunca sobrescrita; huella comprobada), y
 * listar y leer las revisiones de `output/` para los clientes.
 */
import { basename, relative, resolve } from 'node:path';

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

export interface ApplyRequest {
  /** Fichero de revisión (relativo al directorio de trabajo o absoluto). */
  readonly review: string;
  /** Directorio de fuentes; por defecto el registrado en la revisión o `data/sources`. */
  readonly data?: string | undefined;
  readonly dryRun: boolean;
  readonly deleteReview: boolean;
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
    return { ok: true, outcome: { reviewPath, plan, written: [], deleted: false, changes: 0, already, history: undefined } };
  }

  // 3. Histórico de las versiones anteriores (fichero completo) y escritura (los tramos se sustituyen de atrás hacia delante).
  // Solo los ficheros con alguna edición: si una propuesta ya estaba aplicada, su fichero no se toca —ni se
  // reescribe idéntico ni entra en el histórico—, porque no ha cambiado nada.
  const versions = [...files.values()]
    .filter((planned) => planned.edits.length > 0)
    .map((planned) => ({ path: planned.path, before: planned.content, after: applyEdits(planned), ids: planned.edits.map((edit) => edit.id) }));
  if (versions.length === 0) {
    return { ok: true, outcome: { reviewPath, plan, written: [], deleted: false, changes: 0, already, history: undefined } };
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
  let deleted = false;
  if (request.deleteReview) {
    await context.artifactFileSystem.remove(reviewPath);
    deleted = true;
  }
  return { ok: true, outcome: { reviewPath, plan, written, deleted, changes, already, history: recorded.entry } };
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

/**
 * Compara cada ítem de una revisión con lo que hay hoy en las fuentes. Cada fichero se lee una sola vez —y, con
 * `cache`, una sola vez para todas las revisiones del listado— y no se escribe nada: esto es lo que se enseña
 * *antes* de decidir si aplicar.
 */
export async function reviewStatus(context: Pick<AppContext, 'cwd' | 'datasetFileSystem'>, review: ParsedReview, cache?: SourceCache): Promise<readonly ReviewItemStatus[]> {
  const root = resolve(context.cwd, review.dataDir ?? DEFAULT_DATA_DIR);
  const contents = cache ?? new Map<string, string | undefined>();
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
}

async function summarize(context: Pick<AppContext, 'cwd' | 'datasetFileSystem'>, name: string, path: string, text: string, cache?: SourceCache): Promise<ReviewSummary> {
  const parsed = parseReview(text);
  const sha256 = contentHash(text);
  if (!parsed.ok) {
    return { name, path, sha256, task: undefined, items: 0, marked: 0, error: parsed.message, progress: undefined };
  }
  const marked = parsed.review.items.reduce((sum, item) => sum + item.proposals.filter((proposal) => proposal.checked).length, 0);
  const progress = reviewProgress(await reviewStatus(context, parsed.review, cache));
  return { name, path, sha256, task: parsed.review.task, items: parsed.review.items.length, marked, error: undefined, progress };
}

/** Las revisiones (`revision-*.md`) de un directorio, por nombre. */
export async function listReviews(context: AppContext, directory: string): Promise<readonly ReviewSummary[]> {
  const root = resolve(context.cwd, directory);
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
  // Un solo cache para todo el listado: varias revisiones del mismo día tocan las mismas fuentes.
  const cache: SourceCache = new Map();
  for (const name of names) {
    const path = resolve(root, name);
    summaries.push(await summarize(context, name, path, await context.datasetFileSystem.readTextFile(path), cache));
  }
  return summaries;
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
  const path = resolve(context.cwd, directory, name);
  try {
    const text = await context.datasetFileSystem.readTextFile(path);
    const parsed = parseReview(text);
    const statuses = parsed.ok ? await reviewStatus(context, parsed.review) : [];
    return { ok: true, file: { ...(await summarize(context, name, path, text)), text, review: parsed.ok ? parsed.review : undefined, statuses } };
  } catch (error) {
    return { ok: false, error: isMissingFile(error) ? { code: 'not-found', message: `No existe la revisión «${name}»`, exitCode: 2 } : environmentError(`No se pudo leer la revisión «${name}»: ${describeError(error)}`) };
  }
}
