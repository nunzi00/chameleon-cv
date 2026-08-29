import { describe, expect, it } from 'vitest';

import { AffineMatrix, installDomMatrixPolyfill } from '../../src/pdf/dom-matrix.mts';

const values = (m: AffineMatrix): number[] => [m.a, m.b, m.c, m.d, m.e, m.f];

describe('DOMMatrix mínimo para pdf.js (T-6.2)', () => {
  it('construye identidad, desde array o desde otra matriz; multiplica, traslada y escala como DOMMatrix', () => {
    expect(values(new AffineMatrix())).toEqual([1, 0, 0, 1, 0, 0]);
    expect(new AffineMatrix().isIdentity).toBe(true);
    expect(new AffineMatrix().is2D).toBe(true);
    const m = new AffineMatrix([2, 0, 0, 3, 10, 20]);
    expect(values(new AffineMatrix(m))).toEqual([2, 0, 0, 3, 10, 20]);
    expect(values(new AffineMatrix([1, 2, 3]))).toEqual([1, 0, 0, 1, 0, 0]);
    expect(values(new AffineMatrix(Float32Array.from([1, 1, 0, 1, 5, 5])))).toEqual([1, 1, 0, 1, 5, 5]);
    expect(values(m.translate(1, 2))).toEqual([2, 0, 0, 3, 12, 26]);
    expect(values(m.translate())).toEqual([2, 0, 0, 3, 10, 20]);
    expect(values(m.scale(2))).toEqual([4, 0, 0, 6, 10, 20]);
    expect(values(m.scale(2, 1))).toEqual([4, 0, 0, 3, 10, 20]);
    expect(values(m)).toEqual([2, 0, 0, 3, 10, 20]);
    const rotation = new AffineMatrix([0, 1, -1, 0, 0, 0]);
    expect(values(rotation.multiply(m))).toEqual([0, 2, -3, 0, -20, 10]);
    expect(values(new AffineMatrix(m).preMultiplySelf(rotation))).toEqual([0, 2, -3, 0, -20, 10]);
    expect(values(new AffineMatrix(m).multiplySelf(rotation))).toEqual([0, 3, -2, 0, 10, 20]);
  });

  it('invierte (NaN si es singular), transforma puntos y exporta la matriz 4×4', () => {
    const m = new AffineMatrix([2, 0, 0, 4, 10, 20]);
    expect(values(m.inverse())).toEqual([0.5, -0, -0, 0.25, -5, -5]);
    expect(values(m.inverse().multiply(m))).toEqual([1, 0, 0, 1, 0, 0]);
    expect(values(new AffineMatrix([1, 2, 2, 4, 0, 0]).invertSelf()).every(Number.isNaN)).toBe(true);
    expect(m.transformPoint({ x: 1, y: 1 })).toEqual({ x: 12, y: 24 });
    expect(m.transformPoint()).toEqual({ x: 10, y: 20 });
    expect(Array.from(m.toFloat64Array())).toEqual([2, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1, 0, 10, 20, 0, 1]);
  });

  it('installDomMatrixPolyfill solo instala si falta', () => {
    const target: Record<string, unknown> = {};
    expect(installDomMatrixPolyfill(target)).toBe(true);
    expect(target['DOMMatrix']).toBe(AffineMatrix);
    expect(installDomMatrixPolyfill(target)).toBe(false);
    const global = globalThis as unknown as Record<string, unknown>;
    expect(installDomMatrixPolyfill()).toBe(global['DOMMatrix'] === AffineMatrix);
  });
});
