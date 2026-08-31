import { describe, expect, it } from 'vitest';

import { createAnthropicProvider } from '../../src/llm/anthropic';
import { createRemoteHttp, quotaHeadersOf, type JsonHttp } from '../../src/llm/http';
import { createOllamaProvider, llmFailure } from '../../src/llm/ollama';
import { createOpenAiCompatibleProvider } from '../../src/llm/openai-compatible';
import { QuotaLedger, defaultQuotaLedger, describeQuotaSnapshot, hasQuotaData, parseDuration, parseQuotaHeaders } from '../../src/llm/quota';
import { REMOTE_PROVIDERS, REMOTE_PROVIDER_IDS, describeQuota, isRemoteProviderId, registryHosts, remoteProvider, describeModels, recommendedModel } from '../../src/llm/registry';

const NOW = new Date('2026-08-30T12:00:00.000Z');

describe('registro de proveedores', () => {
  it('cada remoto lleva host https, modelo por defecto, variables CHAMELEON_ y evidencia C7 con URL, fecha y cita; los ids y hosts son únicos', () => {
    expect(REMOTE_PROVIDER_IDS).toEqual(['openai', 'anthropic', 'groq', 'gemini']);
    expect(new Set(REMOTE_PROVIDERS.map((entry) => entry.host)).size).toBe(REMOTE_PROVIDERS.length);
    for (const entry of REMOTE_PROVIDERS) {
      expect(entry.baseUrl.startsWith(`https://${entry.host}`)).toBe(true);
      expect(entry.keyEnv).toBe(`CHAMELEON_${entry.id.toUpperCase()}_API_KEY`);
      expect(entry.baseUrlEnv).toBe(`CHAMELEON_${entry.id.toUpperCase()}_BASE_URL`);
      expect(entry.defaultModel.length).toBeGreaterThan(0);
      expect(entry.c7.sourceUrl).toMatch(/^https:\/\//);
      expect(entry.c7.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.c7.quote.split(/\s+/).length).toBeLessThanOrEqual(40);
      expect(entry.rateLimitsUrl).toMatch(/^https:\/\//);
      expect(entry.rateLimitHeaders.every((name) => name === name.toLowerCase())).toBe(true);
      // Gemini no publica límites por modelo (solo «view in AI Studio», docs/gemini-provider.md §1): la fuente vive en rateLimitsUrl.
      if (entry.plan === 'free' && entry.id !== 'gemini') {
        expect(entry.quota).toBeDefined();
        expect(entry.quota?.sourceUrl).toMatch(/^https:\/\//);
      }
    }
    expect(registryHosts()).toEqual(['api.openai.com', 'api.anthropic.com', 'api.groq.com', 'generativelanguage.googleapis.com']);
    expect(isRemoteProviderId('groq')).toBe(true);
    expect(isRemoteProviderId('gemini')).toBe(true);
    expect(isRemoteProviderId('grok')).toBe(false);
    expect(remoteProvider('groq')).toMatchObject({ api: 'openai-chat', baseUrl: 'https://api.groq.com/openai', plan: 'free' });
    expect(remoteProvider('gemini')).toMatchObject({ availability: 'pending-verification', paths: { chat: '/chat/completions', models: '/models' } });
    expect(() => remoteProvider('grok' as never)).toThrow(/sin registrar/);
  });

  it('cada remoto lista sus modelos seleccionables con estado, tareas y evidencia; el de por defecto está entre ellos; Groq ofrece gpt-oss-120b y qwen3.8-27b', () => {
    for (const entry of REMOTE_PROVIDERS) {
      expect(entry.models.length).toBeGreaterThan(0);
      expect(new Set(entry.models.map((model) => model.id)).size).toBe(entry.models.length);
      expect(entry.models.map((model) => model.id)).toContain(entry.defaultModel);
      for (const model of entry.models) {
        // D3 de docs/gemini-provider.md: sin recommendedFor hasta pasar el arnés en español.
        if (entry.id !== 'gemini') {
          expect(model.recommendedFor.length).toBeGreaterThan(0);
        }
        expect(model.sourceUrl).toMatch(/^https:\/\//);
        expect(model.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(model.note.length).toBeGreaterThan(0);
      }
    }
    const groq = remoteProvider('groq');
    expect(groq.models.map((model) => [model.id, model.status])).toEqual([
      ['openai/gpt-oss-120b', 'production'],
      ['qwen/qwen3.8-27b', 'preview'],
    ]);
    expect(recommendedModel(groq, 'improve').id).toBe('openai/gpt-oss-120b');
    expect(recommendedModel(groq, 'suggest-tags').id).toBe('qwen/qwen3.8-27b');
    expect(recommendedModel({ ...groq, models: [{ ...groq.models[0]!, recommendedFor: [] }] }, 'improve').id).toBe('openai/gpt-oss-120b');
    expect(recommendedModel({ ...groq, defaultModel: 'otro', models: [{ ...groq.models[1]!, recommendedFor: [] }] }, 'improve').id).toBe('qwen/qwen3.8-27b');
    expect(describeModels(groq.models)).toBe('openai/gpt-oss-120b (estable; improve, summarize) · qwen/qwen3.8-27b (preview; suggest-tags, improve, summarize)');
  });

  it('describe una cuota publicada solo con los límites presentes', () => {
    expect(describeQuota(remoteProvider('groq').quota as never)).toBe('30 req/min, 1000 req/día, 8000 tokens/min, 200000 tokens/día');
    expect(describeQuota({ requestsPerDay: 50, note: '', sourceUrl: 'https://x', verifiedAt: '2026-08-30' })).toBe('50 req/día');
    expect(describeQuota({ note: '', sourceUrl: 'https://x', verifiedAt: '2026-08-30' })).toBe('');
  });
});

describe('cuota viva', () => {
  it('parseDuration entiende segundos, duraciones con unidades, fechas HTTP e ISO, y rechaza el resto', () => {
    expect(parseDuration('45')).toBe(45);
    expect(parseDuration('7.66s')).toBe(8);
    expect(parseDuration('2m59.56s')).toBe(180);
    expect(parseDuration('1h2m')).toBe(3720);
    expect(parseDuration('250ms')).toBe(0);
    expect(parseDuration('Sun, 30 Aug 2026 12:00:30 GMT', NOW)).toBe(30);
    expect(parseDuration('2026-08-30T11:00:00.000Z', NOW)).toBe(0);
    expect(parseDuration('')).toBeUndefined();
    expect(parseDuration('pronto')).toBeUndefined();
  });

  it('parseQuotaHeaders normaliza las familias x-ratelimit-* y anthropic-ratelimit-* y retry-after; ignora lo demás', () => {
    expect(
      parseQuotaHeaders({
        'x-ratelimit-limit-requests': '1000',
        'x-ratelimit-remaining-requests': '998',
        'x-ratelimit-reset-requests': '2m59.56s',
        'X-RateLimit-Limit-Tokens': '8000',
        'x-ratelimit-remaining-tokens': '7000',
        'x-ratelimit-reset-tokens': '7.66s',
        'retry-after': '12',
        'content-type': 'application/json',
      }),
    ).toEqual({ limitRequests: 1000, remainingRequests: 998, resetRequestsSeconds: 180, limitTokens: 8000, remainingTokens: 7000, resetTokensSeconds: 8, retryAfterSeconds: 12 });
    expect(
      parseQuotaHeaders({ 'anthropic-ratelimit-requests-limit': '50', 'anthropic-ratelimit-requests-remaining': '49', 'anthropic-ratelimit-requests-reset': '2026-08-30T12:01:00Z', 'anthropic-ratelimit-tokens-limit': 'x', 'anthropic-ratelimit-tokens-remaining': '-3', 'anthropic-ratelimit-tokens-reset': 'ayer' }, NOW),
    ).toEqual({ limitRequests: 50, remainingRequests: 49, resetRequestsSeconds: 60, limitTokens: undefined, remainingTokens: undefined, resetTokensSeconds: undefined });
    expect(hasQuotaData(parseQuotaHeaders({ 'content-type': 'x' }))).toBe(false);
    expect(hasQuotaData(parseQuotaHeaders({ 'retry-after': '3' }))).toBe(true);
  });

  it('el libro guarda la última lectura por proveedor y la describe', () => {
    const ledger = new QuotaLedger();
    expect(ledger.record('groq', { 'content-type': 'x' }, NOW)).toBeUndefined();
    expect(ledger.get('groq')).toBeUndefined();
    const first = ledger.record('groq', { 'x-ratelimit-limit-requests': '30', 'x-ratelimit-remaining-requests': '28', 'x-ratelimit-reset-requests': '12s' }, NOW);
    expect(first).toEqual({ provider: 'groq', observedAt: '2026-08-30T12:00:00.000Z', limitRequests: 30, remainingRequests: 28, resetRequestsSeconds: 12 });
    expect(describeQuotaSnapshot(first as never)).toBe('quedan 28/30 peticiones (se renueva en 12 s)');
    const second = ledger.record('groq', { 'x-ratelimit-remaining-tokens': '7000', 'retry-after': '5' }, NOW);
    expect(ledger.get('groq')).toBe(second);
    expect(describeQuotaSnapshot(second as never)).toBe('quedan 7000 tokens restantes · reintentar en 5 s');
    expect(describeQuotaSnapshot({ provider: 'groq', observedAt: 'x', limitTokens: 8000 })).toBe('quedan ?/8000 tokens');
    expect(describeQuotaSnapshot({ provider: 'groq', observedAt: 'x' })).toBe('sin datos de cuota');
    expect(ledger.all().map((snapshot) => snapshot.provider)).toEqual(['groq']);
    ledger.clear();
    expect(ledger.all()).toEqual([]);
    expect(defaultQuotaLedger).toBeInstanceOf(QuotaLedger);
  });

  it('el cliente HTTP devuelve solo las cabeceras de cuota y createRemoteHttp las pasa al observador', async () => {
    const headers = new Headers({ 'X-RateLimit-Remaining-Requests': '9', 'retry-after': '3', authorization: 'Bearer nunca', 'content-type': 'application/json' });
    expect(quotaHeadersOf(headers)).toEqual({ 'x-ratelimit-remaining-requests': '9', 'retry-after': '3' });
    const seen: unknown[] = [];
    const fetchImpl = (async (): Promise<Response> => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining-tokens': '10' } })) as unknown as typeof fetch;
    const observed = createRemoteHttp(['api.groq.com'], fetchImpl, (quota) => seen.push(quota));
    expect(await observed({ url: 'https://api.groq.com/openai/v1/models', method: 'GET' })).toEqual({ ok: true, status: 200, data: { ok: true }, headers: { 'x-ratelimit-remaining-tokens': '10' } });
    expect(seen).toEqual([{ 'x-ratelimit-remaining-tokens': '10' }]);
    const silent = (async (): Promise<Response> => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const quiet = createRemoteHttp(['api.groq.com'], silent, (quota) => seen.push(quota));
    expect(await quiet({ url: 'https://api.groq.com/openai/v1/models', method: 'GET' })).toEqual({ ok: true, status: 200, data: {} });
    expect(seen).toHaveLength(1);
    const limited = (async (): Promise<Response> => new Response('slow down', { status: 429, headers: { 'retry-after': '7' } })) as unknown as typeof fetch;
    const throttled = createRemoteHttp(['api.groq.com'], limited, (quota) => seen.push(quota));
    expect(await throttled({ url: 'https://api.groq.com/openai/v1/chat/completions', method: 'POST', body: {} })).toMatchObject({ ok: false, code: 'http', status: 429, headers: { 'retry-after': '7' } });
    expect(seen).toHaveLength(2);
    expect(createRemoteHttp(['api.groq.com'], silent)).toBeTypeOf('function');
  });

  it('un 429 es quota-exceeded con el retry-after en los tres proveedores; el lote no reintenta', async () => {
    const http: JsonHttp = () => Promise.resolve({ ok: false, code: 'http', message: 'HTTP 429: slow down', status: 429, headers: { 'retry-after': '7' } });
    const request = { messages: [{ role: 'user' as const, content: 'x' }], schema: {}, schemaName: 's', maxTokens: 10 };
    expect(await createOpenAiCompatibleProvider({ http, id: 'groq', kind: 'remote', baseUrl: 'https://api.groq.com/openai' }).complete(request)).toEqual({
      ok: false,
      code: 'quota-exceeded',
      message: 'Servidor compatible con OpenAI: cuota agotada, HTTP 429 (el proveedor pide esperar 7 s); no se reintenta',
      retryAfterSeconds: 7,
    });
    expect(await createAnthropicProvider({ apiKey: 'k', http }).complete(request)).toMatchObject({ ok: false, code: 'quota-exceeded', retryAfterSeconds: 7 });
    expect(await createOllamaProvider({ http }).complete(request)).toMatchObject({ ok: false, code: 'quota-exceeded', message: expect.stringMatching(/^Ollama: cuota agotada/) as string });
    expect(llmFailure({ ok: false, code: 'http', message: 'HTTP 429', status: 429 }, 'X')).toEqual({ ok: false, code: 'quota-exceeded', message: 'X: cuota agotada, HTTP 429; no se reintenta', retryAfterSeconds: undefined });
    expect(llmFailure({ ok: false, code: 'timeout', message: 'tarde' }, 'X')).toEqual({ ok: false, code: 'timeout', message: 'X: tarde' });
  });

  it('las cabeceras de cuota acompañan también a las respuestas demasiado grandes, no JSON y a los fallos de lectura', async () => {
    const quota = { 'x-ratelimit-remaining-requests': '1' };
    const big = (async (): Promise<Response> => new Response('{}', { status: 200, headers: { 'content-length': '99999999', ...quota } })) as unknown as typeof fetch;
    expect(await createRemoteHttp(['api.groq.com'], big)({ url: 'https://api.groq.com/x', method: 'GET' })).toMatchObject({ ok: false, code: 'too-large', headers: quota });
    const text = (async (): Promise<Response> => new Response('no json', { status: 200, headers: quota })) as unknown as typeof fetch;
    expect(await createRemoteHttp(['api.groq.com'], text)({ url: 'https://api.groq.com/x', method: 'GET' })).toMatchObject({ ok: false, code: 'invalid-json', headers: quota });
    const huge = (async (): Promise<Response> => new Response('x'.repeat(5 * 1024 * 1024), { status: 200, headers: quota })) as unknown as typeof fetch;
    expect(await createRemoteHttp(['api.groq.com'], huge)({ url: 'https://api.groq.com/x', method: 'GET' })).toMatchObject({ ok: false, code: 'too-large', headers: quota });
    const broken = (async (): Promise<Response> => ({ ok: true, status: 200, headers: new Headers(quota), text: () => Promise.reject(new Error('boom')) }) as unknown as Response) as unknown as typeof fetch;
    expect(await createRemoteHttp(['api.groq.com'], broken)({ url: 'https://api.groq.com/x', method: 'GET' })).toMatchObject({ ok: false, code: 'unreachable', headers: quota });
  });
});
