import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { executeImprove, executeSuggestTags, executeSummarize, planImprove, planSuggestTags, planSummarize } from '../../src/app';
import type { LlmProvider, LlmRequest } from '../../src/llm';
import { NodeFileSystem } from '../../src/parsers';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const DATASET = join(__dirname, '../fixtures/dataset');
const NOW = new Date('2026-08-29T10:00:00.000Z');
const BASE = { profile: '/work/profile.json', data: DATASET, build: true, compact: false } as const;

/** Fuentes reales de disco, artefacto y salidas en memoria: lo que un trabajo de la API ve sin terminal. */
function context(): ReturnType<typeof appContext> {
  return appContext(new MemoryFileSystem({}), { datasetFileSystem: new NodeFileSystem(), now: () => NOW });
}

/** Responde una vez y cancela: el lote debe parar antes del siguiente ítem. */
function cancellingProvider(controller: AbortController, calls: LlmRequest[], json: unknown): LlmProvider {
  return {
    id: 'ollama',
    kind: 'local',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'fake',
    health: () => Promise.resolve({ ok: true, version: undefined, models: ['fake'], modelAvailable: true }),
    complete: (request) => {
      calls.push(request);
      controller.abort();
      return Promise.resolve({ ok: true, json, raw: JSON.stringify(json), model: 'fake', usage: {}, elapsedMs: 1 });
    },
  };
}

describe('casos de uso del co-piloto con cancelación', () => {
  it('improve: la señal viaja en cada petición y al cancelar la revisión contiene solo lo procesado', async () => {
    const ctx = context();
    const planned = await planImprove(ctx, { ...BASE, proposals: 1, maxLength: 220, maxItems: 20, redactCompanies: false });
    expect(planned.ok).toBe(true);
    if (!planned.ok) {
      return;
    }
    expect(planned.plan.ids.length).toBeGreaterThan(1);
    const controller = new AbortController();
    const calls: LlmRequest[] = [];
    const progress: string[] = [];
    const outcome = await executeImprove(ctx, planned.plan, {
      provider: cancellingProvider(controller, calls, { proposals: [{ text: 'Propuesta', rationale: 'r' }] }),
      cache: false,
      progress: (line) => progress.push(line),
      signal: controller.signal,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.signal).toBe(controller.signal);
    expect(outcome.cancelled).toBe(true);
    expect(outcome.items).toHaveLength(1);
    expect(progress.at(-1)).toMatch(/cancelado$/);
    expect(outcome.outputPath).toBe('/work/output/revision-improve-2026-08-29.md');
    expect(outcome.text).toContain(outcome.items[0]?.id ?? '');
  });

  it('summarize: con una señal no cancelada el resultado no queda marcado como cancelado', async () => {
    const ctx = context();
    const planned = await planSummarize(ctx, { ...BASE, paragraphs: 1, proposals: 1, maxLength: 900, redactCompanies: false });
    expect(planned.ok).toBe(true);
    if (!planned.ok) {
      return;
    }
    const controller = new AbortController();
    const calls: LlmRequest[] = [];
    const provider = cancellingProvider(controller, calls, { proposals: [{ text: 'Resumen', rationale: 'r' }] });
    const outcome = await executeSummarize(ctx, planned.plan, { provider: { ...provider, complete: (request) => { calls.push(request); return provider.complete(request).then((result) => result); } }, cache: false, signal: controller.signal });
    expect(calls[0]?.signal).toBe(controller.signal);
    expect(outcome.items).toHaveLength(1);
    expect(outcome.outputPath).toBe('/work/output/revision-summarize-2026-08-29.md');
    expect(typeof outcome.cancelled).toBe('boolean');
  });

  it('suggest tags: una petición abortada por la cancelación no se anota como fallo', async () => {
    const ctx = context();
    const planned = await planSuggestTags(ctx, { profile: BASE.profile, data: BASE.data, build: true, untagged: false, maxTags: 3, maxItems: 20, redactCompanies: false });
    expect(planned.ok).toBe(true);
    if (!planned.ok) {
      return;
    }
    const controller = new AbortController();
    const progress: string[] = [];
    const interrupted: LlmProvider = {
      ...cancellingProvider(controller, [], {}),
      complete: () => {
        controller.abort();
        return Promise.resolve({ ok: false, code: 'cancelled', message: 'petición cancelada' });
      },
    };
    const outcome = await executeSuggestTags(ctx, planned.plan, { provider: interrupted, cache: false, progress: (line) => progress.push(line), signal: controller.signal });
    expect(outcome.items).toEqual([]);
    expect(outcome.cancelled).toBe(true);
    expect(progress).toEqual([expect.stringMatching(/^\[1\/\d+\] .*: cancelado$/)]);
  });

  it('suggest tags: al cancelar, el lote se detiene y lo anota en el progreso', async () => {
    const ctx = context();
    const planned = await planSuggestTags(ctx, { profile: BASE.profile, data: BASE.data, build: true, untagged: false, maxTags: 3, maxItems: 20, redactCompanies: false });
    expect(planned.ok).toBe(true);
    if (!planned.ok) {
      return;
    }
    expect(planned.plan.fragments.length).toBeGreaterThan(1);
    const controller = new AbortController();
    const calls: LlmRequest[] = [];
    const progress: string[] = [];
    const outcome = await executeSuggestTags(ctx, planned.plan, { provider: cancellingProvider(controller, calls, { suggestions: [] }), cache: false, progress: (line) => progress.push(line), signal: controller.signal });
    expect(calls).toHaveLength(1);
    expect(outcome.cancelled).toBe(true);
    expect(outcome.items).toHaveLength(1);
    expect(progress.at(-1)).toMatch(/cancelado$/);
  });
});
