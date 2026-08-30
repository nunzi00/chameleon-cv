import { describe, expect, it } from 'vitest';

import { EMPTY_COPILOT_FORM } from './form';
import type { JobSnapshot } from './jobs';
import { TASK_OPTIONS, describePlan, jobCounts, jobProgress } from './plan';

const remote = { id: 'groq', label: 'groq · plan gratuito · clave en el entorno', defaultModel: 'openai/gpt-oss-120b', usable: true };

describe('describePlan', () => {
  it('improve: local por defecto, logros de la selección o los indicados, especialidad y privacidad', () => {
    expect(describePlan(EMPTY_COPILOT_FORM, { local: 'ollama · qwen2.5:7b', remote: undefined })).toEqual({
      destination: 'ollama · qwen2.5:7b · tu máquina',
      sends: 'los logros de la selección; ni nombre ni contacto',
      writes: 'output/revision-improve-<fecha>.md · las fuentes no se tocan',
    });
    const plan = describePlan({ ...EMPTY_COPILOT_FORM, only: 'a b', specialty: 'backend', redactCompanies: true, output: 'mia.md', provider: 'groq' }, { local: undefined, remote });
    expect(plan).toEqual({ destination: 'groq (remoto) · exige consentimiento', sends: '2 logros indicados y la especialidad «backend»; ni nombre ni contacto ni empresas', writes: 'output/mia.md · las fuentes no se tocan' });
    expect(describePlan({ ...EMPTY_COPILOT_FORM, only: 'solo-uno', provider: 'otro' }, { local: undefined, remote: undefined }).sends).toContain('1 logro indicado');
    expect(describePlan({ ...EMPTY_COPILOT_FORM, provider: 'otro' }, { local: undefined, remote: undefined }).destination).toBe('otro (remoto) · exige consentimiento');
    expect(describePlan(EMPTY_COPILOT_FORM, { local: undefined, remote: undefined }).destination).toBe('proveedor local · tu máquina');
  });

  it('summarize y suggest-tags describen lo que sale y lo que se escribe', () => {
    expect(describePlan({ ...EMPTY_COPILOT_FORM, kind: 'summarize', offerMode: 'text' }, { local: 'x', remote: undefined }).sends).toBe('el perfil recortado y la oferta; ni nombre ni contacto');
    expect(describePlan({ ...EMPTY_COPILOT_FORM, kind: 'summarize' }, { local: 'x', remote: undefined }).sends).toBe('el perfil recortado; ni nombre ni contacto');
    const tags = describePlan({ ...EMPTY_COPILOT_FORM, kind: 'suggest-tags' }, { local: 'x', remote: undefined });
    expect(tags.sends).toBe('los logros del perfil y el vocabulario de etiquetas; ni nombre ni contacto');
    expect(tags.writes).toBe('nada: las etiquetas se muestran aquí');
    expect(describePlan({ ...EMPTY_COPILOT_FORM, kind: 'suggest-tags', untagged: true }, { local: 'x', remote: undefined }).sends).toContain('los logros sin etiquetas');
    expect(describePlan({ ...EMPTY_COPILOT_FORM, kind: 'suggest-tags', text: 'Migré…' }, { local: 'x', remote: undefined }).sends).toContain('el texto suelto');
  });

  it('TASK_OPTIONS cubre las tres tareas con su orden', () => {
    expect(TASK_OPTIONS.map((task) => task.kind)).toEqual(['improve', 'summarize', 'suggest-tags']);
  });
});

describe('jobProgress y jobCounts', () => {
  it('lee la última línea [i/n] y calcula el porcentaje; sin ella, undefined', () => {
    expect(jobProgress(['[1/8] exp-acme-1', 'nota', '[5/8] ach-observability'])).toEqual({ current: 5, total: 8, percent: 63, label: 'ach-observability' });
    expect(jobProgress(['[3/0]'])).toEqual({ current: 3, total: 1, percent: 100, label: '' });
    expect(jobProgress(['sin progreso'])).toBeUndefined();
    expect(jobProgress([])).toBeUndefined();
  });

  it('cuenta los trabajos en curso y los de hoy', () => {
    const base: JobSnapshot = { id: 'a', kind: 'improve', status: 'done', createdAt: '2026-08-30T10:00:00.000Z', startedAt: undefined, finishedAt: undefined, lines: [], result: undefined, error: undefined };
    const jobs = [base, { ...base, id: 'b', status: 'running' as const }, { ...base, id: 'c', status: 'queued' as const, createdAt: '2026-08-29T10:00:00.000Z' }];
    expect(jobCounts(jobs, new Date('2026-08-30T15:00:00.000Z'))).toEqual({ running: 2, today: 2 });
  });
});
