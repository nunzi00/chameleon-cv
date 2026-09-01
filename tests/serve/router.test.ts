import { describe, expect, it } from 'vitest';

import { Router, createRouter, type RouteResponse } from '../../src/serve';

function router(): Router<void> {
  const ok = async (): Promise<RouteResponse> => ({ status: 200, json: null });
  return new Router<void>()
    .add({ method: 'GET', path: '/a/{id}', summary: 'uno', writes: false, handler: ok })
    .add({ method: 'PUT', path: '/files/{path+}', summary: 'resto', writes: true, handler: ok })
    .add({ method: 'GET', path: '/dot.path', summary: 'literal', writes: false, handler: ok });
}

describe('Router', () => {
  it('empareja método y patrón, decodifica los parámetros y distingue «sin ruta» de «método no admitido»', () => {
    const r = router();
    const one = r.match('GET', '/a/x%20y');
    expect(one.kind).toBe('route');
    if (one.kind === 'route') {
      expect(one.params).toEqual({ id: 'x y' });
      expect(one.spec.summary).toBe('uno');
    }
    const rest = r.match('PUT', '/files/experience/acme%20corp.md');
    expect(rest.kind === 'route' && rest.params['path']).toBe('experience/acme corp.md');
    expect(r.match('POST', '/a/x')).toEqual({ kind: 'method-not-allowed', allowed: ['GET'] });
    expect(r.match('GET', '/nope')).toEqual({ kind: 'none' });
    expect(r.match('GET', '/dotXpath')).toEqual({ kind: 'none' });
    expect(r.match('GET', '/dot.path').kind).toBe('route');
    expect(r.match('GET', '/a/x/y')).toEqual({ kind: 'none' });
    expect(r.specs().map((spec) => spec.path)).toEqual(['/a/{id}', '/files/{path+}', '/dot.path']);
  });
});

describe('el registro completo de rutas', () => {
  it('no registra dos veces la misma ruta', () => {
    // Regresión del 1-sep: al agrupar las rutas por dominios se coló una llamada de más a `addCopilotRoutes` y
    // las trece rutas del co-piloto quedaron registradas dos veces. Ni las pruebas ni el arnés lo vieron —el
    // enrutador atiende igual y la primera coincidencia gana—; lo cazó la referencia generada, al salirle dos
    // anclas iguales. Esta guarda lo caza antes.
    const paths = createRouter()
      .specs()
      .map((spec) => `${spec.method} ${spec.path}`);
    expect([...new Set(paths)]).toEqual(paths);
  });

  it('todas las rutas cuelgan de /api/v1 y ninguna lleva ruta del sistema', () => {
    for (const spec of createRouter().specs()) {
      expect(spec.path.startsWith('/api/v1/')).toBe(true);
      expect(spec.summary.length).toBeGreaterThan(20);
    }
  });
});
