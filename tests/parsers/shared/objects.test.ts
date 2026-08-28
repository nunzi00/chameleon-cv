import { describe, expect, it } from 'vitest';

import { isPlainObject, stripEmptyValues } from '../../../src/parsers/shared/objects';

describe('isPlainObject', () => {
  it('distingue objetos planos de arrays, null y primitivos', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject('x')).toBe(false);
  });
});

describe('stripEmptyValues', () => {
  it('elimina las cadenas vacías en objetos y arrays, recursivamente, y deja el resto intacto', () => {
    expect(stripEmptyValues({ a: '', b: 'x', c: { d: '', e: ['', 'y'] }, f: [] })).toEqual({ b: 'x', c: { e: ['y'] }, f: [] });
    expect(stripEmptyValues('texto')).toBe('texto');
    expect(stripEmptyValues(['', ''])).toEqual([]);
  });
});
