import { describe, expect, it } from 'vitest';

import type { LlmConfigResponse } from './api/types';
import { buildSettings, describeCheck, describeModelOptions, describeProvider, describeRuntime, formFromConfig, isLoopbackUrl, lockedFields, quotaMeter } from './settings';

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
    expect(formFromConfig(config())).toMatchObject({ provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080', model: 'qwen' });
    expect(lockedFields(config())).toEqual({ provider: false, baseUrl: false, model: true });
    const defaults = config({ config: { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b-instruct', sources: { provider: 'default', baseUrl: 'default', model: 'default' } } });
    expect(formFromConfig(defaults)).toMatchObject({ provider: 'ollama', baseUrl: '', model: '' });
    const invalid = config({ config: undefined, configError: 'Configuración inválida' });
    expect(formFromConfig(invalid)).toMatchObject({ provider: 'ollama', baseUrl: '', model: '' });
    expect(lockedFields(invalid)).toEqual({ provider: false, baseUrl: false, model: false });
    expect(lockedFields(config({ config: { provider: 'ollama', baseUrl: 'x', model: 'y', sources: { provider: 'flag', baseUrl: 'env', model: 'file' } } }))).toEqual({ provider: true, baseUrl: true, model: false });
  });

  it('buildSettings exige URL loopback, omite vacíos y conserva los modelos por defecto de los remotos', () => {
    expect(buildSettings({ provider: 'ollama', baseUrl: ' ', model: '  ', runtimeRunner: '', runtimeImage: '' }, undefined)).toEqual({ ok: true, value: { provider: 'ollama' } });
    expect(buildSettings({ provider: 'openai-compatible', baseUrl: ' http://127.0.0.1:8080 ', model: ' qwen ', runtimeRunner: '', runtimeImage: '' }, { groq: 'openai/gpt-oss-20b' })).toEqual({
      ok: true,
      value: { provider: 'openai-compatible', base_url: 'http://127.0.0.1:8080', model: 'qwen', models: { groq: 'openai/gpt-oss-20b' } },
    });
    expect(buildSettings({ provider: 'ollama', baseUrl: '', model: '', runtimeRunner: '', runtimeImage: '' }, {})).toEqual({ ok: true, value: { provider: 'ollama' } });
    expect(buildSettings({ provider: 'ollama', baseUrl: 'https://api.openai.com', model: '', runtimeRunner: '', runtimeImage: '' }, undefined)).toMatchObject({ ok: false, message: expect.stringMatching(/loopback/) as string });
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

describe('describeRuntime (T-8.8)', () => {
  const base = { runner: 'native' as const, managed: false, running: false, model: { name: 'qwen2.5:7b', present: false }, log: '/h/serve.log', disabled: undefined, detail: 'Ollama parado · runner native disponible' };

  it('deshabilitado: ni arrancar ni parar, con el motivo como pista', () => {
    const view = describeRuntime({ ...base, runner: 'none', disabled: 'dentro del contenedor de Compose…', detail: 'dentro del contenedor de Compose…' });
    expect(view).toMatchObject({ tone: 'warn', badge: 'no disponible', canStart: false, canStop: false, startHint: 'dentro del contenedor de Compose…', needsPull: false });
  });

  it('parado: se puede arrancar si hay runner (descargando el modelo si falta); sin runner, la pista lo explica', () => {
    expect(describeRuntime(base)).toMatchObject({ tone: 'warn', badge: 'parado', canStart: true, canStop: false, startLabel: 'Arrancar Ollama con «qwen2.5:7b»', startHint: undefined, needsPull: true });
    expect(describeRuntime({ ...base, model: { name: 'qwen2.5:7b', present: true } }).needsPull).toBe(false);
    expect(describeRuntime({ ...base, runner: 'none' })).toMatchObject({ canStart: false, startHint: 'No hay ollama ni Docker en esta máquina' });
  });

  it('en marcha: parar solo si lo arrancó cv; arrancar solo si falta el modelo (entonces es descargar)', () => {
    const ready = describeRuntime({ ...base, running: true, managed: true, model: { name: 'qwen2.5:7b', present: true }, detail: 'Ollama en marcha (native, lo arrancó cv)' });
    expect(ready).toMatchObject({ tone: 'ok', badge: 'en marcha (native, lo arrancó cv)', canStart: false, canStop: true, startHint: 'Ollama ya está en marcha con el modelo', needsPull: false });
    const foreign = describeRuntime({ ...base, running: true, managed: false, runner: 'none', detail: 'Ollama en marcha (no lo arrancó cv)' });
    expect(foreign).toMatchObject({ tone: 'warn', badge: 'en marcha (no lo arrancó cv)', canStart: true, canStop: false, startLabel: 'Descargar «qwen2.5:7b»', needsPull: true });
  });
});

describe('[llm.runtime] en el formulario (T-8.8, S3)', () => {
  const config = {
    llm: {
      config: { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen', sources: { provider: 'file', baseUrl: 'default', model: 'file' } },
      settings: { path: '/w/cv.toml', present: true, configured: true, error: undefined, values: { provider: 'ollama', model: 'qwen', models: { groq: 'openai/gpt-oss-120b' }, runtime: { runner: 'docker', image: 'ollama/ollama:x' } } },
    },
  } as unknown as LlmConfigResponse;

  it('el formulario parte de [llm.runtime] y el guardado lo conserva junto a [llm.models]', () => {
    const form = formFromConfig(config);
    expect(form).toMatchObject({ runtimeRunner: 'docker', runtimeImage: 'ollama/ollama:x' });
    const built = buildSettings(form, config.llm.settings.values?.models);
    expect(built.ok && built.value).toEqual({ provider: 'ollama', model: 'qwen', models: { groq: 'openai/gpt-oss-120b' }, runtime: { runner: 'docker', image: 'ollama/ollama:x' } });
    const cleared = buildSettings({ ...form, runtimeRunner: '', runtimeImage: '  ' }, undefined);
    expect(cleared.ok && 'runtime' in cleared.value).toBe(false);
    const noValues = formFromConfig({ ...config, llm: { ...config.llm, settings: { ...config.llm.settings, values: undefined } } } as LlmConfigResponse);
    expect(noValues).toMatchObject({ runtimeRunner: '', runtimeImage: '' });
  });
});

describe('quotaMeter (T-8.6 S3)', () => {
  it('convierte la cuota viva en porcentaje usado, prefiriendo peticiones y cayendo a tokens', () => {
    expect(quotaMeter(undefined)).toBeUndefined();
    expect(quotaMeter({ remainingRequests: 28, limitRequests: 30, observedAt: 'x' } as never)).toEqual({ percent: 7 });
    expect(quotaMeter({ remainingTokens: 0, limitTokens: 100, observedAt: 'x' } as never)).toEqual({ percent: 100 });
    expect(quotaMeter({ remainingRequests: 5, limitRequests: 0, remainingTokens: 90, limitTokens: 100, observedAt: 'x' } as never)).toEqual({ percent: 10 });
    expect(quotaMeter({ retryAfterSeconds: 3, observedAt: 'x' } as never)).toBeUndefined();
  });
});
