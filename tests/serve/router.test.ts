import { describe, expect, it } from 'vitest';

import { Router, type RouteResponse } from '../../src/serve';

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
