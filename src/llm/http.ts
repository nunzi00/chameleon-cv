/**
 * Cliente HTTP JSON contenido para proveedores de modelos (T-4.2, `docs/llm-integration.md`
 * §4.3 y §5): `fetch` nativo, sin SDKs; solo URLs permitidas por una política explícita (en
 * T-4.2, únicamente loopback: el interruptor de red es la propia política), sin redirecciones,
 * tiempo y tamaño de respuesta acotados, y errores tipificados. Ninguna clave pasa por aquí todavía.
 */
import { describeError } from '../shared/errors';

export const LLM_HTTP_LIMITS = {
  timeoutMs: 120_000,
  healthTimeoutMs: 5_000,
  maxResponseBytes: 4 * 1024 * 1024,
} as const;

export interface JsonHttpRequest {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly body?: unknown;
  readonly timeoutMs?: number | undefined;
}

export type JsonHttpErrorCode = 'refused' | 'unreachable' | 'timeout' | 'http' | 'too-large' | 'invalid-json';

export type JsonHttpResult =
  | { readonly ok: true; readonly status: number; readonly data: unknown }
  | { readonly ok: false; readonly code: JsonHttpErrorCode; readonly message: string; readonly status?: number };

export type JsonHttp = (request: JsonHttpRequest) => Promise<JsonHttpResult>;

/** `localhost`, `127.0.0.0/8` o `::1`, con esquema http(s): lo que consideramos «local» (§4.3). */
export function isLoopbackUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  const host = parsed.hostname;
  return host === 'localhost' || host === '[::1]' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

export interface JsonHttpPolicy {
  /** Decide si una URL puede solicitarse; lo demás se rechaza antes de abrir conexión. */
  readonly allowUrl: (url: string) => boolean;
  readonly maxResponseBytes?: number | undefined;
}

function classify(error: unknown): { code: JsonHttpErrorCode; message: string } {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return { code: 'timeout', message: 'la petición superó el tiempo permitido' };
  }
  return { code: 'unreachable', message: describeError(error) };
}

/** Cliente con política; `fetch` inyectable para las pruebas que no levantan servidor. */
export function createJsonHttp(policy: JsonHttpPolicy, fetchImpl: typeof fetch = fetch): JsonHttp {
  const maxBytes = policy.maxResponseBytes ?? LLM_HTTP_LIMITS.maxResponseBytes;
  return async (request) => {
    if (!policy.allowUrl(request.url)) {
      return { ok: false, code: 'refused', message: `URL no permitida por la política de red: «${request.url}»` };
    }
    let response: Response;
    try {
      response = await fetchImpl(request.url, {
        method: request.method,
        headers: { accept: 'application/json', ...(request.body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: request.body === undefined ? null : JSON.stringify(request.body),
        redirect: 'error',
        signal: AbortSignal.timeout(request.timeoutMs ?? LLM_HTTP_LIMITS.timeoutMs),
      });
    } catch (error) {
      const failure = classify(error);
      return { ok: false, code: failure.code, message: `${failure.message} (${request.method} ${request.url})` };
    }
    const declared = response.headers.get('content-length');
    if (declared !== null && Number(declared) > maxBytes) {
      return { ok: false, code: 'too-large', message: `la respuesta anuncia ${declared} bytes (máximo ${maxBytes})`, status: response.status };
    }
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      const failure = classify(error);
      return { ok: false, code: failure.code, message: `${failure.message} (leyendo la respuesta de ${request.url})`, status: response.status };
    }
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      return { ok: false, code: 'too-large', message: `la respuesta supera el máximo de ${maxBytes} bytes`, status: response.status };
    }
    if (!response.ok) {
      return { ok: false, code: 'http', message: `HTTP ${response.status}: ${text.slice(0, 300).trim()}`, status: response.status };
    }
    try {
      return { ok: true, status: response.status, data: JSON.parse(text) as unknown };
    } catch {
      return { ok: false, code: 'invalid-json', message: `la respuesta no es JSON: ${text.slice(0, 120).trim()}`, status: response.status };
    }
  };
}

/** Política de T-4.2: solo loopback. Los proveedores remotos (T-4.5) tendrán su lista blanca. */
export const loopbackOnlyHttp: JsonHttp = createJsonHttp({ allowUrl: isLoopbackUrl });
