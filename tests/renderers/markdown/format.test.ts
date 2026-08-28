import { describe, expect, it } from 'vitest';

import { byDateDescending, chronological, formatDate, formatPeriod, joinParts } from '../../../src/renderers/markdown/format';

describe('formatDate', () => {
  it.each<[string, string, string]>([
    ['2021', 'es-ES', '2021'],
    ['2021-03', 'es-ES', 'mar 2021'],
    ['2021-03-15', 'es-ES', '15 mar 2021'],
    ['2021-03', 'en-US', 'Mar 2021'],
    ['2021-03-15', 'en-US', 'Mar 15, 2021'],
  ])('%s en %s → %s', (iso, locale, expected) => {
    expect(formatDate(iso, locale)).toBe(expected);
  });
});

describe('formatPeriod', () => {
  it('une inicio y fin con guion largo y usa la etiqueta de «actualidad» sin fin', () => {
    expect(formatPeriod({ start: '2021-03', end: '2024-06' }, 'es-ES', 'actualidad')).toBe('mar 2021 – jun 2024');
    expect(formatPeriod({ start: '2024-07' }, 'en', 'present')).toBe('Jul 2024 – present');
  });
});

describe('chronological', () => {
  it('pone primero los periodos en curso, luego por inicio descendente y los sin fecha al final, de forma estable', () => {
    const items = [
      { id: 'a', dates: { start: '2020', end: '2022' } },
      { id: 'b', dates: { start: '2023' } },
      { id: 'e' },
      { id: 'c', dates: { start: '2021-06' } },
      { id: 'd', dates: { start: '2021', end: '2021-12' } },
      { id: 'f' },
      { id: 'g', dates: { start: '2020', end: '2020-06' } },
    ];
    expect(chronological(items).map((item) => item.id)).toEqual(['b', 'c', 'd', 'a', 'g', 'e', 'f']);
  });
});

describe('byDateDescending', () => {
  it('ordena por fecha descendente, estable, con los ítems sin fecha al final', () => {
    const items = [{ id: 'x', date: '2020' }, { id: 'z' }, { id: 'y', date: '2022-05' }, { id: 'w', date: '2020' }];
    expect(byDateDescending(items).map((item) => item.id)).toEqual(['y', 'x', 'w', 'z']);
  });
});

describe('joinParts', () => {
  it('ignora partes ausentes o vacías', () => {
    expect(joinParts(['a', undefined, '', 'b'])).toBe('a · b');
    expect(joinParts([undefined])).toBe('');
  });
});
