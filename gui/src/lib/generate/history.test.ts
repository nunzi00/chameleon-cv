import { describe, expect, it } from 'vitest';

import { describeHistoryEntries, shortDate } from './history';

describe('historial de ofertas en la GUI', () => {
  it('describe cada procesamiento con fecha corta, acción, especialidad y CV', () => {
    expect(shortDate('2026-08-30T12:10:33.000Z')).toBe('2026-08-30 12:10');
    expect(shortDate('ayer')).toBe('ayer');
    expect(
      describeHistoryEntries([
        { at: '2026-08-30T12:10:33.000Z', action: 'generate', offer: { name: 'nexo', sha256: 'x' }, specialty: 'backend', output: { path: 'output/cv.pdf', format: 'pdf', engine: 'typst', theme: 'modern' } },
        { at: '2026-08-29T09:00:00.000Z', action: 'analyze', offer: { name: 'nexo', sha256: 'x' } },
      ]),
    ).toEqual(['2026-08-30 12:10 · Generar CV (backend) → output/cv.pdf', '2026-08-29 09:00 · Analizar oferta']);
  });
});
