import type { IncomingMessage } from 'node:http';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { dataError } from '../../src/app';
import { appErrorResponse, errorResponse, headerValue, json, parseJsonBody, readBody, statusOf } from '../../src/serve';

describe('respuestas y errores', () => {
  it('traduce cada código a su estado HTTP y envuelve los errores con sus líneas', () => {
    expect(statusOf('invalid-data')).toBe(422);
    expect(statusOf('environment')).toBe(503);
    expect(errorResponse('unauthorized', 'no', { extra: 1 }, { 'WWW-Authenticate': 'Bearer' })).toEqual({ status: 401, json: { error: { code: 'unauthorized', message: 'no', extra: 1 } }, headers: { 'WWW-Authenticate': 'Bearer' } });
    expect(appErrorResponse(dataError('resumen', ['a', 'b']), { issues: [] })).toEqual({ status: 422, json: { error: { code: 'invalid-data', message: 'resumen', lines: ['a', 'b'], issues: [] } }, headers: undefined });
    expect(appErrorResponse(dataError('solo'))).toEqual({ status: 422, json: { error: { code: 'invalid-data', message: 'solo' } }, headers: undefined });
    expect(json(201, { ok: true })).toEqual({ status: 201, json: { ok: true }, headers: undefined });
    expect(headerValue(['a', 'b'])).toBe('a, b');
    expect(headerValue('x')).toBe('x');
    expect(headerValue(undefined)).toBeUndefined();
  });

  it('parsea el cuerpo JSON contra el esquema: vacío es {}, inválido es 400, y los problemas de zod se devuelven', () => {
    const schema = z.object({ name: z.string() });
    expect(parseJsonBody(Buffer.from(''), z.object({}))).toEqual({ ok: true, value: {} });
    expect(parseJsonBody(Buffer.from('{"name":"x"}'), schema)).toEqual({ ok: true, value: { name: 'x' } });
    const invalid = parseJsonBody(Buffer.from('{'), schema);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.response.status).toBe(400);
    }
    const mismatch = parseJsonBody(Buffer.from('{"name":1}'), schema);
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.response).toMatchObject({ status: 400, json: { error: { code: 'bad-request', issues: [{ path: 'name' }] } } });
    }
  });
});

describe('readBody', () => {
  function request(): PassThrough & IncomingMessage {
    return new PassThrough({ autoDestroy: false }) as PassThrough & IncomingMessage;
  }

  it('concatena el cuerpo hasta el límite', async () => {
    const stream = request();
    const pending = readBody(stream, 10);
    stream.write('hola ');
    stream.end('mundo');
    expect(await pending).toEqual({ ok: true, body: Buffer.from('hola mundo') });
  });

  it('un cuerpo mayor que el límite se descarta y responde 413 al terminar; más de cuatro veces el límite corta la conexión', async () => {
    const stream = request();
    const pending = readBody(stream, 4);
    stream.write('demasiado');
    stream.end();
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(413);
    }
    expect(stream.destroyed).toBe(false);
    const flood = request();
    const flooded = readBody(flood, 4);
    flood.write('x'.repeat(17));
    const cut = await flooded;
    expect(cut.ok).toBe(false);
    expect(flood.destroyed).toBe(true);
  });

  it('un error del flujo es 400, y una vez resuelto ignora eventos posteriores', async () => {
    const stream = request();
    const pending = readBody(stream, 10);
    stream.emit('error', new Error('roto'));
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response).toMatchObject({ status: 400, json: { error: { code: 'bad-request', message: 'No se pudo leer el cuerpo: roto' } } });
    }
    stream.emit('end');
    expect(await pending).toBe(result);
  });
});
