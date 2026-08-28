import { describe, expect, it } from 'vitest';

import {
  expandIsoDate,
  ISO_DATE_PATTERN,
  isOrderedRange,
  isValidIsoDate,
  MAX_YEAR,
  MIN_YEAR,
  type RangeEdge,
} from '../../../src/core/schema/dates';

describe('isValidIsoDate', () => {
  it.each(['2020', '2020-02', '2020-02-29', '2023-02-28', '1900', '2100', '2021-12-31'])('acepta %s', (value) => {
    expect(isValidIsoDate(value)).toBe(true);
  });

  it.each<[string, string]>([
    ['', 'cadena vacía'],
    ['20', 'año incompleto'],
    ['2020-1', 'mes sin cero inicial'],
    ['2020-01-1', 'día sin cero inicial'],
    ['2020/01/01', 'separador incorrecto'],
    ['2020-01-01T00:00', 'con hora'],
    [' 2020', 'espacio inicial'],
    ['1899', 'año anterior al mínimo'],
    ['2101', 'año posterior al máximo'],
    ['2020-00', 'mes 00'],
    ['2020-13', 'mes 13'],
    ['2020-13-01', 'mes 13 con día'],
    ['2020-01-00', 'día 00'],
    ['2020-01-32', 'día 32'],
    ['2023-02-29', '29 de febrero en año no bisiesto'],
    ['2020-04-31', '31 de abril'],
  ])('rechaza "%s" (%s)', (value) => {
    expect(isValidIsoDate(value)).toBe(false);
  });
});

describe('expandIsoDate', () => {
  it.each<[string, RangeEdge, string]>([
    ['2020', 'start', '2020-01-01'],
    ['2020', 'end', '2020-12-31'],
    ['2020-02', 'start', '2020-02-01'],
    ['2020-02', 'end', '2020-02-29'],
    ['2021-02', 'end', '2021-02-28'],
    ['2020-05-07', 'start', '2020-05-07'],
    ['2020-05-07', 'end', '2020-05-07'],
  ])('expande %s como %s a %s', (value, edge, expected) => {
    expect(expandIsoDate(value, edge)).toBe(expected);
  });

  it('lanza TypeError si el formato no es ISO parcial', () => {
    expect(() => expandIsoDate('ayer', 'start')).toThrow(TypeError);
  });
});

describe('isOrderedRange', () => {
  it.each<[string, string, boolean]>([
    ['2020', '2020', true],
    ['2020-06', '2020', true],
    ['2019-12-31', '2020', true],
    ['2020-06-15', '2020-06', true],
    ['2021', '2020-12', false],
    ['2020-06', '2020-05', false],
    ['2020-06-15', '2020-06-14', false],
  ])('%s → %s ordenado = %s', (start, end, expected) => {
    expect(isOrderedRange(start, end)).toBe(expected);
  });
});

describe('constantes', () => {
  it('exponen el patrón sintáctico y unos límites de año coherentes', () => {
    expect(ISO_DATE_PATTERN.test('2020-01-01')).toBe(true);
    expect(MIN_YEAR).toBeLessThan(MAX_YEAR);
  });
});
