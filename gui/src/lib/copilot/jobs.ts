/** Los trabajos del co-piloto en la pantalla: estado a partir de los eventos SSE, lista y resultado por tarea. */
import type { JobKind } from '../api/client';
import type { SseEvent } from '../api/sse';
import type { JobResponse } from '../api/types';

export type JobSnapshot = JobResponse['job'];
export type JobStatus = JobSnapshot['status'];

export const STATUS_LABELS: Readonly<Record<JobStatus, string>> = { queued: 'en cola', running: 'en marcha', done: 'terminado', failed: 'fallido', cancelled: 'cancelado' };
export const KIND_LABELS: Readonly<Record<JobKind, string>> = { improve: 'Mejorar logros', summarize: 'Resumen profesional', 'suggest-tags': 'Sugerir etiquetas' };

export function isFinished(status: JobStatus): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled';
}

function isSnapshot(value: unknown): value is JobSnapshot {
  return typeof value === 'object' && value !== null && 'id' in value && 'status' in value && 'lines' in value && Array.isArray(value.lines);
}

/** `status` sustituye el trabajo entero; `line` añade una línea; cualquier otro evento (o uno mal formado) no cambia nada. */
export function applyJobEvent(job: JobSnapshot, event: SseEvent): JobSnapshot {
  if (event.event === 'status' && isSnapshot(event.data) && event.data.id === job.id) {
    return event.data;
  }
  if (event.event === 'line' && typeof event.data === 'object' && event.data !== null && 'line' in event.data && typeof event.data.line === 'string') {
    return { ...job, lines: [...job.lines, event.data.line] };
  }
  return job;
}

/** Sustituye el trabajo con el mismo id o lo pone el primero (los más nuevos arriba). */
export function upsertJob(jobs: readonly JobSnapshot[], job: JobSnapshot): readonly JobSnapshot[] {
  return jobs.some((entry) => entry.id === job.id) ? jobs.map((entry) => (entry.id === job.id ? job : entry)) : [job, ...jobs];
}

export interface ResultView {
  readonly summary: string;
  /** La revisión escrita (improve, summarize), lista para abrir en Revisiones. */
  readonly review: { readonly name: string; readonly path: string } | undefined;
  /** Líneas copiables (suggest-tags) o vacío. */
  readonly lines: readonly string[];
}

interface ReviewResult {
  readonly review?: { readonly name: string; readonly path: string };
  readonly stats?: { readonly items?: number; readonly proposals?: number; readonly accepted?: number; readonly rejected?: number; readonly failed?: number; readonly fromCache?: number };
  readonly cancelled?: boolean;
  readonly processed?: number;
}

interface TagsResult {
  readonly items?: readonly { readonly id?: string | undefined; readonly line?: string; readonly error?: string | undefined }[];
  readonly stats?: { readonly items?: number; readonly suggested?: number; readonly fresh?: number; readonly rejected?: number; readonly failed?: number };
  readonly cancelled?: boolean;
}

/** El resultado de un trabajo terminado, tal como lo devuelve la API, en texto; `undefined` si no hay resultado legible. */
export function describeResult(kind: JobKind, result: unknown): ResultView | undefined {
  if (typeof result !== 'object' || result === null) {
    return undefined;
  }
  if (kind === 'suggest-tags') {
    const tags = result as TagsResult;
    const lines = (tags.items ?? []).map((item) => (item.error !== undefined ? `${item.id ?? 'texto'}: fallo (${item.error})` : `${item.id ?? 'texto'}: ${item.line === undefined || item.line === '' ? 'ninguna etiqueta del diccionario encaja' : item.line}`));
    const stats = tags.stats ?? {};
    const summary = tags.cancelled === true ? `Cancelado tras ${lines.length} fragmentos` : `${stats.items ?? lines.length} fragmentos · ${stats.suggested ?? 0} etiquetas sugeridas (${stats.fresh ?? 0} nuevas) · ${stats.rejected ?? 0} rechazadas · ${stats.failed ?? 0} fallidos`;
    return { summary, review: undefined, lines };
  }
  const review = result as ReviewResult;
  if (review.cancelled === true) {
    return { summary: `Cancelado: ${review.processed ?? 0} procesados, sin revisión escrita`, review: undefined, lines: [] };
  }
  if (review.review === undefined) {
    return undefined;
  }
  const stats = review.stats ?? {};
  return {
    summary: `Revisión escrita en ${review.review.path}: ${stats.items ?? 0} ítems · ${stats.proposals ?? 0} propuestas · ${stats.accepted ?? 0} aceptadas · ${stats.rejected ?? 0} rechazadas (C2) · ${stats.failed ?? 0} fallidos · ${stats.fromCache ?? 0} desde caché`,
    review: { name: review.review.name, path: review.review.path },
    lines: [],
  };
}

/** Qué sale y a dónde (el `sending` del 202), en una línea. */
export function describeSending(sending: Readonly<Record<string, unknown>>): string {
  const parts: string[] = [];
  const destination = sending['destination'];
  if (typeof destination === 'string') {
    parts.push(`hacia ${destination}`);
  }
  const items = sending['items'];
  const words = sending['words'];
  if (typeof items === 'number') {
    parts.push(`${items} ${items === 1 ? 'fragmento' : 'fragmentos'}`);
  }
  if (typeof words === 'number') {
    parts.push(`${words} palabras`);
  }
  const scope = sending['scope'];
  if (typeof scope === 'string') {
    parts.push(scope);
  }
  parts.push(sending['redactCompanies'] === true ? 'sin empresas' : 'sin nombre ni datos de contacto');
  return parts.join(' · ');
}
