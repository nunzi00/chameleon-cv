/**
 * Trabajos del co-piloto (T-7.4b, docs/api-headless.md §5): una cola en memoria, de uno en uno, con
 * progreso por líneas, cancelación por `AbortSignal` y suscripción (SSE) que repite lo ya ocurrido y sigue
 * en directo. Los resultados viven mientras el servidor: la revisión ya está en `output/` y el usuario
 * decide qué hacer con ella (C11).
 */
import { randomUUID } from 'node:crypto';

import type { AppError } from '../app/errors';
import { describeError } from '../shared/errors';

export type JobKind = 'improve' | 'summarize' | 'suggest-tags' | 'ollama-up';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface JobError {
  readonly code: string;
  readonly message: string;
  readonly lines?: readonly string[] | undefined;
}

export interface JobSnapshot {
  readonly id: string;
  readonly kind: JobKind;
  readonly status: JobStatus;
  readonly createdAt: string;
  readonly startedAt: string | undefined;
  readonly finishedAt: string | undefined;
  /** Progreso (una línea por ítem) y avisos, en orden. */
  readonly lines: readonly string[];
  readonly result: unknown;
  readonly error: JobError | undefined;
}

export type JobEvent = { readonly event: 'line'; readonly data: { readonly line: string } } | { readonly event: 'status'; readonly data: JobSnapshot };

export interface JobReport {
  readonly line: (text: string) => void;
  readonly signal: AbortSignal;
}

export type JobRun = (report: JobReport) => Promise<unknown>;

/** Un fallo de la capa de casos de uso dentro de un trabajo: conserva código, mensaje y líneas. */
export class JobFailure extends Error {
  readonly appError: AppError;

  constructor(appError: AppError) {
    super(appError.message);
    this.appError = appError;
  }
}

interface Job {
  readonly id: string;
  readonly kind: JobKind;
  status: JobStatus;
  readonly createdAt: string;
  startedAt: string | undefined;
  finishedAt: string | undefined;
  readonly lines: string[];
  result: unknown;
  error: JobError | undefined;
  readonly controller: AbortController;
  readonly run: JobRun;
  readonly listeners: Set<(event: JobEvent) => void>;
}

/** Trabajos terminados que se conservan (los más antiguos se olvidan). */
export const JOB_HISTORY = 50;

export function isFinished(status: JobStatus): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled';
}

function snapshot(job: Job): JobSnapshot {
  return { id: job.id, kind: job.kind, status: job.status, createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt, lines: [...job.lines], result: job.result, error: job.error };
}

function toJobError(error: unknown): JobError {
  if (error instanceof JobFailure) {
    return { code: error.appError.code, message: error.appError.message, lines: error.appError.lines };
  }
  return { code: 'failed', message: describeError(error) };
}

export class JobQueue {
  private readonly jobs = new Map<string, Job>();
  private readonly pending: Job[] = [];
  private active: Job | undefined;
  private readonly idleWaiters: Array<() => void> = [];
  private readonly now: () => Date;
  private readonly history: number;
  private readonly newId: () => string;

  constructor(now: () => Date = () => new Date(), history: number = JOB_HISTORY, newId: () => string = randomUUID) {
    this.now = now;
    this.history = history;
    this.newId = newId;
  }

  /** Encola y arranca en cuanto no haya otro en marcha (de uno en uno: un solo modelo local). */
  create(kind: JobKind, run: JobRun): JobSnapshot {
    const job: Job = { id: this.newId(), kind, status: 'queued', createdAt: this.now().toISOString(), startedAt: undefined, finishedAt: undefined, lines: [], result: undefined, error: undefined, controller: new AbortController(), run, listeners: new Set() };
    this.jobs.set(job.id, job);
    this.pending.push(job);
    this.prune();
    this.start();
    return snapshot(job);
  }

  list(): readonly JobSnapshot[] {
    return [...this.jobs.values()].map(snapshot);
  }

  get(id: string): JobSnapshot | undefined {
    const job = this.jobs.get(id);
    return job === undefined ? undefined : snapshot(job);
  }

  /** En cola: termina cancelado ya; en marcha: se aborta la petición en curso y el lote para; terminado: sin efecto. */
  cancel(id: string): JobSnapshot | undefined {
    const job = this.jobs.get(id);
    if (job === undefined) {
      return undefined;
    }
    if (job.status === 'queued') {
      this.pending.splice(this.pending.indexOf(job), 1);
      this.finish(job, 'cancelled');
    } else if (job.status === 'running') {
      job.controller.abort();
    }
    return snapshot(job);
  }

  /** Repite el estado actual (con sus líneas) y sigue en directo; devuelve cómo darse de baja (sin efecto si el id no existe). */
  subscribe(id: string, listener: (event: JobEvent) => void): () => void {
    const job = this.jobs.get(id);
    if (job === undefined) {
      return () => undefined;
    }
    job.listeners.add(listener);
    listener({ event: 'status', data: snapshot(job) });
    return () => {
      job.listeners.delete(listener);
    };
  }

  /** Se resuelve cuando no queda ningún trabajo en marcha ni en cola (para cerrar el servidor). */
  idle(): Promise<void> {
    if (this.active === undefined && this.pending.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  private emit(job: Job, event: JobEvent): void {
    for (const listener of job.listeners) {
      listener(event);
    }
  }

  private finish(job: Job, status: JobStatus): void {
    job.status = status;
    job.finishedAt = this.now().toISOString();
    this.emit(job, { event: 'status', data: snapshot(job) });
    job.listeners.clear();
    this.prune();
  }

  private start(): void {
    if (this.active !== undefined) {
      return;
    }
    const job = this.pending.shift();
    if (job === undefined) {
      for (const resolve of this.idleWaiters.splice(0)) {
        resolve();
      }
      return;
    }
    this.active = job;
    job.status = 'running';
    job.startedAt = this.now().toISOString();
    this.emit(job, { event: 'status', data: snapshot(job) });
    void this.execute(job);
  }

  private async execute(job: Job): Promise<void> {
    const report: JobReport = {
      line: (text) => {
        job.lines.push(text);
        this.emit(job, { event: 'line', data: { line: text } });
      },
      signal: job.controller.signal,
    };
    try {
      job.result = await job.run(report);
      this.finish(job, job.controller.signal.aborted ? 'cancelled' : 'done');
    } catch (error) {
      job.error = toJobError(error);
      this.finish(job, job.controller.signal.aborted ? 'cancelled' : 'failed');
    }
    this.active = undefined;
    this.start();
  }

  /** Olvida los trabajos terminados más antiguos por encima del histórico. */
  private prune(): void {
    const finished = [...this.jobs.values()].filter((job) => isFinished(job.status));
    for (const job of finished.slice(0, Math.max(0, finished.length - this.history))) {
      this.jobs.delete(job.id);
    }
  }
}
