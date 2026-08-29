/**
 * Enrutador mínimo (docs/api-headless.md §4): método + patrón con parámetros (`{name}` un segmento,
 * `{name+}` el resto de la ruta) y un registro de rutas con metadatos, del que salen el enrutamiento y
 * la referencia generada de la API (C15). Sin dependencias.
 */
import type { ZodType } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export type RouteResponse =
  | { readonly status: number; readonly json: unknown; readonly bytes?: undefined; readonly headers?: Readonly<Record<string, string>> | undefined }
  | { readonly status: number; readonly bytes: Buffer; readonly contentType: string; readonly headers?: Readonly<Record<string, string>> | undefined };

export interface RouteRequest {
  readonly params: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string | undefined>>;
  /** Cuerpo ya leído (limitado); vacío en GET. */
  readonly body: Buffer;
}

export type RouteHandler<S> = (request: RouteRequest, state: S) => Promise<RouteResponse>;

export interface RouteSpec<S> {
  readonly method: HttpMethod;
  readonly path: string;
  readonly summary: string;
  /** Escribe en el espacio de trabajo. */
  readonly writes: boolean;
  /** Esquema del cuerpo JSON, si lo hay (también documenta la petición). */
  readonly body?: ZodType | undefined;
  /** Tipo de contenido esperado cuando el cuerpo no es JSON. */
  readonly accepts?: string | undefined;
  readonly handler: RouteHandler<S>;
}

interface Compiled<S> {
  readonly spec: RouteSpec<S>;
  readonly pattern: RegExp;
  readonly names: readonly string[];
}

export type RouteMatch<S> = { readonly kind: 'route'; readonly spec: RouteSpec<S>; readonly params: Readonly<Record<string, string>> } | { readonly kind: 'method-not-allowed'; readonly allowed: readonly HttpMethod[] } | { readonly kind: 'none' };

function compile<S>(spec: RouteSpec<S>): Compiled<S> {
  const names: string[] = [];
  const source = spec.path
    .split('/')
    .map((segment) => {
      const rest = /^\{(\w+)\+\}$/.exec(segment);
      if (rest !== null) {
        names.push(String(rest[1]));
        return '(.+)';
      }
      const single = /^\{(\w+)\}$/.exec(segment);
      if (single !== null) {
        names.push(String(single[1]));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { spec, pattern: new RegExp(`^${source}$`), names };
}

export class Router<S> {
  private readonly routes: Compiled<S>[] = [];

  add(spec: RouteSpec<S>): this {
    this.routes.push(compile(spec));
    return this;
  }

  /** Las rutas registradas, en orden (para la referencia generada). */
  specs(): readonly RouteSpec<S>[] {
    return this.routes.map((route) => route.spec);
  }

  match(method: string, pathname: string): RouteMatch<S> {
    const allowed: HttpMethod[] = [];
    for (const route of this.routes) {
      const found = route.pattern.exec(pathname);
      if (found === null) {
        continue;
      }
      if (route.spec.method !== method) {
        allowed.push(route.spec.method);
        continue;
      }
      const params: Record<string, string> = {};
      route.names.forEach((name, index) => {
        params[name] = decodeURIComponent(String(found[index + 1]));
      });
      return { kind: 'route', spec: route.spec, params };
    }
    return allowed.length === 0 ? { kind: 'none' } : { kind: 'method-not-allowed', allowed };
  }
}
