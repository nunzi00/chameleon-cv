import { describe, expect, it } from 'vitest';

import { KIND_LABELS, STATUS_LABELS, applyJobEvent, describeResult, describeSending, isFinished, upsertJob, type JobSnapshot } from './jobs';

const job: JobSnapshot = { id: 'j1', kind: 'improve', status: 'running', createdAt: '2026-08-30T00:00:00.000Z', startedAt: '2026-08-30T00:00:01.000Z', finishedAt: undefined, lines: [], result: undefined, error: undefined };

describe('trabajos del co-piloto', () => {
  it('aplica los eventos SSE: status sustituye (solo el mismo id), line añade, el resto no cambia nada', () => {
    const done = { ...job, status: 'done' as const, lines: ['a'], result: { ok: true } };
    expect(applyJobEvent(job, { event: 'status', data: done, raw: '' })).toEqual(done);
    expect(applyJobEvent(job, { event: 'status', data: { ...done, id: 'otro' }, raw: '' })).toBe(job);
    expect(applyJobEvent(job, { event: 'status', data: 'roto', raw: '' })).toBe(job);
    expect(applyJobEvent(job, { event: 'line', data: { line: '[1/2] x' }, raw: '' }).lines).toEqual(['[1/2] x']);
    expect(applyJobEvent(job, { event: 'line', data: { nada: true }, raw: '' })).toBe(job);
    expect(applyJobEvent(job, { event: 'message', data: 'x', raw: 'x' })).toBe(job);
  });

  it('upsert, estados y etiquetas', () => {
    const list = upsertJob([], job);
    expect(upsertJob(list, { ...job, id: 'j2' }).map((entry) => entry.id)).toEqual(['j2', 'j1']);
    expect(upsertJob(list, { ...job, status: 'done' })[0]?.status).toBe('done');
    expect(isFinished('done')).toBe(true);
    expect(isFinished('running')).toBe(false);
    expect(STATUS_LABELS.cancelled).toBe('cancelado');
    expect(KIND_LABELS['suggest-tags']).toBe('Sugerir etiquetas');
  });

  it('describe el resultado de cada tarea, el cancelado y lo ilegible', () => {
    expect(describeResult('improve', { review: { name: 'revision-x.md', path: 'output/revision-x.md', sha256: 'h' }, stats: { items: 2, proposals: 4, accepted: 3, rejected: 1, failed: 0, fromCache: 0 } })).toEqual({ summary: 'Revisión escrita en output/revision-x.md: 2 ítems · 4 propuestas · 3 aceptadas · 1 rechazadas (C2) · 0 fallidos · 0 desde caché', review: { name: 'revision-x.md', path: 'output/revision-x.md' }, lines: [] });
    expect(describeResult('summarize', { review: { name: 'r.md', path: 'output/r.md' } })).toMatchObject({ summary: expect.stringContaining('0 ítems') });
    expect(describeResult('improve', { cancelled: true, processed: 1 })).toEqual({ summary: 'Cancelado: 1 procesados, sin revisión escrita', review: undefined, lines: [] });
    expect(describeResult('improve', { cancelled: true })).toMatchObject({ summary: 'Cancelado: 0 procesados, sin revisión escrita' });
    expect(describeResult('improve', {})).toBeUndefined();
    expect(describeResult('improve', 'texto')).toBeUndefined();
    expect(describeResult('suggest-tags', { items: [{ id: 'ach-1', line: '#php #k8s' }, { id: undefined, line: '' }, { id: 'ach-2', error: 'timeout' }, { error: 'sin id' }], stats: { items: 4, suggested: 2, fresh: 1, rejected: 0, failed: 2 } })).toEqual({ summary: '4 fragmentos · 2 etiquetas sugeridas (1 nuevas) · 0 rechazadas · 2 fallidos', review: undefined, lines: ['ach-1: #php #k8s', 'texto: ninguna etiqueta del diccionario encaja', 'ach-2: fallo (timeout)', 'texto: fallo (sin id)'] });
    expect(describeResult('suggest-tags', { cancelled: true, items: [] })).toMatchObject({ summary: 'Cancelado tras 0 fragmentos' });
    expect(describeResult('suggest-tags', {})).toMatchObject({ summary: '0 fragmentos · 0 etiquetas sugeridas (0 nuevas) · 0 rechazadas · 0 fallidos', lines: [] });
  });

  it('describe qué sale y a dónde', () => {
    expect(describeSending({ destination: 'ollama (http://127.0.0.1:11434, local; modelo m)', items: 1, words: 12, redactCompanies: false })).toBe('hacia ollama (http://127.0.0.1:11434, local; modelo m) · 1 fragmento · 12 palabras · sin nombre ni datos de contacto');
    expect(describeSending({ destination: 'x', items: 3, scope: 'diccionario cerrado de 9 etiquetas', redactCompanies: true })).toBe('hacia x · 3 fragmentos · diccionario cerrado de 9 etiquetas · sin empresas');
    expect(describeSending({})).toBe('sin nombre ni datos de contacto');
  });
});
