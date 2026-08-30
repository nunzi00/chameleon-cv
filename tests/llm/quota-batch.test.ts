import { describe, expect, it } from 'vitest';

import { parseMasterProfile } from '../../src/core/schema';
import { runImproveBatch, type LlmProvider, type LlmRequest } from '../../src/llm';
import { fullProfileInput } from '../fixtures/master-profile';

const profile = parseMasterProfile(fullProfileInput());

describe('runImproveBatch y la cuota agotada (C11: sin reintentos)', () => {
  it('registra el fallo del logro en curso, lo dice en el progreso y no sigue con los demás', async () => {
    const calls: LlmRequest[] = [];
    const provider: LlmProvider = {
      id: 'groq',
      kind: 'remote',
      baseUrl: 'https://api.groq.com/openai',
      model: 'openai/gpt-oss-120b',
      complete: (request) => {
        calls.push(request);
        return Promise.resolve({ ok: false, code: 'quota-exceeded', message: 'Servidor compatible con OpenAI: cuota agotada, HTTP 429 (el proveedor pide esperar 7 s); no se reintenta', retryAfterSeconds: 7 });
      },
      health: () => Promise.resolve({ ok: true, version: undefined, models: ['openai/gpt-oss-120b'], modelAvailable: true }),
    };
    const progress: string[] = [];
    const items = await runImproveBatch({ profile, ids: ['ach-acme-latency', 'ach-talk'], provider, prompt: 'P', fragment: {}, progress: (line) => progress.push(line) });
    expect(calls).toHaveLength(1);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'ach-acme-latency', proposals: [], error: expect.stringMatching(/^quota-exceeded: /) as string });
    expect(progress).toEqual(['[1/2] ach-acme-latency: cuota agotada; el lote se detiene (Servidor compatible con OpenAI: cuota agotada, HTTP 429 (el proveedor pide esperar 7 s); no se reintenta)']);
  });
});
