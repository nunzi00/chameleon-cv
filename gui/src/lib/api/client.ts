/**
 * Cliente tipado de /api/v1 (docs/gui-mvp.md §4.1): `fetch` inyectable, `Authorization: Bearer` en cada petición,
 * identificadores relativos codificados por segmento, `If-Match` en las escrituras y la envoltura de error del
 * servidor convertida en `ApiError`. Sin caché ni estado: la verdad está en el servidor.
 */
import type { BuildResponse, ErrorResponse, ProfileResponse, ShutdownResponse, SourceResponse, SourceWriteResponse, SourcesResponse, StatusResponse, ValidateResponse } from './types';

/** El cuerpo de un error: el del contrato o, sin envoltura, uno sintético (`http`). */
export interface ErrorBody {
  readonly code: string;
  readonly message: string;
  readonly lines?: readonly string[] | undefined;
  readonly [detail: string]: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly lines: readonly string[];
  readonly details: Readonly<Record<string, unknown>>;

  constructor(status: number, error: ErrorBody) {
    super(error.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = error.code;
    const { code: _code, message: _message, lines, ...details } = error;
    this.lines = Array.isArray(lines) ? lines.map(String) : [];
    this.details = details;
  }
}

/** No hubo respuesta: cv serve no está en marcha o la red local falló. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super(`No se pudo conectar con cv serve: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'NetworkError';
  }
}

export interface ApiClientOptions {
  readonly fetch: typeof fetch;
  /** El token de sesión vigente; sin él las peticiones salen sin cabecera y el servidor responde 401. */
  readonly token: () => string | undefined;
  readonly base?: string | undefined;
}

export interface ApiClient {
  status(): Promise<StatusResponse>;
  validate(): Promise<ValidateResponse>;
  build(): Promise<BuildResponse>;
  profile(): Promise<ProfileResponse>;
  sources(): Promise<SourcesResponse>;
  source(path: string): Promise<SourceResponse>;
  /** `ifMatch`: la huella leída, o «*» para crear. */
  writeSource(path: string, content: string, ifMatch: string): Promise<SourceWriteResponse>;
  shutdown(): Promise<ShutdownResponse>;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface RequestInit {
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>> | undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  return typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'object' && value.error !== null && 'code' in value.error && 'message' in value.error;
}

/** Cada segmento del identificador se codifica por separado: la barra es parte de la ruta de la API. */
export function encodeId(id: string): string {
  return id.split('/').map(encodeURIComponent).join('/');
}

/** La cabecera If-Match: la huella entrecomillada, o «*» tal cual. */
export function ifMatchHeader(value: string): string {
  return value === '*' ? '*' : `"${value}"`;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const base = options.base ?? '/api/v1';
  async function request<T>(method: Method, path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers ?? {}) };
    const token = options.token();
    if (token !== undefined) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    let response: Response;
    try {
      response = await options.fetch(`${base}${path}`, { method, headers, body: init.body === undefined ? null : JSON.stringify(init.body) });
    } catch (error) {
      throw new NetworkError(error);
    }
    const text = await response.text();
    const json = text === '' ? undefined : parseJson(text);
    if (!response.ok) {
      throw new ApiError(response.status, isErrorResponse(json) ? json.error : { code: 'http', message: `HTTP ${response.status}` });
    }
    return json as T;
  }
  return {
    status: () => request('GET', '/status'),
    validate: () => request('POST', '/validate', { body: {} }),
    build: () => request('POST', '/build', { body: {} }),
    profile: () => request('GET', '/profile'),
    sources: () => request('GET', '/sources'),
    source: (path) => request('GET', `/sources/${encodeId(path)}`),
    writeSource: (path, content, ifMatch) => request('PUT', `/sources/${encodeId(path)}`, { body: { content }, headers: { 'If-Match': ifMatchHeader(ifMatch) } }),
    shutdown: () => request('POST', '/shutdown', { body: {} }),
  };
}
