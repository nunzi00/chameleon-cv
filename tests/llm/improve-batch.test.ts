import { describe, expect, it } from 'vitest';

import { parseMasterProfile } from '../../src/core/schema';
import { MemoryLlmCache, locateLabel, runImproveBatch, verificationVocabulary, type LlmProvider, type LlmRequest } from '../../src/llm';
import { fullProfileInput } from '../fixtures/master-profile';

function provider(responses: Record<string, unknown | Error>, calls: LlmRequest[] = []): LlmProvider {
  return {
    id: 'ollama',
    kind: 'local',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'fake',
    complete: (request) => {
      calls.push(request);
      const input = JSON.parse(request.messages[1]?.content ?? '{}') as { id: string };
      const response = responses[input.id];
      if (response instanceof Error) {
        return Promise.resolve({ ok: false, code: 'timeout', message: response.message });
      }
      return Promise.resolve({ ok: true, json: response, raw: JSON.stringify(response), model: 'fake-1', usage: { promptTokens: 10, completionTokens: 5 }, elapsedMs: 42 });
    },
    health: () => Promise.resolve({ ok: true, version: undefined, models: ['fake'], modelAvailable: true }),
  };
}

const profile = parseMasterProfile(fullProfileInput());

describe('runImproveBatch', () => {
  it('verifica cada propuesta con el canon C2, sigue tras un fallo, cachea solo respuestas válidas y reutiliza la caché', async () => {
    const calls: LlmRequest[] = [];
    const cache = new MemoryLlmCache();
    const progress: string[] = [];
    const responses = {
      'ach-acme-latency': {
        proposals: [
          { text: 'Rediseñé la capa de caché y reduje la latencia p95 un 40 %', rationale: 'verbo' },
          { text: 'Reduje la latencia p95 un 40 % migrando a Kubernetes', rationale: 'contexto' },
        ],
      },
      'ach-talk': new Error('tarde'),
    };
    const items = await runImproveBatch({ profile, ids: ['ach-acme-latency', 'ach-talk', 'no-existe'], provider: provider(responses, calls), prompt: 'P', fragment: {}, cache, progress: (line) => progress.push(line) });
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      id: 'ach-acme-latency',
      location: 'Senior Backend Engineer · ACME Corp',
      original: 'Reduje la latencia p95 un **40 %**.',
      impact: '-40 % p95',
      fromCache: false,
      elapsedMs: 42,
      usage: { promptTokens: 10, completionTokens: 5 },
    });
    expect(items[0]?.proposals.map((proposal) => [proposal.verdict.accepted, proposal.verdict.violations.map((violation) => violation.code)])).toEqual([
      [false, ['VIOLATION_C2_CONTEXT_ADDED']],
      [false, ['VIOLATION_C2_ENTITY_ADDED']],
    ]);
    // «caché» termina en «é» y la heurística de verbos la deja pasar (tolerancia deliberada: menos rechazos falsos).
    expect(items[0]?.proposals[0]?.verdict.violations[0]?.details).toEqual(['capa']);
    expect(items[1]).toMatchObject({ id: 'ach-talk', location: 'Logros transversales', error: 'timeout: tarde', proposals: [] });
    expect(items[2]).toMatchObject({ id: 'no-existe', location: 'desconocido', error: 'no existe el logro «no-existe»' });
    expect(progress).toEqual(['[1/3] ach-acme-latency: 0/2 aceptadas · 42 ms', '[2/3] ach-talk: fallo (timeout)', '[3/3] no-existe: no existe']);
    expect(cache.size).toBe(1);
    expect(calls).toHaveLength(2);

    const again = await runImproveBatch({ profile, ids: ['ach-acme-latency'], provider: provider(responses, calls), prompt: 'P', fragment: {}, cache });
    expect(again[0]).toMatchObject({ fromCache: true, elapsedMs: 0, usage: { promptTokens: 10, completionTokens: 5 } });
    expect(again[0]?.proposals).toHaveLength(2);
    expect(calls).toHaveLength(2);

    const uncached = await runImproveBatch({ profile, ids: ['ach-acme-latency'], provider: provider(responses, calls), prompt: 'P', fragment: {} });
    expect(uncached[0]?.fromCache).toBe(false);
    expect(calls).toHaveLength(3);
  });

  it('una entrada de caché que ya no cumple el esquema se ignora y se vuelve a preguntar', async () => {
    const cache = new MemoryLlmCache();
    const calls: LlmRequest[] = [];
    const responses = { 'ach-acme-latency': { proposals: [{ text: 'Reduje la latencia p95 un 40 % en el checkout', rationale: 'r' }] } };
    const first = await runImproveBatch({ profile, ids: ['ach-acme-latency'], provider: provider(responses, calls), prompt: 'P', fragment: {}, cache, now: () => new Date('2026-08-28T00:00:00Z') });
    expect(first[0]?.proposals[0]?.verdict).toEqual({ accepted: false, violations: [{ code: 'VIOLATION_C2_CONTEXT_ADDED', details: ['checkout'] }] });
    // Corrompemos la entrada: el orquestador la descarta y vuelve al proveedor.
    const key = [...(cache as unknown as { entries: Map<string, unknown> }).entries.keys()][0]!;
    await cache.set(key, { createdAt: 'x', model: 'm', raw: '{}', json: { proposals: [] }, usage: {}, elapsedMs: 0 });
    const second = await runImproveBatch({ profile, ids: ['ach-acme-latency'], provider: provider(responses, calls), prompt: 'P', fragment: {}, cache });
    expect(second[0]?.fromCache).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it('el vocabulario vigilado une tags, skills, alias, tecnologías y el diccionario base; locateLabel distingue proyectos', () => {
    const vocabulary = verificationVocabulary(profile);
    for (const term of ['php', 'kubernetes', 'k8s', 'PHP 8', 'TypeScript', 'rendimiento', 'observabilidad']) {
      expect(vocabulary.has(term)).toBe(true);
    }
    const withProject = parseMasterProfile({ ...fullProfileInput(), projects: [{ id: 'p', name: 'Chameleon', achievements: [{ id: 'p-1', text: 'x' }] }] });
    expect(locateLabel(withProject, 'p-1')).toBe('Proyecto Chameleon');
    expect(locateLabel(withProject, 'ach-acme-latency')).toBe('Senior Backend Engineer · ACME Corp');
    expect(locateLabel(withProject, 'ach-talk')).toBe('Logros transversales');
  });
});
