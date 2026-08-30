import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type JsonHttp,
  type LlmRequest,
  OLLAMA_DEFAULT_BASE_URL,
  OLLAMA_DEFAULT_MODEL,
  OPENAI_COMPATIBLE_DEFAULT_MODEL,
  createOllamaProvider,
  createOpenAiCompatibleProvider,
  httpErrorToLlm,
  isThinkingModel,
  modelListed,
  parseModelJson,
  stripThinking,
} from '../../src/llm';

/** Doble de Ollama y de un servidor compatible con OpenAI: responde según la ruta y registra las peticiones. */
interface Recorded {
  readonly url: string;
  readonly body: unknown;
}

let server: Server;
let base = '';
const recorded: Recorded[] = [];
let mode: 'ok' | 'broken-shape' | 'not-json' | 'null-content' = 'ok';

function handle(request: IncomingMessage, response: ServerResponse, body: string): void {
  recorded.push({ url: request.url ?? '', body: body === '' ? null : (JSON.parse(body) as unknown) });
  const json = (status: number, payload: unknown): void => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  };
  switch (request.url) {
    case '/api/version':
      return json(200, { version: '0.33.1' });
    case '/api/tags':
      return json(200, mode === 'broken-shape' ? { nope: true } : { models: [{ name: 'qwen2.5:7b-instruct:latest', size: 1 }, { name: 'llama3.1:8b' }] });
    case '/api/chat':
      if (mode === 'broken-shape') return json(200, { model: 'x' });
      if (mode === 'not-json') return json(200, { model: 'qwen2.5:7b-instruct', message: { role: 'assistant', content: 'texto suelto' } });
      return json(200, { model: 'qwen2.5:7b-instruct', message: { role: 'assistant', content: '{"proposals":[{"text":"Rediseñé la caché","rationale":"verbo"}]}' }, done: true, prompt_eval_count: 120, eval_count: 30 });
    case '/v1/models':
      return json(200, mode === 'broken-shape' ? { data: 'x' } : { object: 'list', data: [{ id: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf', object: 'model' }] });
    case '/v1/chat/completions':
      if (mode === 'broken-shape') return json(200, { choices: [] });
      if (mode === 'null-content') return json(200, { choices: [{ message: { role: 'assistant', content: null } }] });
      if (mode === 'not-json') return json(200, { choices: [{ message: { role: 'assistant', content: 'nada' } }] });
      return json(200, { model: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf', choices: [{ message: { role: 'assistant', content: '{"proposals":[{"text":"Automaticé el despliegue","rationale":"resultado"}]}' } }], usage: { prompt_tokens: 100, completion_tokens: 25 } });
    default:
      return json(404, {});
  }
}

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => handle(request, response, body));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  base = typeof address === 'object' && address !== null ? `http://127.0.0.1:${address.port}` : '';
});
afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

const REQUEST: LlmRequest = {
  messages: [
    { role: 'system', content: 'sistema' },
    { role: 'user', content: '{"text":"logro"}' },
  ],
  schema: { type: 'object' },
  schemaName: 'improve',
  maxTokens: 300,
};

describe('proveedor Ollama (nativo)', () => {
  it('compila la petición con esquema, temperatura 0 y semilla, y devuelve el JSON del modelo con su uso', async () => {
    mode = 'ok';
    recorded.length = 0;
    const provider = createOllamaProvider({ baseUrl: `${base}/`, model: 'qwen2.5:7b-instruct' });
    expect(provider).toMatchObject({ id: 'ollama', kind: 'local', baseUrl: base, model: 'qwen2.5:7b-instruct' });
    const result = await provider.complete({ ...REQUEST, seed: 3, temperature: 0.2 });
    expect(result).toMatchObject({ ok: true, json: { proposals: [{ text: 'Rediseñé la caché', rationale: 'verbo' }] }, model: 'qwen2.5:7b-instruct', usage: { promptTokens: 120, completionTokens: 30 } });
    expect(recorded[0]).toEqual({
      url: '/api/chat',
      body: { model: 'qwen2.5:7b-instruct', messages: REQUEST.messages, stream: false, format: { type: 'object' }, options: { temperature: 0.2, seed: 3, num_predict: 300 } },
    });
    const defaults = await provider.complete(REQUEST);
    expect(defaults.ok).toBe(true);
    expect(recorded[1]?.body).toMatchObject({ options: { temperature: 0, seed: 7 } });
  });

  it('health: versión, modelos y disponibilidad (con o sin :latest); sin servidor, no disponible', async () => {
    mode = 'ok';
    const provider = createOllamaProvider({ baseUrl: base });
    expect(await provider.health()).toEqual({ ok: true, version: '0.33.1', models: ['qwen2.5:7b-instruct:latest', 'llama3.1:8b'], modelAvailable: true });
    expect(modelListed('llama3.1:8b:latest', ['llama3.1:8b'])).toBe(true);
    expect(modelListed('gemma3:12b', ['llama3.1:8b'])).toBe(false);
    expect(OLLAMA_DEFAULT_MODEL).toBe('qwen2.5:7b-instruct');
    expect(OLLAMA_DEFAULT_BASE_URL).toBe('http://127.0.0.1:11434');
    const down = createOllamaProvider({ baseUrl: 'http://127.0.0.1:9' });
    expect(await down.health()).toMatchObject({ ok: false, code: 'unreachable', message: expect.stringContaining('Ollama no responde en http://127.0.0.1:9') });
    expect(await down.complete(REQUEST)).toMatchObject({ ok: false, code: 'unreachable' });
  });

  it('tipifica respuestas con forma inesperada, contenido no JSON y fallos al listar', async () => {
    const provider = createOllamaProvider({ baseUrl: base });
    mode = 'broken-shape';
    expect(await provider.complete(REQUEST)).toEqual({ ok: false, code: 'invalid-response', message: 'Ollama: respuesta con una forma inesperada (falta model o message.content)' });
    expect(await provider.health()).toEqual({ ok: false, code: 'invalid-response', message: 'Ollama: la lista de modelos tiene una forma inesperada' });
    mode = 'not-json';
    expect(await provider.complete(REQUEST)).toMatchObject({ ok: false, code: 'invalid-json', message: 'Ollama: el modelo no devolvió JSON válido: texto suelto' });
    mode = 'ok';
    const flakyTags = createOllamaProvider({ baseUrl: base, http: (request) => (request.url.endsWith('/api/tags') ? Promise.resolve({ ok: false, code: 'http', message: 'HTTP 500', status: 500 }) : Promise.resolve({ ok: true, status: 200, data: { version: '0.33.1' } })) });
    expect(await flakyTags.health()).toEqual({ ok: false, code: 'http', message: 'Ollama: no se pudo listar los modelos: HTTP 500' });
    const noVersion = createOllamaProvider({ baseUrl: base, http: (request) => Promise.resolve({ ok: true, status: 200, data: request.url.endsWith('/api/tags') ? { models: [] } : { odd: true } }) });
    expect(await noVersion.health()).toEqual({ ok: true, version: undefined, models: [], modelAvailable: false });
    const noCounts = createOllamaProvider({ http: () => Promise.resolve({ ok: true, status: 200, data: { model: 'm', message: { role: 'assistant', content: '{"a":1}' } } }) });
    expect(noCounts.baseUrl).toBe(OLLAMA_DEFAULT_BASE_URL);
    expect(await noCounts.complete({ ...REQUEST, timeoutMs: 50 })).toMatchObject({ ok: true, json: { a: 1 }, model: 'm', usage: {} });
    expect(createOpenAiCompatibleProvider().baseUrl).toBe('http://127.0.0.1:8080');
    expect(httpErrorToLlm('too-large')).toBe('invalid-response');
    expect(httpErrorToLlm('timeout')).toBe('timeout');
    expect(parseModelJson('{"a":1}')).toEqual({ ok: true, json: { a: 1 } });
    expect(parseModelJson('x')).toEqual({ ok: false, message: 'el modelo no devolvió JSON válido: x' });
  });
});

describe('proveedor compatible con OpenAI (loopback)', () => {
  it('usa /v1/chat/completions con response_format json_schema y /v1/models', async () => {
    mode = 'ok';
    recorded.length = 0;
    const provider = createOpenAiCompatibleProvider({ baseUrl: base });
    expect(provider).toMatchObject({ id: 'openai-compatible', kind: 'local', model: OPENAI_COMPATIBLE_DEFAULT_MODEL });
    const result = await provider.complete(REQUEST);
    expect(result).toMatchObject({ ok: true, json: { proposals: [{ text: 'Automaticé el despliegue', rationale: 'resultado' }] }, model: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf', usage: { promptTokens: 100, completionTokens: 25 } });
    expect(recorded[0]).toEqual({
      url: '/v1/chat/completions',
      body: { model: 'default', messages: REQUEST.messages, temperature: 0, seed: 7, max_tokens: 300, response_format: { type: 'json_schema', json_schema: { name: 'improve', schema: { type: 'object' }, strict: true } } },
    });
    expect(await provider.health()).toEqual({ ok: true, version: undefined, models: ['Qwen2.5-7B-Instruct-Q4_K_M.gguf'], modelAvailable: true });
    expect(await createOpenAiCompatibleProvider({ baseUrl: base, model: 'otro' }).health()).toMatchObject({ modelAvailable: false });
  });

  it('tipifica servidor caído, forma inesperada, contenido nulo o no JSON, y respuestas sin usage', async () => {
    const down = createOpenAiCompatibleProvider({ baseUrl: 'http://127.0.0.1:9' });
    expect(await down.health()).toMatchObject({ ok: false, code: 'unreachable', message: expect.stringContaining('no responde en http://127.0.0.1:9') });
    expect(await down.complete(REQUEST)).toMatchObject({ ok: false, code: 'unreachable' });
    const provider = createOpenAiCompatibleProvider({ baseUrl: base });
    mode = 'broken-shape';
    expect(await provider.complete(REQUEST)).toMatchObject({ ok: false, code: 'invalid-response' });
    expect(await provider.health()).toEqual({ ok: false, code: 'invalid-response', message: 'Servidor compatible con OpenAI: la lista de modelos tiene una forma inesperada' });
    mode = 'null-content';
    expect(await provider.complete(REQUEST)).toMatchObject({ ok: false, code: 'invalid-json' });
    mode = 'not-json';
    expect(await provider.complete(REQUEST)).toMatchObject({ ok: false, code: 'invalid-json', message: 'Servidor compatible con OpenAI: el modelo no devolvió JSON válido: nada' });
    mode = 'ok';
    const minimal = createOpenAiCompatibleProvider({ baseUrl: base, http: () => Promise.resolve({ ok: true, status: 200, data: { choices: [{ message: { content: '{"ok":true}' } }] } }) });
    expect(await minimal.complete(REQUEST)).toMatchObject({ ok: true, json: { ok: true }, model: 'default', usage: {} });
  });
});

describe('Qwen3 en Ollama (T-8.11)', () => {
  it('isThinkingModel y stripThinking', () => {
    expect(isThinkingModel('qwen3:8b')).toBe(true);
    expect(isThinkingModel(' Qwen3-14B ')).toBe(true);
    expect(isThinkingModel('qwen2.5:7b-instruct')).toBe(false);
    expect(stripThinking('<think>razono…</think>\n{"a":1}')).toBe('{"a":1}');
    expect(stripThinking('<think>sin cerrar')).toBe('');
    expect(stripThinking('{"a":1}')).toBe('{"a":1}');
  });

  it('con un modelo qwen3 envía think:false y tolera un bloque <think> antes del JSON', async () => {
    const bodies: unknown[] = [];
    const http: JsonHttp = async (request) => {
      bodies.push(request.body);
      return { ok: true, status: 200, data: { model: 'qwen3:8b', message: { role: 'assistant', content: '<think>pienso</think>{"ok":true}' } } };
    };
    const provider = createOllamaProvider({ model: 'qwen3:8b', http });
    const completion = await provider.complete({ messages: [{ role: 'user', content: 'hola' }], timeoutMs: 1000 } as never);
    expect(completion).toMatchObject({ ok: true, json: { ok: true } });
    expect(bodies[0]).toMatchObject({ think: false });
    const classic = createOllamaProvider({ model: 'qwen2.5:7b-instruct', http });
    await classic.complete({ messages: [{ role: 'user', content: 'hola' }], timeoutMs: 1000 } as never);
    expect('think' in (bodies[1] as Record<string, unknown>)).toBe(false);
  });
});
