import { createServer, type Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LLM_HTTP_LIMITS, createJsonHttp, isLoopbackUrl, loopbackOnlyHttp } from '../../src/llm';

let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      switch (request.url) {
        case '/echo':
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ method: request.method, body: body === '' ? null : (JSON.parse(body) as unknown), accept: request.headers.accept }));
          return;
        case '/slow':
          setTimeout(() => response.end('{}'), 2_000);
          return;
        case '/text':
          response.writeHead(200);
          response.end('no soy json');
          return;
        case '/error':
          response.writeHead(500);
          response.end('{"error":"boom"}');
          return;
        case '/big':
          response.writeHead(200, { 'content-length': String(10 * 1024 * 1024) });
          response.end();
          return;
        case '/big-body':
          response.writeHead(200);
          response.end(`{"x":"${'a'.repeat(3000)}"}`);
          return;
        case '/redirect':
          response.writeHead(302, { location: `${base}/echo` });
          response.end();
          return;
        default:
          response.writeHead(404);
          response.end('{}');
      }
    });
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

describe('isLoopbackUrl', () => {
  it('acepta solo http(s) hacia localhost, 127.x.x.x o ::1', () => {
    expect(isLoopbackUrl('http://127.0.0.1:11434')).toBe(true);
    expect(isLoopbackUrl('http://localhost:8080/v1')).toBe(true);
    expect(isLoopbackUrl('https://[::1]:8443')).toBe(true);
    expect(isLoopbackUrl('http://127.1.2.3')).toBe(true);
    expect(isLoopbackUrl('http://192.168.1.10:11434')).toBe(false);
    expect(isLoopbackUrl('https://api.openai.com/v1')).toBe(false);
    expect(isLoopbackUrl('ftp://127.0.0.1')).toBe(false);
    expect(isLoopbackUrl('no es una url')).toBe(false);
  });
});

describe('createJsonHttp / loopbackOnlyHttp', () => {
  it('envía JSON, recibe JSON y rechaza en código toda URL fuera de la política antes de conectar', async () => {
    const echo = await loopbackOnlyHttp({ url: `${base}/echo`, method: 'POST', body: { hola: 1 } });
    expect(echo).toEqual({ ok: true, status: 200, data: { method: 'POST', body: { hola: 1 }, accept: 'application/json' } });
    const get = await loopbackOnlyHttp({ url: `${base}/echo`, method: 'GET' });
    expect(get).toMatchObject({ ok: true, data: { method: 'GET', body: null } });
    expect(await loopbackOnlyHttp({ url: 'https://api.openai.com/v1/models', method: 'GET' })).toEqual({ ok: false, code: 'refused', message: 'URL no permitida por la política de red: «https://api.openai.com/v1/models»' });
    expect(LLM_HTTP_LIMITS.timeoutMs).toBe(120_000);
  });

  it('tipifica tiempo agotado, servidor caído, errores HTTP, respuestas no JSON, demasiado grandes y redirecciones', async () => {
    expect(await loopbackOnlyHttp({ url: `${base}/slow`, method: 'GET', timeoutMs: 200 })).toMatchObject({ ok: false, code: 'timeout' });
    expect(await loopbackOnlyHttp({ url: 'http://127.0.0.1:9/x', method: 'GET' })).toMatchObject({ ok: false, code: 'unreachable' });
    expect(await loopbackOnlyHttp({ url: `${base}/error`, method: 'GET' })).toEqual({ ok: false, code: 'http', message: 'HTTP 500: {"error":"boom"}', status: 500 });
    expect(await loopbackOnlyHttp({ url: `${base}/text`, method: 'GET' })).toMatchObject({ ok: false, code: 'invalid-json', status: 200 });
    expect(await loopbackOnlyHttp({ url: `${base}/big`, method: 'GET' })).toMatchObject({ ok: false, code: 'too-large', message: expect.stringContaining('anuncia') });
    const small = createJsonHttp({ allowUrl: isLoopbackUrl, maxResponseBytes: 1000 });
    expect(await small({ url: `${base}/big-body`, method: 'GET' })).toMatchObject({ ok: false, code: 'too-large', message: 'la respuesta supera el máximo de 1000 bytes' });
    expect(await loopbackOnlyHttp({ url: `${base}/redirect`, method: 'GET' })).toMatchObject({ ok: false, code: 'unreachable' });
  });

  it('con un fetch inyectable cubre el fallo al leer el cuerpo', async () => {
    const failingBody = createJsonHttp({ allowUrl: () => true }, () =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: () => Promise.reject(Object.assign(new Error('cortada'), { name: 'TimeoutError' })),
      } as unknown as Response),
    );
    expect(await failingBody({ url: 'http://127.0.0.1:1/x', method: 'GET' })).toEqual({ ok: false, code: 'timeout', message: 'la petición superó el tiempo permitido (leyendo la respuesta de http://127.0.0.1:1/x)', status: 200 });
    const weird = createJsonHttp({ allowUrl: () => true }, () => Promise.reject('boom'));
    expect(await weird({ url: 'http://127.0.0.1:1/x', method: 'GET' })).toEqual({ ok: false, code: 'unreachable', message: 'boom (GET http://127.0.0.1:1/x)' });
  });
});
