import { describe, expect, it } from 'vitest';

import { parseMasterProfile } from '../../src/core/schema';
import { runImproveBatch, type LlmProvider, type LlmRequest } from '../../src/llm';
import { fullProfileInput } from '../fixtures/master-profile';

const profile = parseMasterProfile(fullProfileInput());

describe('runImproveBatch y la cuota agotada', () => {
  it('con la espera desactivada, registra el fallo, lo dice y no sigue con los demás', async () => {
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
    const items = await runImproveBatch({ profile, ids: ['ach-acme-latency', 'ach-talk'], provider, prompt: 'P', fragment: {}, progress: (line) => progress.push(line), quotaRetry: { attempts: 0 } });
    expect(calls).toHaveLength(1);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'ach-acme-latency', proposals: [], error: expect.stringMatching(/^quota-exceeded: /) as string });
    expect(progress).toEqual(['[1/2] ach-acme-latency: cuota agotada; el lote se detiene (Servidor compatible con OpenAI: cuota agotada, HTTP 429 (el proveedor pide esperar 7 s); no se reintenta)']);
  });

  it('por defecto espera lo que el proveedor pide y reintenta, y el lote sigue si la cuota vuelve', async () => {
    // Encargo del PO (1-sep): con un plan gratuito, perder media tanda por quince segundos no tiene sentido.
    const esperas: number[] = [];
    let intentos = 0;
    const provider: LlmProvider = {
      id: 'groq',
      kind: 'remote',
      baseUrl: 'https://api.groq.com/openai',
      model: 'openai/gpt-oss-120b',
      complete: () => {
        intentos += 1;
        return intentos === 1
          ? Promise.resolve({ ok: false as const, code: 'quota-exceeded' as const, message: 'cuota agotada (el proveedor pide esperar 7 s)', retryAfterSeconds: 7 })
          : Promise.resolve({ ok: true as const, json: { proposals: [{ text: 'Reduje la latencia p95 del checkout un 40 %.', rationale: 'r' }] }, raw: '{}', model: 'm', usage: {}, elapsedMs: 3 });
      },
      health: () => Promise.resolve({ ok: true, version: undefined, models: [], modelAvailable: true }),
    };
    const progress: string[] = [];
    const items = await runImproveBatch({
      profile,
      ids: ['ach-acme-latency'],
      provider,
      prompt: 'P',
      fragment: {},
      progress: (line) => progress.push(line),
      quotaRetry: { wait: (ms) => { esperas.push(ms); return Promise.resolve(); } },
    });
    expect(esperas).toEqual([7000]);
    expect(items[0]?.error).toBeUndefined();
    expect(progress[0]).toContain('espero 7 s y reintento (1/2) · cancela para no esperar');
  });

  it('no espera lo que no cabe en una sesión, ni cuando el proveedor no dice cuánto', async () => {
    const esperas: number[] = [];
    const failing = (retryAfterSeconds?: number): LlmProvider => ({
      id: 'groq',
      kind: 'remote',
      baseUrl: 'https://api.groq.com/openai',
      model: 'm',
      complete: () => Promise.resolve({ ok: false as const, code: 'quota-exceeded' as const, message: 'cuota agotada', ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) }),
      health: () => Promise.resolve({ ok: true, version: undefined, models: [], modelAvailable: true }),
    });
    const run = async (provider: LlmProvider, progress: string[]): Promise<void> => {
      await runImproveBatch({ profile, ids: ['ach-acme-latency'], provider, prompt: 'P', fragment: {}, progress: (line) => progress.push(line), quotaRetry: { wait: (ms) => { esperas.push(ms); return Promise.resolve(); } } });
    };
    // Una cuota diaria («espera una hora») no se aguarda: se para y se dice por qué.
    const larga: string[] = [];
    await run(failing(3600), larga);
    expect(larga[0]).toContain('más de los 120 s que se aguardan');
    // Y sin «retry-after» no se inventa una espera.
    const muda: string[] = [];
    await run(failing(), muda);
    expect(muda[0]).toContain('no dice cuánto esperar');
    expect(esperas).toEqual([]);
  });

  it('cancelar durante la espera la corta y no reintenta', async () => {
    const controller = new AbortController();
    let intentos = 0;
    const provider: LlmProvider = {
      id: 'groq',
      kind: 'remote',
      baseUrl: 'https://api.groq.com/openai',
      model: 'm',
      complete: () => {
        intentos += 1;
        return Promise.resolve({ ok: false as const, code: 'quota-exceeded' as const, message: 'cuota agotada', retryAfterSeconds: 5 });
      },
      health: () => Promise.resolve({ ok: true, version: undefined, models: [], modelAvailable: true }),
    };
    await runImproveBatch({
      profile,
      ids: ['ach-acme-latency'],
      provider,
      prompt: 'P',
      fragment: {},
      signal: controller.signal,
      // La espera es donde el usuario pulsa «cancelar»: al volver, no se reintenta.
      quotaRetry: { wait: () => { controller.abort(); return Promise.resolve(); } },
    });
    expect(intentos).toBe(1);
  });
});
