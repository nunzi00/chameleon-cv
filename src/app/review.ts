/**
 * Revisiones del co-piloto (T-4.7, docs/api-headless.md §5): aplicar a las fuentes lo marcado `[x]` —la
 * única escritura en `data/sources` que hace el producto (canon C9: acción explícita del usuario)— con
 * cuatro garantías (solo lo marcado; cambio mínimo; copia `.bak` nunca sobrescrita; huella comprobada), y
 * listar y leer las revisiones de `output/` para los clientes.
 */
import { resolve } from 'node:path';

import { fingerprint, parseReview, type ParsedReview, type ParsedReviewItem, type ReviewSource, type ReviewTask } from '../llm';
import { locateAchievementText, locateSummary, replaceRange, replaceSummary } from '../parsers';
import { describeError } from '../shared/errors';
import type { AppContext } from './context';
import { DEFAULT_DATA_DIR } from './defaults';
import { dataError, environmentError, unsafePathError, type AppError } from './errors';
import { isSafeSourcePath } from './paths';
import { isMissingFile } from '../artifact';
import { contentHash } from './sources';

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

type EditPlan = { readonly ok: true; readonly edit: PlannedEdit } | { readonly ok: false; readonly message: string };

function planEdit(task: ReviewTask, item: ParsedReviewItem, source: ReviewSource, text: string, content: string): EditPlan {
  if (task === 'improve') {
    const range = locateAchievementText(content, item.original, source.line);
    if (range === undefined) {
      return { ok: false, message: `el logro original no está tal cual en ${source.file} (¿editado a mano?)` };
    }
    const current = fingerprint(range.text);
    if (current !== source.hash) {
      return { ok: false, message: `el original cambió desde la revisión (huella ${current} ≠ ${source.hash})` };
    }
    return { ok: true, edit: { id: item.id, start: range.start, text, apply: (updated) => replaceRange(updated, range.start, range.end, text) } };
  }
  const location = locateSummary(content);
  const current = fingerprint(location.kind === 'present' ? location.range.text : '');
  if (current !== source.hash) {
    return { ok: false, message: `el resumen de ${source.file} cambió desde la revisión (huella ${current} ≠ ${source.hash})` };
  }
  return { ok: true, edit: { id: item.id, start: location.kind === 'present' ? location.range.start : location.insertAt, text, apply: (updated) => replaceSummary(updated, location, text) } };
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
  readonly backup: string;
  readonly ids: readonly string[];
}

export interface ApplyOutcome {
  readonly reviewPath: string;
  readonly plan: readonly PlannedFileSummary[];
  readonly written: readonly WrittenFile[];
  readonly deleted: boolean;
  readonly changes: number;
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
    if (plan.ok) {
      planned.edits.push(plan.edit);
    } else {
      errors.push(`«${item.id}»: ${plan.message}`);
    }
  }
  if (errors.length > 0) {
    return { ok: false, error: dataError('No se ha modificado ningún fichero', [...errors, 'No se ha modificado ningún fichero']), written: [] };
  }
  const plan: PlannedFileSummary[] = [...files.values()].map((planned) => ({
    path: planned.path,
    edits: planned.edits.map((edit) => ({ id: edit.id, text: edit.text })),
    before: planned.content,
    after: applyEdits(planned),
  }));
  if (request.dryRun) {
    return { ok: true, outcome: { reviewPath, plan, written: [], deleted: false, changes: 0 } };
  }

  // 3. Copia de seguridad y escritura, fichero a fichero (los tramos se sustituyen de atrás hacia delante).
  const written: WrittenFile[] = [];
  let changes = 0;
  for (const planned of files.values()) {
    const backup = await backupPath(context, planned.path);
    const content = applyEdits(planned);
    try {
      await context.artifactFileSystem.writeFile(backup, planned.content, SOURCE_MODE);
      await context.artifactFileSystem.writeFile(planned.path, content, SOURCE_MODE);
    } catch (error) {
      return { ok: false, error: environmentError(`No se pudo escribir ${planned.path}: ${describeError(error)}`), written };
    }
    changes += planned.edits.length;
    written.push({ path: planned.path, backup, ids: planned.edits.map((edit) => edit.id) });
  }
  let deleted = false;
  if (request.deleteReview) {
    await context.artifactFileSystem.remove(reviewPath);
    deleted = true;
  }
  return { ok: true, outcome: { reviewPath, plan, written, deleted, changes } };
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
}

function summarize(name: string, path: string, text: string): ReviewSummary {
  const parsed = parseReview(text);
  const sha256 = contentHash(text);
  if (!parsed.ok) {
    return { name, path, sha256, task: undefined, items: 0, marked: 0, error: parsed.message };
  }
  const marked = parsed.review.items.reduce((sum, item) => sum + item.proposals.filter((proposal) => proposal.checked).length, 0);
  return { name, path, sha256, task: parsed.review.task, items: parsed.review.items.length, marked, error: undefined };
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
  for (const name of names) {
    const path = resolve(root, name);
    summaries.push(summarize(name, path, await context.datasetFileSystem.readTextFile(path)));
  }
  return summaries;
}

export interface ReviewFile extends ReviewSummary {
  readonly text: string;
  readonly review: ParsedReview | undefined;
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
    return { ok: true, file: { ...summarize(name, path, text), text, review: parsed.ok ? parsed.review : undefined } };
  } catch (error) {
    return { ok: false, error: isMissingFile(error) ? { code: 'not-found', message: `No existe la revisión «${name}»`, exitCode: 2 } : environmentError(`No se pudo leer la revisión «${name}»: ${describeError(error)}`) };
  }
}
