/**
 * Piezas HTTP del servidor: lectura acotada del cuerpo, validación con zod, envoltura de errores
 * (`{ error: { code, message, lines? } }`) y correspondencia entre los errores de la capa de casos de uso y
 * los códigos de estado.
 */
import type { IncomingMessage } from 'node:http';

import type { ZodType } from 'zod';

import type { AppError, AppErrorCode } from '../app/errors';
import { describeError } from '../shared/errors';
import type { RouteResponse } from './router';

export const JSON_BODY_LIMIT = 1024 * 1024;

export type ServerErrorCode = AppErrorCode | 'unauthorized' | 'forbidden-host' | 'forbidden-origin' | 'bad-request' | 'method-not-allowed' | 'payload-too-large' | 'precondition-required' | 'remote-disabled' | 'consent-required';

const STATUS: Readonly<Record<ServerErrorCode, number>> = {
  usage: 400,
  'bad-request': 400,
  'unsafe-path': 400,
  unauthorized: 401,
  'forbidden-host': 403,
  'forbidden-origin': 403,
  'remote-disabled': 403,
  'not-found': 404,
  'method-not-allowed': 405,
  conflict: 409,
  'consent-required': 409,
  'payload-too-large': 413,
  'invalid-data': 422,
  'precondition-required': 428,
  environment: 503,
};

export function statusOf(code: ServerErrorCode): number {
  return STATUS[code];
}

export function errorResponse(code: ServerErrorCode, message: string, extra: Readonly<Record<string, unknown>> = {}, headers?: Readonly<Record<string, string>>): RouteResponse {
  return { status: statusOf(code), json: { error: { code, message, ...extra } }, headers };
}

/** Un error de la capa de casos de uso, tal cual, con sus líneas si las tiene. */
export function appErrorResponse(error: AppError, extra: Readonly<Record<string, unknown>> = {}): RouteResponse {
  return errorResponse(error.code, error.message, { ...(error.lines === undefined ? {} : { lines: error.lines }), ...extra });
}

export function json(status: number, body: unknown, headers?: Readonly<Record<string, string>>): RouteResponse {
  return { status, json: body, headers };
}

export type BodyRead = { readonly ok: true; readonly body: Buffer } | { readonly ok: false; readonly response: RouteResponse };

/**
 * Lee el cuerpo hasta `limit` bytes. Si lo supera, deja de guardarlo y descarta el resto (hasta cuatro veces el
 * límite, para poder responder 413 sin cortar la conexión a medias); más allá, corta.
 */
export function readBody(request: IncomingMessage, limit: number): Promise<BodyRead> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let done = false;
    let overflow = false;
    const finish = (result: BodyRead): void => {
      if (!done) {
        done = true;
        resolve(result);
      }
    };
    const tooLarge = (): BodyRead => ({ ok: false, response: errorResponse('payload-too-large', `El cuerpo supera el máximo de ${limit} bytes`) });
    request.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > limit) {
        overflow = true;
        if (received > limit * 4) {
          request.destroy();
          finish(tooLarge());
        }
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => finish(overflow ? tooLarge() : { ok: true, body: Buffer.concat(chunks) }));
    request.on('error', (error: Error) => finish({ ok: false, response: errorResponse('bad-request', `No se pudo leer el cuerpo: ${error.message}`) }));
  });
}

/** Una cabecera de Node (cadena, lista o ausente) como una sola cadena. */
export function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(', ') : value;
}

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly response: RouteResponse };

/** JSON válido que cumple el esquema; si no, 400 con los problemas de zod. */
export function parseJsonBody<T>(body: Buffer, schema: ZodType<T>): Parsed<T> {
  let raw: unknown;
  try {
    raw = body.length === 0 ? {} : JSON.parse(body.toString('utf8'));
  } catch (error) {
    return { ok: false, response: errorResponse('bad-request', `El cuerpo no es JSON válido: ${describeError(error)}`) };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return { ok: false, response: errorResponse('bad-request', 'El cuerpo no cumple el esquema', { issues: result.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })) }) };
  }
  return { ok: true, value: result.data };
}
