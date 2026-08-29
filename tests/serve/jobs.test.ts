import { describe, expect, it } from 'vitest';

import { JobFailure, JobQueue, isFinished, type JobEvent } from '../../src/serve/jobs';

let tick = 0;
const clock = (): Date => new Date(Date.UTC(2026, 7, 29, 10, 0, tick++));
const ids = (): (() => string) => {
  let n = 0;
  return () => `job-${++n}`;
};

/** Un trabajo que espera a que lo dejen terminar (o a que lo cancelen). */
function gate(): { readonly run: (report: { line: (text: string) => void; signal: AbortSignal }) => Promise<unknown>; release: (value: unknown) => void } {
  let release: (value: unknown) => void = () => undefined;
  const run = (report: { line: (text: string) => void; signal: AbortSignal }): Promise<unknown> =>
    new Promise((resolve) => {
      release = resolve;
      report.signal.addEventListener('abort', () => resolve({ aborted: true }));
    });
  return { run, release: (value) => release(value) };
}

describe('JobQueue', () => {
  it('ejecuta de uno en uno, en orden, con progreso por líneas y resultado', async () => {
    const queue = new JobQueue(clock, 50, ids());
    const first = gate();
    const a = queue.create('improve', first.run);
    const b = queue.create('summarize', async (report) => {
      report.line('uno');
      return { ok: true };
    });
    expect(a).toMatchObject({ id: 'job-1', status: 'running', startedAt: expect.any(String) });
    expect(b).toMatchObject({ id: 'job-2', status: 'queued', startedAt: undefined });
    first.release({ done: 1 });
    await queue.idle();
    expect(queue.get('job-1')).toMatchObject({ status: 'done', result: { done: 1 }, finishedAt: expect.any(String) });
    expect(queue.get('job-2')).toMatchObject({ status: 'done', lines: ['uno'], result: { ok: true } });
    expect(queue.list().map((job) => job.id)).toEqual(['job-1', 'job-2']);
    expect(queue.get('nope')).toBeUndefined();
    await queue.idle();
  });

  it('cancela: en cola termina ya; en marcha aborta la señal y el resultado queda como cancelado', async () => {
    const queue = new JobQueue(clock, 50, ids());
    const running = gate();
    queue.create('improve', running.run);
    queue.create('suggest-tags', async () => 'nunca');
    expect(queue.cancel('job-2')).toMatchObject({ status: 'cancelled', finishedAt: expect.any(String) });
    expect(queue.cancel('job-1')).toMatchObject({ status: 'running' });
    await queue.idle();
    expect(queue.get('job-1')).toMatchObject({ status: 'cancelled', result: { aborted: true } });
    expect(queue.cancel('job-1')).toMatchObject({ status: 'cancelled' });
    expect(queue.cancel('nope')).toBeUndefined();
  });

  it('un fallo de la capa de casos de uso conserva código y líneas; otro error se anota como «failed»', async () => {
    const queue = new JobQueue(clock, 50, ids());
    queue.create('improve', () => Promise.reject(new JobFailure({ code: 'environment', message: 'sin disco', lines: ['detalle'], exitCode: 2 })));
    queue.create('improve', () => Promise.reject(new Error('boom')));
    await queue.idle();
    expect(queue.get('job-1')).toMatchObject({ status: 'failed', error: { code: 'environment', message: 'sin disco', lines: ['detalle'] } });
    expect(queue.get('job-2')).toMatchObject({ status: 'failed', error: { code: 'failed', message: 'boom' } });
  });

  it('una cancelación durante un fallo se registra como cancelado', async () => {
    const queue = new JobQueue(clock, 50, ids());
    queue.create('improve', (report) => new Promise((_resolve, reject) => report.signal.addEventListener('abort', () => reject(new Error('abortado')))));
    queue.cancel('job-1');
    await queue.idle();
    expect(queue.get('job-1')).toMatchObject({ status: 'cancelled', error: { code: 'failed', message: 'abortado' } });
  });

  it('la suscripción repite el estado actual y sigue en directo hasta el final', async () => {
    const queue = new JobQueue(clock, 50, ids());
    const pending = gate();
    queue.create('improve', async (report) => {
      report.line('antes');
      const value = await pending.run(report);
      report.line('después');
      return value;
    });
    await new Promise((resolve) => setImmediate(resolve));
    const events: JobEvent[] = [];
    const unsubscribe = queue.subscribe('job-1', (event) => events.push(event));
    expect(events).toEqual([{ event: 'status', data: expect.objectContaining({ status: 'running', lines: ['antes'] }) }]);
    pending.release('fin');
    await queue.idle();
    expect(events.map((event) => event.event)).toEqual(['status', 'line', 'status']);
    expect(events.at(-1)).toEqual({ event: 'status', data: expect.objectContaining({ status: 'done', result: 'fin', lines: ['antes', 'después'] }) });
    unsubscribe();
    expect(queue.subscribe('nope', () => undefined)).toBeTypeOf('function');
    queue.subscribe('nope', () => undefined)();
    // Tras terminar, darse de baja es inocuo y un nuevo suscriptor recibe el estado final.
    const late: JobEvent[] = [];
    queue.subscribe('job-1', (event) => late.push(event))();
    expect(late).toHaveLength(1);
    expect(isFinished('done')).toBe(true);
    expect(isFinished('queued')).toBe(false);
  });

  it('por defecto usa el reloj del sistema, ids aleatorios y el histórico estándar', async () => {
    const queue = new JobQueue();
    const job = queue.create('improve', async () => 1);
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(job.createdAt)).toBeGreaterThan(0);
    await queue.idle();
    expect(queue.get(job.id)?.status).toBe('done');
  });

  it('olvida los trabajos terminados más antiguos por encima del histórico', async () => {
    const queue = new JobQueue(clock, 2, ids());
    for (let n = 0; n < 4; n += 1) {
      queue.create('improve', async () => n);
      await queue.idle();
    }
    expect(queue.list().map((job) => job.id)).toEqual(['job-3', 'job-4']);
  });
});
