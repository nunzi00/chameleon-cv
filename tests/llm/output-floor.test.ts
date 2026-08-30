/**
 * Suelo de tokens de salida para modelos que razonan (verificación Groq del 30-ago-2026): gpt-oss-120b con el
 * techo de la tarea (600) devolvía la generación vacía (json_validate_failed); el registro declara un suelo y
 * las tareas y los estimadores elevan el techo hasta él — el consentimiento nunca miente.
 */
import { describe, expect, it } from 'vitest';

import { defaultAssets } from '../../src/shared/assets';
import { improveEstimate, suggestTagsEstimate, summarizeEstimate } from '../../src/app/copilot';
import { IMPROVE_LIMITS, runImprove } from '../../src/llm/tasks/improve';
import { SUMMARIZE_LIMITS, runSummarize } from '../../src/llm/tasks/summarize';
import { SUGGEST_TAGS_LIMITS, runSuggestTags } from '../../src/llm/tasks/suggest-tags';
import { createOpenAiCompatibleProvider } from '../../src/llm/openai-compatible';
import { outputTokensFloorFor } from '../../src/llm/registry';
import type { LlmProvider, LlmRequest } from '../../src/llm/provider';

function recording(outputTokensFloor?: number): { provider: LlmProvider; requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  const provider: LlmProvider = {
    id: 'ollama',
    kind: 'local',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'stub',
    ...(outputTokensFloor === undefined ? {} : { outputTokensFloor }),
    complete: async (request) => {
      requests.push(request);
      return { ok: false, code: 'unreachable', message: 'stub' };
    },
    health: async () => ({ ok: false, code: 'unreachable', message: 'stub' }),
  };
  return { provider, requests };
}

describe('outputTokensFloorFor (datos del registro)', () => {
  it('devuelve el suelo del modelo elegido, el del modelo por defecto, y 0 para el resto', () => {
    expect(outputTokensFloorFor('groq', 'openai/gpt-oss-120b')).toBe(4000);
    expect(outputTokensFloorFor('groq', undefined)).toBe(4000);
    expect(outputTokensFloorFor('groq', '  ')).toBe(4000);
    expect(outputTokensFloorFor('groq', 'qwen/qwen3.8-27b')).toBe(0);
    expect(outputTokensFloorFor('groq', 'desconocido')).toBe(0);
    expect(outputTokensFloorFor('openai', undefined)).toBe(0);
    expect(outputTokensFloorFor('ollama', undefined)).toBe(0);
    expect(outputTokensFloorFor(undefined, undefined)).toBe(0);
  });
});

describe('el proveedor expone el suelo y las tareas elevan el techo', () => {
  it('createOpenAiCompatibleProvider expone outputTokensFloor solo si se le da', () => {
    expect(createOpenAiCompatibleProvider({ outputTokensFloor: 4000 }).outputTokensFloor).toBe(4000);
    expect(createOpenAiCompatibleProvider({}).outputTokensFloor).toBeUndefined();
  });

  it('improve, summarize y suggest-tags piden max(techo de la tarea, suelo del proveedor)', async () => {
    const floored = recording(4000);
    await runImprove(floored.provider, { input: { text: 'x' } } as never, 'prompt');
    await runSummarize(floored.provider, { input: { text: 'x' } } as never, 'prompt');
    await runSuggestTags(floored.provider, { input: { text: 'x', dictionary: ['php'] } } as never, 'prompt');
    expect(floored.requests.map((request) => request.maxTokens)).toEqual([4000, 4000, 4000]);
    const bare = recording();
    await runImprove(bare.provider, { input: { text: 'x' } } as never, 'prompt');
    await runSummarize(bare.provider, { input: { text: 'x' } } as never, 'prompt');
    await runSuggestTags(bare.provider, { input: { text: 'x', dictionary: ['php'] } } as never, 'prompt');
    expect(bare.requests.map((request) => request.maxTokens)).toEqual([IMPROVE_LIMITS.maxTokens, SUMMARIZE_LIMITS.maxTokens, SUGGEST_TAGS_LIMITS.maxTokens]);
  });

  it('los estimadores del consentimiento usan el mismo techo efectivo', async () => {
    const context = { assets: defaultAssets() } as never;
    const plan = { fragments: [{ input: { text: 'x' } }], words: 1, ids: ['a'] } as never;
    const single = { fragment: { input: { text: 'x' } } } as never;
    expect((await improveEstimate(context, plan, 4000)).maxOutputTokens).toBe(4000);
    expect((await improveEstimate(context, plan)).maxOutputTokens).toBe(IMPROVE_LIMITS.maxTokens);
    expect((await summarizeEstimate(context, single, 4000)).maxOutputTokens).toBe(4000);
    expect((await suggestTagsEstimate(context, plan, 4000)).maxOutputTokens).toBe(4000);
  });
});
