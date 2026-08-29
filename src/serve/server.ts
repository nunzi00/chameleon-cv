/**
 * `cv serve` (T-7.4a, docs/api-headless.md §4 y §6): servidor HTTP local sobre `node:http`, ligado a un
 * espacio de trabajo, con token de sesión, `Host` y `Origin` comprobados, sin CORS, cuerpos acotados y
 * los errores de la capa de casos de uso traducidos a estados HTTP. Sirve una página mínima en `/` (la
 * GUI llega en T-7.5) y el contrato en `/api/v1`.
 */
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { AppContext } from '../app/context';
import { describeError } from '../shared/errors';
import { errorResponse, headerValue, readBody } from './http';
import { landingPage } from './page';
import type { RouteResponse } from './router';
import { API_PREFIX, bodyLimitFor, createRouter, type ServerState } from './routes';
import { allowedHosts, generateToken, isAllowedHost, isAllowedOrigin, isAuthorized } from './security';

export interface ServeOptions {
  readonly context: AppContext;
  readonly host: string;
  readonly port: number;
  readonly data: string;
  readonly profile: string;
  readonly version: string;
  readonly apiOnly: boolean;
  readonly allowedHosts: readonly string[];
  /** Solo para pruebas: un token fijo en lugar de uno aleatorio. */
  readonly token?: string | undefined;
}

export interface ServerHandle {
  readonly url: string;
  readonly token: string;
  readonly port: number;
  /** Se resuelve cuando el servidor ha cerrado (Ctrl-C, POST /shutdown o `close()`). */
  readonly closed: Promise<void>;
  close(): Promise<void>;
}

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
};

function send(response: ServerResponse, route: RouteResponse): void {
  const headers: Record<string, string> = { ...SECURITY_HEADERS, ...(route.headers ?? {}) };
  if (route.bytes !== undefined) {
    headers['Content-Type'] = route.contentType;
    headers['Content-Length'] = String(route.bytes.byteLength);
    response.writeHead(route.status, headers);
    response.end(route.bytes);
    return;
  }
  const body = Buffer.from(JSON.stringify(route.json), 'utf8');
  headers['Content-Type'] = 'application/json; charset=utf-8';
  headers['Content-Length'] = String(body.byteLength);
  response.writeHead(route.status, headers);
  response.end(body);
}

/** El host de la URL que se imprime: 0.0.0.0 se anuncia como 127.0.0.1 y una IPv6 va entre corchetes. */
export function urlHost(host: string): string {
  if (host === '0.0.0.0' || host === '::') {
    return '127.0.0.1';
  }
  return host.includes(':') ? `[${host}]` : host;
}

function html(status: number, content: string): RouteResponse {
  return { status, bytes: Buffer.from(content, 'utf8'), contentType: 'text/html; charset=utf-8' };
}

export async function startServer(options: ServeOptions): Promise<ServerHandle> {
  const token = options.token ?? generateToken();
  const router = createRouter();
  let server: Server;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const close = (): Promise<void> =>
    new Promise((resolve) => {
      server.close(() => {
        resolveClosed();
        resolve();
      });
      server.closeAllConnections();
    });
  const state: ServerState = { context: options.context, data: options.data, profile: options.profile, version: options.version, shutdown: () => setImmediate(() => void close()) };
  let allowed: ReadonlySet<string> = new Set();

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const method = String(request.method);
    const pathname = new URL(String(request.url), 'http://localhost').pathname;
    if (!isAllowedHost(request.headers.host, allowed)) {
      send(response, errorResponse('forbidden-host', 'Host no permitido: el servidor solo atiende a 127.0.0.1 y localhost (o a --allowed-hosts)'));
      return;
    }
    if (!pathname.startsWith(`${API_PREFIX}/`)) {
      send(response, options.apiOnly || pathname !== '/' || method !== 'GET' ? errorResponse('not-found', 'No existe la ruta') : html(200, landingPage(options.version, options.context.cwd)));
      return;
    }
    if (method !== 'GET' && method !== 'HEAD' && !isAllowedOrigin(request.headers.origin, allowed)) {
      send(response, errorResponse('forbidden-origin', 'Origin no permitido: solo el propio origen puede escribir'));
      return;
    }
    if (!isAuthorized(request.headers.authorization, token)) {
      send(response, errorResponse('unauthorized', 'Falta o no coincide el token de sesión (Authorization: Bearer <token>)', {}, { 'WWW-Authenticate': 'Bearer' }));
      return;
    }
    const match = router.match(method, pathname);
    if (match.kind === 'none') {
      send(response, errorResponse('not-found', `No existe ${method} ${pathname}`));
      return;
    }
    if (match.kind === 'method-not-allowed') {
      send(response, errorResponse('method-not-allowed', `${method} no admitido en ${pathname}`, {}, { Allow: match.allowed.join(', ') }));
      return;
    }
    const body = await readBody(request, bodyLimitFor(match.spec.accepts));
    if (!body.ok) {
      send(response, body.response);
      return;
    }
    const headers: Record<string, string | undefined> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      headers[name] = headerValue(value);
    }
    try {
      send(response, await match.spec.handler({ params: match.params, headers, body: body.body }, state));
    } catch (error) {
      send(response, errorResponse('environment', `Error inesperado: ${describeError(error)}`));
    }
  };

  server = createHttpServer((request, response) => {
    void handle(request, response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;
  allowed = allowedHosts(port, options.allowedHosts);
  return { url: `http://${urlHost(options.host)}:${port}/`, token, port, closed, close };
}

export { createRouter };
