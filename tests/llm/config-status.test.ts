import { describe, expect, it } from 'vitest';

import { LLM_ENV, REMOTE_KEY_VARIABLES, createProvider, definedRemoteKeys, formatLlmStatus, llmStatus, resolveLlmConfig, type JsonHttp } from '../../src/llm';

describe('resolveLlmConfig (solo CHAMELEON_*, solo loopback)', () => {
  it('por defecto Ollama en loopback con el modelo fijado; el entorno puede cambiar proveedor, URL y modelo', () => {
    expect(resolveLlmConfig({})).toEqual({
      ok: true,
      config: { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b-instruct', sources: { provider: 'default', baseUrl: 'default', model: 'default' } },
    });
    expect(resolveLlmConfig({ [LLM_ENV.provider]: 'OpenAI-Compatible', [LLM_ENV.baseUrl]: 'http://localhost:8080 ', [LLM_ENV.model]: ' qwen ' })).toEqual({
      ok: true,
      config: { provider: 'openai-compatible', baseUrl: 'http://localhost:8080', model: 'qwen', sources: { provider: 'env', baseUrl: 'env', model: 'env' } },
    });
    expect(resolveLlmConfig({ [LLM_ENV.provider]: 'openai-compatible', [LLM_ENV.baseUrl]: '', [LLM_ENV.model]: '' })).toMatchObject({ ok: true, config: { baseUrl: 'http://127.0.0.1:8080', model: 'default' } });
    expect(resolveLlmConfig({ [LLM_ENV.provider]: '' })).toMatchObject({ ok: true, config: { provider: 'ollama', sources: { provider: 'default' } } });
  });

  it('rechaza proveedores desconocidos y URLs que no sean locales', () => {
    expect(resolveLlmConfig({ [LLM_ENV.provider]: 'openai' })).toEqual({ ok: false, message: 'CHAMELEON_LLM_PROVIDER=«openai» no es un proveedor conocido (ollama, openai-compatible)' });
    expect(resolveLlmConfig({ [LLM_ENV.baseUrl]: 'https://api.openai.com/v1' })).toEqual({
      ok: false,
      message: 'CHAMELEON_LLM_BASE_URL=«https://api.openai.com/v1» no es una dirección local (loopback): los proveedores remotos exigen --provider explícito y llegan en T-4.5',
    });
    expect(resolveLlmConfig()).toMatchObject({ ok: true });
  });

  it('solo informa de qué claves remotas existen, nunca de su valor', () => {
    expect(definedRemoteKeys({ CHAMELEON_OPENAI_API_KEY: 'sk-secreta', OPENAI_API_KEY: 'ignorada', CHAMELEON_ANTHROPIC_API_KEY: '' })).toEqual(['CHAMELEON_OPENAI_API_KEY']);
    expect(REMOTE_KEY_VARIABLES).toEqual(['CHAMELEON_OPENAI_API_KEY', 'CHAMELEON_ANTHROPIC_API_KEY']);
    expect(definedRemoteKeys().every((name) => name.startsWith('CHAMELEON_'))).toBe(true);
  });

  it('createProvider construye el proveedor configurado', () => {
    const http: JsonHttp = () => Promise.resolve({ ok: true, status: 200, data: {} });
    expect(createProvider({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'm', sources: { provider: 'default', baseUrl: 'default', model: 'default' } }, http).id).toBe('ollama');
    expect(createProvider({ provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080', model: 'm', sources: { provider: 'env', baseUrl: 'env', model: 'env' } }).id).toBe('openai-compatible');
  });
});

describe('llmStatus / formatLlmStatus', () => {
  const okHttp: JsonHttp = (request) => {
    if (request.url.endsWith('/api/version')) return Promise.resolve({ ok: true, status: 200, data: { version: '0.33.1' } });
    if (request.url.endsWith('/api/tags')) return Promise.resolve({ ok: true, status: 200, data: { models: [{ name: 'qwen2.5:7b-instruct' }, { name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }, { name: 'e' }, { name: 'f' }] } });
    return Promise.resolve({ ok: true, status: 200, data: { data: [{ id: 'served.gguf' }] } });
  };

  it('describe un proveedor local alcanzable con el modelo disponible', async () => {
    const status = await llmStatus({ env: { CHAMELEON_ANTHROPIC_API_KEY: 'x' }, http: okHttp });
    expect(status).toMatchObject({ usable: true, remoteKeys: ['CHAMELEON_ANTHROPIC_API_KEY'], health: { ok: true, modelAvailable: true } });
    expect(formatLlmStatus(status)).toBe(
      [
        'Proveedor: ollama (local, http://127.0.0.1:11434; por defecto) · modelo: qwen2.5:7b-instruct (por defecto)',
        'Estado: alcanzable · versión 0.33.1 · 7 modelos (qwen2.5:7b-instruct, a, b, c, d, e, …) · el modelo configurado está disponible',
        'Claves remotas definidas: CHAMELEON_ANTHROPIC_API_KEY (solo el nombre; los proveedores remotos llegan en T-4.5)',
        '',
      ].join('\n'),
    );
  });

  it('describe el modelo ausente, el servidor caído y la configuración inválida', async () => {
    const missing = await llmStatus({ env: { [LLM_ENV.provider]: 'openai-compatible', [LLM_ENV.model]: 'otro' }, http: okHttp });
    expect(missing.usable).toBe(false);
    expect(formatLlmStatus(missing)).toContain('Estado: alcanzable · 1 modelo (served.gguf) · el modelo configurado «otro» no está disponible\n');
    expect(formatLlmStatus(missing)).toContain('Proveedor: openai-compatible (local, http://127.0.0.1:8080; entorno) · modelo: otro (entorno)\n');

    const down = await llmStatus({ env: {}, http: () => Promise.resolve({ ok: false, code: 'unreachable', message: 'ECONNREFUSED' }) });
    expect(down.usable).toBe(false);
    expect(formatLlmStatus(down)).toContain('Estado: no disponible · Ollama no responde en http://127.0.0.1:11434: ECONNREFUSED\n  Arranca Ollama en http://127.0.0.1:11434 o configura CHAMELEON_LLM_PROVIDER/CHAMELEON_LLM_BASE_URL/CHAMELEON_LLM_MODEL\n');
    expect(formatLlmStatus(down)).toContain('Claves remotas: ninguna definida (CHAMELEON_OPENAI_API_KEY, CHAMELEON_ANTHROPIC_API_KEY); los proveedores remotos llegan en T-4.5\n');

    const invalid = await llmStatus({ env: { [LLM_ENV.provider]: 'gemini' } });
    expect(invalid).toMatchObject({ config: undefined, usable: false, health: undefined });
    expect(formatLlmStatus(invalid)).toContain('Configuración inválida: CHAMELEON_LLM_PROVIDER=«gemini» no es un proveedor conocido');
    expect(formatLlmStatus({ ...down, health: undefined })).toContain('Estado: no disponible · sin comprobar\n');
  });

  it('con el entorno real y sin servidor local informa de que no está disponible', async () => {
    const status = await llmStatus({ env: { [LLM_ENV.baseUrl]: 'http://127.0.0.1:9' } });
    expect(status.usable).toBe(false);
    const real = await llmStatus({ http: () => Promise.resolve({ ok: false, code: 'unreachable', message: 'sin servidor' }) });
    expect(real).toMatchObject({ usable: false, health: { ok: false } });
  });

  it('describe un servidor que no sirve ningún modelo', async () => {
    const empty = await llmStatus({ env: { [LLM_ENV.provider]: 'openai-compatible' }, http: () => Promise.resolve({ ok: true, status: 200, data: { data: [] } }) });
    expect(empty.usable).toBe(false);
    expect(formatLlmStatus(empty)).toContain('Estado: alcanzable · ningún modelo servido · el modelo configurado «default» no está disponible\n');
  });
});
