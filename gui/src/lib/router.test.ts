import { describe, expect, it } from 'vitest';

import { PAGES, formatRoute, parseRoute } from './router';

describe('enrutador por fragmento', () => {
  it('interpreta la página y el elemento, y vuelve a Estado ante rutas desconocidas', () => {
    expect(parseRoute('')).toEqual({ page: 'estado' });
    expect(parseRoute('#/')).toEqual({ page: 'estado' });
    expect(parseRoute('#/fuentes')).toEqual({ page: 'fuentes' });
    expect(parseRoute('#/fuentes/')).toEqual({ page: 'fuentes' });
    expect(parseRoute('#/fuentes/experience%2Facme.md')).toEqual({ page: 'fuentes', item: 'experience/acme.md' });
    expect(parseRoute('#/revisiones/revision-improve-2026-08-29.md')).toEqual({ page: 'revisiones', item: 'revision-improve-2026-08-29.md' });
    expect(parseRoute('#/nada/x')).toEqual({ page: 'estado', item: 'x' });
    expect(parseRoute('#/fuentes/%E0%A4%A')).toEqual({ page: 'fuentes', item: '%E0%A4%A' });
  });

  it('formatea de vuelta (ida y vuelta) codificando el elemento', () => {
    for (const { page } of PAGES) {
      expect(parseRoute(formatRoute({ page }))).toEqual({ page });
    }
    const route = { page: 'fuentes' as const, item: 'projects/ñ y espacio.md' };
    expect(formatRoute(route)).toBe('#/fuentes/projects%2F%C3%B1%20y%20espacio.md');
    expect(parseRoute(formatRoute(route))).toEqual(route);
  });
});
