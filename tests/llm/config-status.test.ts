import { describe, expect, it } from 'vitest';

import { LLM_ENV, REMOTE_KEY_VARIABLES, allowedHosts, createProvider, definedRemoteKeys, formatLlmStatus, llmStatus, resolveLlmConfig, type JsonHttp } from '../../src/llm';

describe('resolveLlmConfig (solo CHAMELEON_*, solo loopback, solo locales por defecto)', () => {
  it('por defecto Ollama en loopback con el modelo fijado; el entorno puede cambiar proveedor local, URL y modelo', () => {
    expect(resolveLlmConfig({})).toEqual({
      ok: true,
      config: { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen3:8b', think: false, context: 16384, sources: { provider: 'default', baseUrl: 'default', model: 'default', think: 'default', context: 'default' } },
    });
    expect(resolveLlmConfig({ [LLM_ENV.provider]: 'OpenAI-Compatible', [LLM_ENV.baseUrl]: 'http://localhost:8080 ', [LLM_ENV.model]: ' qwen ' })).toEqual({
      ok: true,
      config: { provider: 'openai-compatible', baseUrl: 'http://localhost:8080', model: 'qwen', think: false, context: 16384, sources: { provider: 'env', baseUrl: 'env', model: 'env', think: 'default', context: 'default' } },
    });
    expect(resolveLlmConfig({ [LLM_ENV.provider]: 'openai-compatible', [LLM_ENV.baseUrl]: '', [LLM_ENV.model]: '' })).toMatchObject({ ok: true, config: { baseUrl: 'http://127.0.0.1:8080', model: 'default' } });
    expect(resolveLlmConfig({ [LLM_ENV.provider]: '' })).toMatchObject({ ok: true, config: { provider: 'ollama', sources: { provider: 'default' } } });
    expect(resolveLlmConfig({ [LLM_ENV.provider]: 'ollama' }, 'openai-compatible')).toMatchObject({ ok: true, config: { provider: 'openai-compatible', sources: { provider: 'flag' } } });
  });

  it('rechaza proveedores desconocidos, remotos como valor por defecto y URLs que no sean locales', () => {
    expect(resolveLlmConfig({ [LLM_ENV.provider]: 'gemini' })).toEqual({ ok: false, message: 'CHAMELEON_LLM_PROVIDER=«gemini» no es un proveedor conocido (ollama, openai-compatible, openai, anthropic, groq)' });
    expect(resolveLlmConfig({ [LLM_ENV.provider]: 'openai' })).toEqual({
      ok: false,
      message: 'CHAMELEON_LLM_PROVIDER=«openai» es un proveedor remoto: los remotos exigen --provider explícito en cada orden y nunca son el valor por defecto',
    });
    expect(resolveLlmConfig({ [LLM_ENV.baseUrl]: 'https://api.openai.com/v1' })).toEqual({
      ok: false,
      message: 'CHAMELEON_LLM_BASE_URL=«https://api.openai.com/v1» no es una dirección local (loopback): los proveedores remotos exigen --provider explícito',
    });
    expect(resolveLlmConfig()).toMatchObject({ ok: true });
  });

  it('solo informa de qué claves remotas existen, nunca de su valor; la lista blanca son los dominios oficiales más el entorno', () => {
    expect(definedRemoteKeys({ CHAMELEON_OPENAI_API_KEY: 'sk-secreta', OPENAI_API_KEY: 'ignorada', CHAMELEON_ANTHROPIC_API_KEY: '' })).toEqual(['CHAMELEON_OPENAI_API_KEY']);
    expect(REMOTE_KEY_VARIABLES).toEqual(['CHAMELEON_OPENAI_API_KEY', 'CHAMELEON_ANTHROPIC_API_KEY', 'CHAMELEON_GROQ_API_KEY']);
    expect(definedRemoteKeys().every((name) => name.startsWith('CHAMELEON_'))).toBe(true);
    expect(allowedHosts({})).toEqual(['api.openai.com', 'api.anthropic.com', 'api.groq.com']);
    expect(allowedHosts({ [LLM_ENV.allowedHosts]: ' Proxy.Empresa.com, api.openai.com,, ' })).toEqual(['api.openai.com', 'api.anthropic.com', 'api.groq.com', 'proxy.empresa.com']);
    expect(allowedHosts()).toContain('api.anthropic.com');
  });

  it('createProvider construye el proveedor local configurado', () => {
    const http: JsonHttp = () => Promise.resolve({ ok: true, status: 200, data: {} });
    expect(createProvider({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'm', sources: { provider: 'default', baseUrl: 'default', model: 'default' } }, http).id).toBe('ollama');
    expect(createProvider({ provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080', model: 'm', sources: { provider: 'env', baseUrl: 'env', model: 'env' } }).id).toBe('openai-compatible');
  });
});

describe('llmStatus / formatLlmStatus', () => {
  const okHttp: JsonHttp = (request) => {
    if (request.url.endsWith('/api/version')) return Promise.resolve({ ok: true, status: 200, data: { version: '0.33.1' } });
    if (request.url.endsWith('/api/tags')) return Promise.resolve({ ok: true, status: 200, data: { models: [{ name: 'qwen3:8b' }, { name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }, { name: 'e' }, { name: 'f' }] } });
    return Promise.resolve({ ok: true, status: 200, data: { data: [{ id: 'served.gguf' }] } });
  };
  const HOME = { platform: 'linux' as const, home: '/h' };

  it('un remoto pendiente de verificación sin nota se describe como no disponible', async () => {
    const status = await llmStatus({ env: {}, http: okHttp, ...HOME });
    const withoutNote = { ...status, providers: status.providers.map((provider) => (provider.id === 'groq' ? { ...provider, availabilityNote: undefined } : provider)) };
    expect(formatLlmStatus(withoutNote)).toContain('modelo por defecto openai/gpt-oss-120b · PENDIENTE DE VERIFICACIÓN: no disponible\n');
  });

  it('describe el proveedor local alcanzable, la procedencia de las claves y la lista blanca', async () => {
    const status = await llmStatus({ env: { CHAMELEON_ANTHROPIC_API_KEY: 'x' }, http: okHttp, ...HOME });
    expect(status).toMatchObject({ usable: true, keys: { openai: 'none', anthropic: 'env', groq: 'none' }, keysFile: '/h/.config/chameleon-cv/keys.json', allowedHosts: ['api.openai.com', 'api.anthropic.com', 'api.groq.com'], remote: undefined, health: { ok: true, modelAvailable: true } });
    expect(formatLlmStatus(status)).toBe(
      [
        'Proveedor local: ollama (http://127.0.0.1:11434; por defecto) · modelo: qwen3:8b (por defecto)',
        'Estado: alcanzable · versión 0.33.1 · 7 modelos (qwen3:8b, a, b, c, d, e, …) · el modelo configurado está disponible',
        'Proveedores remotos (solo con --provider explícito):',
        '  openai → clave ninguna · plan de pago (límites según la cuenta) · api.openai.com · modelo por defecto gpt-4o-mini',
        '  anthropic → clave definida en CHAMELEON_ANTHROPIC_API_KEY · plan de pago (límites según la cuenta) · api.anthropic.com · modelo por defecto claude-sonnet-4-5',
        '  groq → clave ninguna · plan gratuito: 30 req/min, 1000 req/día, 8000 tokens/min, 200000 tokens/día (https://console.groq.com/docs/rate-limits, 2026-08-30) · api.groq.com · modelo por defecto openai/gpt-oss-120b · PENDIENTE DE VERIFICACIÓN: pendiente de la verificación al alta por una persona (docs/copilot-providers.md §9): no se puede seleccionar hasta entonces',
        '    modelos (--model o [llm.models]): openai/gpt-oss-120b (estable; improve, summarize) · qwen/qwen3.8-27b (preview; suggest-tags, improve, summarize)',
        'Fichero de claves: /h/.config/chameleon-cv/keys.json',
        'Lista blanca de hosts: api.openai.com, api.anthropic.com, api.groq.com',
        '',
      ].join('\n'),
    );
  });

  it('describe el modelo ausente, el servidor caído, la configuración inválida y la lista blanca ampliada', async () => {
    const missing = await llmStatus({ env: { [LLM_ENV.provider]: 'openai-compatible', [LLM_ENV.model]: 'otro', [LLM_ENV.allowedHosts]: 'proxy.empresa.com' }, http: okHttp, ...HOME });
    expect(missing.usable).toBe(false);
    expect(formatLlmStatus(missing)).toContain('Estado: alcanzable · 1 modelo (served.gguf) · el modelo configurado «otro» no está disponible\n');
    expect(formatLlmStatus(missing)).toContain('Proveedor local: openai-compatible (http://127.0.0.1:8080; entorno) · modelo: otro (entorno)\n');
    expect(formatLlmStatus(missing)).toContain('Lista blanca de hosts: api.openai.com, api.anthropic.com, api.groq.com, proxy.empresa.com (ampliada con CHAMELEON_LLM_ALLOWED_HOSTS)\n');

    const down = await llmStatus({ env: {}, http: () => Promise.resolve({ ok: false, code: 'unreachable', message: 'ECONNREFUSED' }), ...HOME });
    expect(down.usable).toBe(false);
    expect(formatLlmStatus(down)).toContain('Estado: no disponible · Ollama no responde en http://127.0.0.1:11434: ECONNREFUSED\n  Arranca Ollama en http://127.0.0.1:11434 o configura CHAMELEON_LLM_PROVIDER/CHAMELEON_LLM_BASE_URL/CHAMELEON_LLM_MODEL\n');

    const invalid = await llmStatus({ env: { [LLM_ENV.provider]: 'gemini' }, ...HOME });
    expect(invalid).toMatchObject({ config: undefined, usable: false, health: undefined });
    expect(formatLlmStatus(invalid)).toContain('Configuración inválida: CHAMELEON_LLM_PROVIDER=«gemini» no es un proveedor conocido');
    expect(formatLlmStatus({ ...down, health: undefined })).toContain('Estado: no disponible · sin comprobar\n');
    const relabelled = formatLlmStatus({ ...down, keys: { openai: 'file', anthropic: 'insecure-file', groq: 'none' } });
    expect(relabelled).toContain('  openai → clave definida en el fichero de claves · plan de pago');
    expect(relabelled).toContain('  anthropic → clave fichero de claves con permisos abiertos (corrígelo con chmod 600) · plan de pago');
    expect(formatLlmStatus({ ...down, keys: { openai: 'invalid-file', anthropic: 'none', groq: 'none' } })).toContain('openai → clave fichero de claves inválido');
  });

  it('con --provider remoto explícito comprueba ese proveedor (o explica por qué no puede)', async () => {
    const remoteHttp = (): JsonHttp => (request) => {
      if (request.url === 'https://api.openai.com/v1/models') {
        expect(request.headers?.['authorization']).toBe('Bearer sk-prueba');
        return Promise.resolve({ ok: true, status: 200, data: { data: [{ id: 'gpt-4o-mini' }] } });
      }
      return Promise.resolve({ ok: false, code: 'refused', message: 'no' });
    };
    const status = await llmStatus({ env: { CHAMELEON_OPENAI_API_KEY: 'sk-prueba' }, http: okHttp, remoteHttp, provider: 'openai', ...HOME });
    expect(status.remote).toEqual({ id: 'openai', baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini', keySource: 'env', health: { ok: true, version: undefined, models: ['gpt-4o-mini'], modelAvailable: true } });
    expect(formatLlmStatus(status)).toContain('Remoto openai (https://api.openai.com; modelo gpt-4o-mini; clave del entorno): alcanzable · 1 modelo (gpt-4o-mini) · el modelo configurado está disponible\n');

    const down = await llmStatus({ env: { CHAMELEON_ANTHROPIC_API_KEY: 'k' }, http: okHttp, remoteHttp, provider: 'anthropic', ...HOME });
    expect(formatLlmStatus(down)).toContain('Remoto anthropic (https://api.anthropic.com; modelo claude-sonnet-4-5; clave del entorno): no disponible · Anthropic no responde en https://api.anthropic.com: no\n');

    const noKey = await llmStatus({ env: {}, http: okHttp, provider: 'anthropic', ...HOME });
    expect(noKey.remote).toEqual({ error: 'No hay clave para «anthropic»: define CHAMELEON_ANTHROPIC_API_KEY o añádela a /h/.config/chameleon-cv/keys.json (permisos 0600, {"anthropic": "…"})' });
    expect(formatLlmStatus(noKey)).toContain('Remoto: No hay clave para «anthropic»');

    // --provider local: no hay «remoto» que comprobar (y --provider vacío no cuenta).
    const local = await llmStatus({ env: {}, http: okHttp, provider: 'ollama', ...HOME });
    expect(local.remote).toBeUndefined();
    expect((await llmStatus({ env: {}, http: okHttp, provider: '', ...HOME })).remote).toBeUndefined();
  });

  it('con el entorno real y sin servidor local informa de que no está disponible', async () => {
    const status = await llmStatus({ env: { [LLM_ENV.baseUrl]: 'http://127.0.0.1:9' }, ...HOME });
    expect(status.usable).toBe(false);
    const real = await llmStatus({ http: () => Promise.resolve({ ok: false, code: 'unreachable', message: 'sin servidor' }) });
    expect(real).toMatchObject({ usable: false, health: { ok: false } });
  });

  it('describe un servidor que no sirve ningún modelo', async () => {
    const empty = await llmStatus({ env: { [LLM_ENV.provider]: 'openai-compatible' }, http: () => Promise.resolve({ ok: true, status: 200, data: { data: [] } }), ...HOME });
    expect(empty.usable).toBe(false);
    expect(formatLlmStatus(empty)).toContain('Estado: alcanzable · ningún modelo servido · el modelo configurado «default» no está disponible\n');
  });
});
