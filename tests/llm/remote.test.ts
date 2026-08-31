import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ANTHROPIC_VERSION,
  AVAILABLE_REMOTE_PROVIDER_IDS,
  CHARACTERS_PER_TOKEN,
  KEY_ENV_VARIABLES,
  REMOTE_PROVIDER_IDS,
  allowsHosts,
  createAnthropicProvider,
  createJsonHttp,
  createRemoteHttp,
  describeKeys,
  estimateBatch,
  estimateTokens,
  formatCostWarning,
  keysFilePath,
  remoteBaseUrl,
  remoteProvider,
  resolveApiKey,
  selectProvider,
  unavailableMessage,
  type JsonHttp,
  type JsonHttpRequest,
  type LlmRequest,
} from '../../src/llm';

let root = '';
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'chameleon-keys-'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const REQUEST: LlmRequest = {
  messages: [
    { role: 'system', content: 'sistema' },
    { role: 'user', content: '{"text":"logro"}' },
  ],
  schema: { type: 'object', properties: { proposals: { type: 'array' } } },
  schemaName: 'improve',
  maxTokens: 300,
};

describe('claves de API (canon C5 y §5: solo CHAMELEON_* o fichero 0600, nunca interactivo)', () => {
  it('resuelve por la ruta de la plataforma y prefiere la variable de entorno al fichero', async () => {
    expect(keysFilePath({ XDG_CONFIG_HOME: '/xdg' }, 'linux', '/h')).toBe('/xdg/chameleon-cv/keys.json');
    expect(keysFilePath({}, 'darwin', '/Users/ada')).toBe('/Users/ada/.config/chameleon-cv/keys.json');
    expect(keysFilePath({ APPDATA: 'C:\\Users\\ada\\AppData\\Roaming' }, 'win32', 'C:\\Users\\ada')).toBe(join('C:\\Users\\ada\\AppData\\Roaming', 'chameleon-cv', 'keys.json'));
    expect(keysFilePath({}, 'win32', 'C:\\Users\\ada')).toBe(join('C:\\Users\\ada', 'AppData', 'Roaming', 'chameleon-cv', 'keys.json'));
    expect(keysFilePath().endsWith(join('chameleon-cv', 'keys.json'))).toBe(true);
    expect(await resolveApiKey('openai', { env: { [KEY_ENV_VARIABLES.openai]: ' sk-env ' }, keysFile: '/no/existe.json' })).toEqual({ ok: true, key: 'sk-env', source: 'env' });
    expect(KEY_ENV_VARIABLES).toEqual({ openai: 'CHAMELEON_OPENAI_API_KEY', anthropic: 'CHAMELEON_ANTHROPIC_API_KEY', groq: 'CHAMELEON_GROQ_API_KEY', gemini: 'CHAMELEON_GEMINI_API_KEY' });
  });

  it('lee el fichero de claves solo si tiene permisos 0600; rechaza permisos abiertos y contenido inválido; explica la ausencia', async () => {
    const directory = join(root, 'config');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, 'keys.json');
    await writeFile(file, JSON.stringify({ openai: 'sk-file', anthropic: 'ant-file' }), { mode: 0o600 });
    expect(await resolveApiKey('openai', { env: {}, keysFile: file })).toEqual({ ok: true, key: 'sk-file', source: 'file' });
    expect(await resolveApiKey('anthropic', { env: {}, keysFile: file, platform: 'linux' })).toEqual({ ok: true, key: 'ant-file', source: 'file' });
    expect(await describeKeys({ env: { [KEY_ENV_VARIABLES.openai]: 'x' }, keysFile: file })).toEqual({ openai: 'env', anthropic: 'file', groq: 'none', gemini: 'none' });

    await chmod(file, 0o644);
    expect(await resolveApiKey('openai', { env: {}, keysFile: file })).toMatchObject({ ok: false, code: 'insecure-file', message: expect.stringContaining('permisos 644') });
    expect(await describeKeys({ env: {}, keysFile: file })).toEqual({ openai: 'insecure-file', anthropic: 'insecure-file', groq: 'insecure-file', gemini: 'insecure-file' });
    // En Windows no hay bits POSIX: no se comprueba el modo.
    expect(await resolveApiKey('openai', { env: {}, keysFile: file, platform: 'win32' })).toEqual({ ok: true, key: 'sk-file', source: 'file' });
    await chmod(file, 0o600);

    const partial = join(directory, 'partial.json');
    await writeFile(partial, JSON.stringify({ openai: 'sk-only' }), { mode: 0o600 });
    expect(await resolveApiKey('anthropic', { env: {}, keysFile: partial })).toMatchObject({ ok: false, code: 'missing', message: expect.stringContaining('define CHAMELEON_ANTHROPIC_API_KEY o añádela a') });
    expect(await describeKeys({ env: {}, keysFile: partial })).toEqual({ openai: 'file', anthropic: 'none', groq: 'none', gemini: 'none' });

    const invalid = join(directory, 'invalid.json');
    await writeFile(invalid, '{"openai": 1}', { mode: 0o600 });
    expect(await resolveApiKey('openai', { env: {}, keysFile: invalid })).toMatchObject({ ok: false, code: 'invalid-file' });
    await writeFile(invalid, 'no json', { mode: 0o600 });
    expect(await resolveApiKey('openai', { env: {}, keysFile: invalid })).toMatchObject({ ok: false, code: 'invalid-file' });
    expect(await describeKeys({ env: {}, keysFile: invalid })).toEqual({ openai: 'invalid-file', anthropic: 'invalid-file', groq: 'invalid-file', gemini: 'invalid-file' });
    expect(await resolveApiKey('openai', { env: {}, keysFile: join(directory, 'missing.json') })).toMatchObject({ ok: false, code: 'missing' });
    expect(await resolveApiKey('openai', { env: {}, platform: 'linux', home: root })).toMatchObject({ ok: false, code: 'missing' });
  });
});

describe('política de red remota (lista blanca, solo https)', () => {
  it('allowsHosts acepta únicamente https hacia hosts listados', () => {
    const allow = allowsHosts([' API.OpenAI.com ', 'proxy.empresa.com', '']);
    expect(allow('https://api.openai.com/v1/chat/completions')).toBe(true);
    expect(allow('https://proxy.empresa.com/')).toBe(true);
    expect(allow('http://api.openai.com/v1')).toBe(false);
    expect(allow('https://evil.api.openai.com/v1')).toBe(false);
    expect(allow('https://api.anthropic.com/v1')).toBe(false);
    expect(allow('no es una url')).toBe(false);
  });

  it('createRemoteHttp rechaza en código lo que no esté en la lista y añade las cabeceras del proveedor', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = ((url: string, init?: RequestInit) => {
      seen.push({ url, headers: (init?.headers as Record<string, string>) ?? {} });
      return Promise.resolve({ ok: true, status: 200, headers: new Headers(), text: () => Promise.resolve('{"data":[]}') } as unknown as Response);
    }) as unknown as typeof fetch;
    const http = createRemoteHttp(['api.openai.com'], fetchImpl);
    expect(await http({ url: 'https://api.openai.com/v1/models', method: 'GET', headers: { authorization: 'Bearer x' } })).toEqual({ ok: true, status: 200, data: { data: [] } });
    expect(seen[0]?.headers['authorization']).toBe('Bearer x');
    expect(await http({ url: 'https://api.anthropic.com/v1/models', method: 'GET' })).toMatchObject({ ok: false, code: 'refused' });
    expect(seen).toHaveLength(1);
    expect(createRemoteHttp(['api.openai.com'])).toBeTypeOf('function');
  });
});

describe('proveedor Anthropic (Messages API con herramienta forzada)', () => {
  function fakeHttp(responses: Record<string, unknown>, calls: JsonHttpRequest[] = []): JsonHttp {
    return (request) => {
      calls.push(request);
      const data = responses[request.url];
      return Promise.resolve(data === undefined ? { ok: false, code: 'http', message: 'HTTP 404', status: 404 } : { ok: true, status: 200, data });
    };
  }

  it('envía sistema, usuario, herramienta con el esquema y tool_choice fijo; devuelve el input de la herramienta', async () => {
    const calls: JsonHttpRequest[] = [];
    const provider = createAnthropicProvider({
      apiKey: 'ant-key',
      http: fakeHttp({ 'https://api.anthropic.com/v1/messages': { model: 'claude-x', content: [{ type: 'text', text: 'pensando' }, { type: 'tool_use', name: 'improve', input: { proposals: [{ text: 'a', rationale: 'b' }] } }], usage: { input_tokens: 50, output_tokens: 20 } } }, calls),
    });
    expect(provider).toMatchObject({ id: 'anthropic', kind: 'remote', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5' });
    const result = await provider.complete({ ...REQUEST, timeoutMs: 999, temperature: 0.1 });
    expect(result).toMatchObject({ ok: true, json: { proposals: [{ text: 'a', rationale: 'b' }] }, raw: '{"proposals":[{"text":"a","rationale":"b"}]}', model: 'claude-x', usage: { promptTokens: 50, completionTokens: 20 } });
    expect(calls[0]).toMatchObject({
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: { 'x-api-key': 'ant-key', 'anthropic-version': ANTHROPIC_VERSION },
      timeoutMs: 999,
      body: {
        model: 'claude-sonnet-4-5',
        max_tokens: 300,
        temperature: 0.1,
        system: 'sistema',
        messages: [{ role: 'user', content: '{"text":"logro"}' }],
        tools: [{ name: 'improve', input_schema: REQUEST.schema }],
        tool_choice: { type: 'tool', name: 'improve' },
      },
    });
    const noSystem = await provider.complete({ ...REQUEST, messages: [{ role: 'user', content: 'solo usuario' }] });
    expect(noSystem.ok).toBe(true);
    expect('system' in ((calls[1]?.body as { system?: string }) ?? {})).toBe(false);
    expect((calls[1]?.body as { temperature: number }).temperature).toBe(0);
  });

  it('tipifica errores HTTP, formas inesperadas, ausencia de la herramienta y el estado con /v1/models', async () => {
    const denied = createAnthropicProvider({ apiKey: 'k', http: fakeHttp({}), baseUrl: 'https://api.anthropic.com/' });
    expect(await denied.complete(REQUEST)).toMatchObject({ ok: false, code: 'http', message: 'Anthropic: HTTP 404' });
    expect(await denied.health()).toMatchObject({ ok: false, code: 'http', message: expect.stringContaining('Anthropic no responde en https://api.anthropic.com') });
    const shapeless = createAnthropicProvider({ apiKey: 'k', http: fakeHttp({ 'https://api.anthropic.com/v1/messages': { nope: true }, 'https://api.anthropic.com/v1/models': { data: 'x' } }) });
    expect(await shapeless.complete(REQUEST)).toEqual({ ok: false, code: 'invalid-response', message: 'Anthropic: respuesta con una forma inesperada (falta content[])' });
    expect(await shapeless.health()).toEqual({ ok: false, code: 'invalid-response', message: 'Anthropic: la lista de modelos tiene una forma inesperada' });
    const noTool = createAnthropicProvider({ apiKey: 'k', http: fakeHttp({ 'https://api.anthropic.com/v1/messages': { content: [{ type: 'text', text: 'sin herramienta' }] } }), model: 'claude-y' });
    expect(await noTool.complete(REQUEST)).toEqual({ ok: false, code: 'invalid-response', message: 'Anthropic: la respuesta no contiene la herramienta «improve»' });
    const minimal = createAnthropicProvider({ apiKey: 'k', http: fakeHttp({ 'https://api.anthropic.com/v1/messages': { content: [{ type: 'tool_use', name: 'improve', input: { ok: 1 } }] }, 'https://api.anthropic.com/v1/models': { data: [{ id: 'claude-y' }, { id: 'claude-z' }] } }), model: 'claude-y' });
    expect(await minimal.complete(REQUEST)).toMatchObject({ ok: true, json: { ok: 1 }, model: 'claude-y', usage: {} });
    expect(await minimal.health()).toEqual({ ok: true, version: undefined, models: ['claude-y', 'claude-z'], modelAvailable: true });
  });
});

describe('selectProvider (canon C3: local por defecto, remoto solo explícito)', () => {
  const http: JsonHttp = () => Promise.resolve({ ok: true, status: 200, data: {} });
  const capture = (calls: JsonHttpRequest[]): ((hosts: readonly string[]) => JsonHttp) => (hosts) => (request) => {
    calls.push({ ...request, headers: { ...(request.headers ?? {}), hosts: hosts.join(',') } });
    return Promise.resolve({ ok: true, status: 200, data: { data: [{ id: 'm' }] } });
  };

  it('sin --provider usa el local del entorno; --provider local lo cambia; --model lo sobrescribe', async () => {
    expect(await selectProvider({}, { env: {}, http })).toMatchObject({ ok: true, provider: { id: 'ollama', kind: 'local', model: 'qwen3:8b' } });
    expect(await selectProvider({ provider: ' Openai-Compatible ', model: ' mistral ' }, { env: {}, http })).toMatchObject({ ok: true, provider: { id: 'openai-compatible', kind: 'local', baseUrl: 'http://127.0.0.1:8080', model: 'mistral' } });
    expect(await selectProvider({ provider: '', model: '' }, { env: { CHAMELEON_LLM_MODEL: 'del-entorno' }, http })).toMatchObject({ ok: true, provider: { id: 'ollama', model: 'del-entorno' } });
    expect(await selectProvider({}, { env: { CHAMELEON_LLM_BASE_URL: 'http://192.168.1.2:11434' }, http })).toMatchObject({ ok: false, message: expect.stringContaining('no es una dirección local') });
    expect(await selectProvider({ provider: 'grok' }, { env: {}, http })).toEqual({ ok: false, message: '--provider «grok» no es un proveedor conocido (ollama, openai-compatible, openai, anthropic, groq, gemini)' });
  });

  it('un remoto pendiente de verificación humana se rechaza antes de mirar la clave (T-8.2 §9; Groq el 30-ago-2026 y Gemini el 31)', async () => {
    // Los cuatro del registro están verificados hoy, así que la rama «pendiente» se prueba con un registro
    // inyectado: la guarda debe seguir ahí para el próximo remoto que entre sin verificar.
    expect(AVAILABLE_REMOTE_PROVIDER_IDS).toEqual(['openai', 'anthropic', 'groq', 'gemini']);
    expect(REMOTE_PROVIDER_IDS).toEqual(['openai', 'anthropic', 'groq', 'gemini']);
    const pendingRegistry = [{ ...remoteProvider('groq'), availability: 'pending-verification' as const, availabilityNote: 'pendiente de la verificación al alta por una persona (docs/copilot-providers.md §9): no se puede seleccionar hasta entonces' }];
    expect(await selectProvider({ provider: 'groq' }, { env: { CHAMELEON_GROQ_API_KEY: 'gsk-1' }, registry: pendingRegistry })).toEqual({
      ok: false,
      message: 'El proveedor «groq» está registrado pero pendiente de la verificación al alta por una persona (docs/copilot-providers.md §9): no se puede seleccionar hasta entonces',
    });
    expect(unavailableMessage({ ...remoteProvider('groq'), availability: 'pending-verification', availabilityNote: undefined })).toBe('El proveedor «groq» está registrado pero no está disponible');
  });

  it('un remoto exige clave, respeta la lista blanca y construye el proveedor con su cabecera de autenticación', async () => {
    expect(await selectProvider({ provider: 'openai' }, { env: {}, keysFile: '/no/existe.json' })).toMatchObject({ ok: false, message: expect.stringContaining('No hay clave para «openai»') });
    const calls: JsonHttpRequest[] = [];
    const openai = await selectProvider({ provider: 'openai' }, { env: { CHAMELEON_OPENAI_API_KEY: 'sk-1' }, remoteHttp: capture(calls) });
    expect(openai).toMatchObject({ ok: true, keySource: 'env', provider: { id: 'openai', kind: 'remote', baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini' } });
    if (openai.ok) {
      await openai.provider.health();
      expect(calls[0]).toMatchObject({ url: 'https://api.openai.com/v1/models', headers: { authorization: 'Bearer sk-1', hosts: 'api.openai.com,api.anthropic.com,api.groq.com,generativelanguage.googleapis.com' } });
    }
    const anthropic = await selectProvider({ provider: 'anthropic', model: 'claude-z' }, { env: { CHAMELEON_ANTHROPIC_API_KEY: 'ant-1', CHAMELEON_ANTHROPIC_BASE_URL: 'https://proxy.empresa.com/', CHAMELEON_LLM_ALLOWED_HOSTS: 'proxy.empresa.com' }, remoteHttp: capture(calls) });
    expect(anthropic).toMatchObject({ ok: true, provider: { id: 'anthropic', kind: 'remote', baseUrl: 'https://proxy.empresa.com', model: 'claude-z' } });
    expect(await selectProvider({ provider: 'anthropic' }, { env: { CHAMELEON_ANTHROPIC_API_KEY: 'ant-1' }, remoteHttp: capture(calls) })).toMatchObject({ ok: true, keySource: 'env', provider: { id: 'anthropic', model: 'claude-sonnet-4-5', baseUrl: 'https://api.anthropic.com' } });
    expect(remoteBaseUrl('openai', { CHAMELEON_OPENAI_BASE_URL: ' https://alt.example/v1/ ' })).toBe('https://alt.example/v1');
    expect(remoteBaseUrl('anthropic', { CHAMELEON_ANTHROPIC_BASE_URL: '' })).toBe('https://api.anthropic.com');
    const outside = await selectProvider({ provider: 'openai' }, { env: { CHAMELEON_OPENAI_API_KEY: 'sk-1', CHAMELEON_OPENAI_BASE_URL: 'https://alt.example' } });
    expect(outside).toMatchObject({ ok: false, message: expect.stringContaining('no es https o su host no está en la lista blanca (api.openai.com, api.anthropic.com, api.groq.com, generativelanguage.googleapis.com)') });
    const plainHttp = await selectProvider({ provider: 'openai' }, { env: { CHAMELEON_OPENAI_API_KEY: 'sk-1', CHAMELEON_OPENAI_BASE_URL: 'http://api.openai.com' } });
    expect(plainHttp.ok).toBe(false);
    // Sin remoteHttp inyectado se construye el cliente real (https + lista blanca), sin llamar a nadie.
    expect(await selectProvider({ provider: 'openai' }, { env: { CHAMELEON_OPENAI_API_KEY: 'sk-1' } })).toMatchObject({ ok: true, provider: { kind: 'remote' } });
    expect(await selectProvider()).toMatchObject({ ok: true });
  });
});

describe('estimación de coste (canon C11)', () => {
  it('estima tokens por caracteres y compone el aviso', () => {
    expect(CHARACTERS_PER_TOKEN).toBe(4);
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    const estimate = estimateBatch(
      [
        [
          { role: 'system', content: 'a'.repeat(400) },
          { role: 'user', content: 'b'.repeat(40) },
        ],
        [{ role: 'user', content: 'c'.repeat(8) }],
      ],
      600,
    );
    expect(estimate).toEqual({ requests: 2, inputTokens: 112, maxOutputTokens: 1200 });
    expect(formatCostWarning('openai (https://api.openai.com; modelo gpt-4o-mini)', estimate)).toBe(
      'Aviso de coste: 2 peticiones a openai (https://api.openai.com; modelo gpt-4o-mini) con ≈112 tokens de entrada (estimación: 4 caracteres ≈ 1 token) y hasta 1200 de salida.\nLa operación puede incurrir en costes según tu tarifa con el proveedor.',
    );
    expect(formatCostWarning('x', { requests: 1, inputTokens: 1, maxOutputTokens: 1 })).toContain('1 petición a x');
    expect(createJsonHttp).toBeTypeOf('function');
  });
});
