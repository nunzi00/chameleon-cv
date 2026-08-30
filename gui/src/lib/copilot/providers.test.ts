import { describe, expect, it } from 'vitest';

import type { LlmConfigResponse } from '../api/types';
import { remoteProviderOptions } from './providers';

function config(providers: { id: string; plan: 'free' | 'paid'; keyPresence: LlmConfigResponse['llm']['providers'][number]['keyPresence'] }[], allowed: boolean): LlmConfigResponse {
  return {
    llm: {
      config: undefined,
      configError: undefined,
      health: undefined,
      keys: { openai: 'none', anthropic: 'none', groq: 'none' },
      keysFile: '/h/keys.json',
      allowedHosts: [],
      remote: undefined,
      usable: false,
      settings: { path: '/work/cv.toml', present: false, configured: false, error: undefined },
      providers: providers.map((provider) => ({
        id: provider.id as 'groq',
        plan: provider.plan,
        host: `${provider.id}.example`,
        baseUrl: `https://${provider.id}.example`,
        defaultModel: `${provider.id}-model`,
        keyPresence: provider.keyPresence,
        quota: undefined,
        rateLimitsUrl: 'https://x',
        c7: { sourceUrl: 'https://x', verifiedAt: '2026-08-30', quote: 'q' },
        live: undefined,
      })),
    },
    file: { path: '/work/cv.toml', present: false, sha256: undefined },
    remote: { allowed },
  };
}

describe('remoteProviderOptions', () => {
  it('sin configuración no ofrece remotos; con ella, cada remoto con su plan y por qué (no) se puede usar', () => {
    expect(remoteProviderOptions(undefined)).toEqual([]);
    expect(remoteProviderOptions(config([{ id: 'groq', plan: 'free', keyPresence: 'env' }, { id: 'openai', plan: 'paid', keyPresence: 'none' }, { id: 'anthropic', plan: 'paid', keyPresence: 'insecure-file' }], true))).toEqual([
      { id: 'groq', label: 'groq · plan gratuito · clave en el entorno', defaultModel: 'groq-model', usable: true },
      { id: 'openai', label: 'openai · plan de pago · sin clave', defaultModel: 'openai-model', usable: false },
      { id: 'anthropic', label: 'anthropic · plan de pago · fichero de claves con permisos abiertos', defaultModel: 'anthropic-model', usable: false },
    ]);
    expect(remoteProviderOptions(config([{ id: 'groq', plan: 'free', keyPresence: 'file' }, { id: 'openai', plan: 'paid', keyPresence: 'invalid-file' }], false))).toEqual([
      { id: 'groq', label: 'groq · plan gratuito · el servidor no admite remotos (--allow-remote)', defaultModel: 'groq-model', usable: false },
      { id: 'openai', label: 'openai · plan de pago · fichero de claves inválido', defaultModel: 'openai-model', usable: false },
    ]);
  });
});
