/**
 * Cliente HTTP JSON contenido para proveedores de modelos (T-4.2/T-4.5, `docs/llm-integration.md`
 * §4.3 y §5): `fetch` nativo, sin SDKs; solo URLs permitidas por una política explícita (loopback
 * para los proveedores locales; https hacia una lista blanca de hosts para los remotos), sin
 * redirecciones, tiempo y tamaño de respuesta acotados, y errores tipificados. Las cabeceras de
 * autenticación las añade cada proveedor; nunca se registran ni se devuelven en los errores.
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
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly timeoutMs?: number | undefined;
  /** Cancelación por el llamador (un trabajo de la API); se combina con el tiempo máximo. */
  readonly signal?: AbortSignal | undefined;
}

export type JsonHttpErrorCode = 'refused' | 'unreachable' | 'timeout' | 'cancelled' | 'http' | 'too-large' | 'invalid-json';

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

/** Política remota: solo https y solo hacia los hosts de la lista blanca (comparación exacta, sin subdominios). */
export function allowsHosts(allowedHosts: Iterable<string>): (url: string) => boolean {
  const hosts = new Set([...allowedHosts].map((host) => host.trim().toLowerCase()).filter((host) => host !== ''));
  return (url) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    return parsed.protocol === 'https:' && hosts.has(parsed.hostname.toLowerCase());
  };
}

export interface JsonHttpPolicy {
  /** Decide si una URL puede solicitarse; lo demás se rechaza antes de abrir conexión. */
  readonly allowUrl: (url: string) => boolean;
  readonly maxResponseBytes?: number | undefined;
}

function classify(error: unknown, signal: AbortSignal | undefined): { code: JsonHttpErrorCode; message: string } {
  if (signal?.aborted === true) {
    return { code: 'cancelled', message: 'petición cancelada' };
  }
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
        headers: { accept: 'application/json', ...(request.body === undefined ? {} : { 'content-type': 'application/json' }), ...(request.headers ?? {}) },
        body: request.body === undefined ? null : JSON.stringify(request.body),
        redirect: 'error',
        signal: request.signal === undefined ? AbortSignal.timeout(request.timeoutMs ?? LLM_HTTP_LIMITS.timeoutMs) : AbortSignal.any([request.signal, AbortSignal.timeout(request.timeoutMs ?? LLM_HTTP_LIMITS.timeoutMs)]),
      });
    } catch (error) {
      const failure = classify(error, request.signal);
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
      const failure = classify(error, request.signal);
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

/** Política local: solo loopback. */
export const loopbackOnlyHttp: JsonHttp = createJsonHttp({ allowUrl: isLoopbackUrl });

/** Política remota (T-4.5): https hacia la lista blanca. */
export function createRemoteHttp(allowedHosts: Iterable<string>, fetchImpl?: typeof fetch): JsonHttp {
  return createJsonHttp({ allowUrl: allowsHosts(allowedHosts) }, fetchImpl);
}
