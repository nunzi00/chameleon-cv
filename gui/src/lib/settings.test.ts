import { describe, expect, it } from 'vitest';

import type { LlmConfigResponse } from './api/types';
import { buildSettings, describeCheck, describeProvider, formFromConfig, isLoopbackUrl, lockedFields, describeModelOptions } from './settings';

const GROQ: LlmConfigResponse['llm']['providers'][number] = {
  id: 'groq',
  plan: 'free',
  availability: 'pending-verification',
  availabilityNote: 'pendiente de la verificación al alta por una persona (docs/copilot-providers.md §9): no se puede seleccionar hasta entonces',
  host: 'api.groq.com',
  baseUrl: 'https://api.groq.com/openai',
  defaultModel: 'openai/gpt-oss-120b',
  models: [
    { id: 'openai/gpt-oss-120b', status: 'production', recommendedFor: ['improve', 'summarize'], note: 'calidad', sourceUrl: 'https://console.groq.com/docs/model/openai/gpt-oss-120b', verifiedAt: '2026-08-30' },
    { id: 'qwen/qwen3.8-27b', status: 'preview', recommendedFor: ['suggest-tags', 'improve', 'summarize'], note: 'cuota', sourceUrl: 'https://console.groq.com/docs/model/qwen/qwen3.8-27b', verifiedAt: '2026-08-30' },
  ],
  keyPresence: 'none',
  quota: { requestsPerMinute: 30, requestsPerDay: 1000, tokensPerMinute: 8000, tokensPerDay: 200000, note: '', sourceUrl: 'https://console.groq.com/docs/rate-limits', verifiedAt: '2026-08-30' },
  rateLimitsUrl: 'https://console.groq.com/docs/rate-limits',
  c7: { sourceUrl: 'https://console.groq.com/docs/legal/services-agreement', verifiedAt: '2026-08-30', quote: 'Groq is not permitted to use Inputs or Outputs for training…' },
  live: undefined,
};

function config(overrides: Partial<LlmConfigResponse['llm']> = {}): LlmConfigResponse {
  return {
    llm: {
      config: { provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080', model: 'qwen', sources: { provider: 'file', baseUrl: 'file', model: 'env' } },
      configError: undefined,
      health: undefined,
      keys: { openai: 'none', anthropic: 'none', groq: 'none' },
      keysFile: '/h/.config/chameleon-cv/keys.json',
      allowedHosts: [],
      remote: undefined,
      usable: false,
      settings: { path: '/work/cv.toml', present: true, configured: true, error: undefined },
      providers: [GROQ],
      ...overrides,
    },
    file: { path: '/work/cv.toml', present: true, sha256: 'abc' },
    remote: { allowed: false },
  };
}

describe('ajustes del co-piloto', () => {
  it('isLoopbackUrl acepta localhost, 127.x e ::1 con http(s) y rechaza el resto', () => {
    expect(isLoopbackUrl('http://127.0.0.1:8080')).toBe(true);
    expect(isLoopbackUrl('http://localhost:11434/')).toBe(true);
    expect(isLoopbackUrl('https://[::1]:8443')).toBe(true);
    expect(isLoopbackUrl('http://192.168.1.2:11434')).toBe(false);
    expect(isLoopbackUrl('ftp://127.0.0.1')).toBe(false);
    expect(isLoopbackUrl('no es una url')).toBe(false);
  });

  it('el formulario parte de la configuración efectiva y sabe qué fija el entorno', () => {
    expect(formFromConfig(config())).toEqual({ provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080', model: 'qwen' });
    expect(lockedFields(config())).toEqual({ provider: false, baseUrl: false, model: true });
    const defaults = config({ config: { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b-instruct', sources: { provider: 'default', baseUrl: 'default', model: 'default' } } });
    expect(formFromConfig(defaults)).toEqual({ provider: 'ollama', baseUrl: '', model: '' });
    const invalid = config({ config: undefined, configError: 'Configuración inválida' });
    expect(formFromConfig(invalid)).toEqual({ provider: 'ollama', baseUrl: '', model: '' });
    expect(lockedFields(invalid)).toEqual({ provider: false, baseUrl: false, model: false });
    expect(lockedFields(config({ config: { provider: 'ollama', baseUrl: 'x', model: 'y', sources: { provider: 'flag', baseUrl: 'env', model: 'file' } } }))).toEqual({ provider: true, baseUrl: true, model: false });
  });

  it('buildSettings exige URL loopback, omite vacíos y conserva los modelos por defecto de los remotos', () => {
    expect(buildSettings({ provider: 'ollama', baseUrl: ' ', model: '  ' }, undefined)).toEqual({ ok: true, value: { provider: 'ollama' } });
    expect(buildSettings({ provider: 'openai-compatible', baseUrl: ' http://127.0.0.1:8080 ', model: ' qwen ' }, { groq: 'openai/gpt-oss-20b' })).toEqual({
      ok: true,
      value: { provider: 'openai-compatible', base_url: 'http://127.0.0.1:8080', model: 'qwen', models: { groq: 'openai/gpt-oss-20b' } },
    });
    expect(buildSettings({ provider: 'ollama', baseUrl: '', model: '' }, {})).toEqual({ ok: true, value: { provider: 'ollama' } });
    expect(buildSettings({ provider: 'ollama', baseUrl: 'https://api.openai.com', model: '' }, undefined)).toMatchObject({ ok: false, message: expect.stringMatching(/loopback/) as string });
  });

  it('describe cada proveedor (clave, plan, cuota publicada y viva) y el resultado de comprobar', () => {
    expect(describeProvider(GROQ)).toEqual({
      key: 'sin clave',
      hasKey: false,
      plan: 'plan gratuito',
      quota: '30 peticiones/min, 1000 peticiones/día, 8000 tokens/min, 200000 tokens/día (según https://console.groq.com/docs/rate-limits, 2026-08-30)',
      live: undefined,
    });
    expect(describeProvider({ ...GROQ, keyPresence: 'env', plan: 'paid', quota: undefined, live: { provider: 'groq', observedAt: '2026-08-30T12:00:00.000Z', remainingRequests: 28, limitRequests: 30, resetRequestsSeconds: 12, remainingTokens: 7000, retryAfterSeconds: 3 } })).toEqual({
      key: 'clave en el entorno',
      hasKey: true,
      plan: 'plan de pago (límites según la cuenta)',
      quota: undefined,
      live: 'quedan 28/30 peticiones (se renueva en 12 s) · 7000/? tokens · reintentar en 3 s · leída 2026-08-30T12:00:00.000Z',
    });
    expect(describeProvider({ ...GROQ, keyPresence: 'file', quota: { note: '', sourceUrl: 'https://x', verifiedAt: '2026-08-30', requestsPerDay: 50 }, live: { provider: 'groq', observedAt: 'x', limitTokens: 8000, resetTokensSeconds: 8 } })).toMatchObject({ hasKey: true, quota: '50 peticiones/día (según https://x, 2026-08-30)', live: 'quedan ?/8000 tokens (se renueva en 8 s) · leída x' });
    expect(describeProvider({ ...GROQ, keyPresence: 'insecure-file', live: { provider: 'groq', observedAt: 'x' } })).toMatchObject({ key: 'fichero de claves con permisos abiertos (chmod 600)', live: 'sin datos · leída x' });
    expect(describeProvider({ ...GROQ, keyPresence: 'invalid-file' }).key).toBe('fichero de claves inválido');
    expect(describeProvider({ ...GROQ, live: { provider: 'groq', observedAt: 'x', limitRequests: 30 } }).live).toBe('quedan ?/30 peticiones · leída x');
    expect(describeProvider({ ...GROQ, live: { provider: 'groq', observedAt: 'x', remainingRequests: 3 } }).live).toBe('quedan 3/? peticiones · leída x');
    expect(describeProvider({ ...GROQ, quota: { note: '', sourceUrl: 'https://x', verifiedAt: '2026-08-30', tokensPerMinute: 8000 } }).quota).toBe('8000 tokens/min (según https://x, 2026-08-30)');
    expect(describeProvider({ ...GROQ, live: { provider: 'groq', observedAt: 'x', remainingTokens: 5, resetTokensSeconds: 2 } }).live).toBe('quedan 5/? tokens (se renueva en 2 s) · leída x');
    expect(describeCheck({ provider: 'ollama', kind: 'local', ok: true, models: ['a', 'b'], modelAvailable: true, message: undefined, quota: undefined })).toBe('Responde: 2 modelos (a, b) · el modelo configurado está disponible');
    expect(describeCheck({ provider: 'ollama', kind: 'local', ok: false, models: ['a'], modelAvailable: false, message: 'el modelo configurado «x» no está disponible', quota: undefined })).toBe('Responde: 1 modelo (a) · el modelo configurado «x» no está disponible');
    expect(describeCheck({ provider: 'ollama', kind: 'local', ok: false, models: ['a'], modelAvailable: false, message: undefined, quota: undefined })).toBe('Responde: 1 modelo (a) · el modelo configurado no está disponible');
    expect(describeCheck({ provider: 'ollama', kind: 'local', ok: false, models: [], modelAvailable: false, message: 'ECONNREFUSED', quota: undefined })).toBe('No responde: ECONNREFUSED');
    expect(describeCheck({ provider: 'ollama', kind: 'local', ok: false, models: [], modelAvailable: false, message: undefined, quota: undefined })).toBe('No responde: sin detalle');
    expect(describeCheck({ provider: 'groq', kind: 'remote', ok: true, models: ['1', '2', '3', '4', '5', '6', '7'], modelAvailable: true, message: undefined, quota: undefined })).toBe('Responde: 7 modelos (1, 2, 3, 4, 5, 6, …) · el modelo configurado está disponible');
    expect(describeCheck({ provider: 'groq', kind: 'remote', ok: true, models: [], modelAvailable: true, message: undefined, quota: undefined })).toBe('Responde: ningún modelo · el modelo configurado está disponible');
  });
});

describe('describeModelOptions', () => {
  it('lista los modelos con su estado y las tareas recomendadas; con uno solo no dice nada', () => {
    expect(describeModelOptions(GROQ.models)).toBe('openai/gpt-oss-120b (estable; mejorar logros, resumir) · qwen/qwen3.8-27b (preview; sugerir etiquetas, mejorar logros, resumir)');
    expect(describeModelOptions(GROQ.models.slice(0, 1))).toBeUndefined();
  });
});
