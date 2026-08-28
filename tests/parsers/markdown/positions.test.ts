import { describe, expect, it } from 'vitest';

import { sliceSource, spanOf } from '../../../src/parsers/markdown/positions';

describe('spanOf', () => {
  it('devuelve línea y offsets de un nodo posicionado', () => {
    const node = { type: 'text', position: { start: { line: 3, column: 1, offset: 10 }, end: { line: 3, column: 5, offset: 14 } } };
    expect(spanOf(node)).toEqual({ startLine: 3, startOffset: 10, endOffset: 14 });
    expect(sliceSource('0123456789abcdefgh', node)).toBe('abcd');
  });

  it.each([
    ['sin posición', { type: 'text' }],
    ['sin offset inicial', { type: 'text', position: { start: { line: 1, column: 1 }, end: { line: 1, column: 2, offset: 1 } } }],
    ['sin offset final', { type: 'text', position: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 2 } } }],
  ])('lanza si el nodo está %s', (_label, node) => {
    expect(() => spanOf(node)).toThrow('Nodo Markdown «text» sin posición');
  });
});
