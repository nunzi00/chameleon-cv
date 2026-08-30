import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { contrastRatio, parseHex, readTokens, relativeLuminance } from './contrast';

const css = readFileSync(resolve(__dirname, '../app.css'), 'utf8');

/** Parejas texto/fondo de la interfaz (docs/gui-design-brief.md §3): AA en texto normal. */
const PAIRS: readonly (readonly [string, string])[] = [
  ['--cv-text', '--cv-surface'],
  ['--cv-text', '--cv-bg'],
  ['--cv-text', '--cv-surface-2'],
  ['--cv-muted', '--cv-surface'],
  ['--cv-accent', '--cv-surface'],
  ['--cv-accent-text', '--cv-accent'],
  ['--cv-accent', '--cv-accent-soft'],
  ['--cv-ok', '--cv-ok-soft'],
  ['--cv-warn', '--cv-warn-soft'],
  ['--cv-error', '--cv-error-soft'],
];

describe('contraste de la paleta', () => {
  it('parseHex y relativeLuminance siguen la fórmula WCAG (blanco 1, negro 0)', () => {
    expect(parseHex('#ffffff')).toEqual([255, 255, 255]);
    expect(relativeLuminance(parseHex('#ffffff'))).toBeCloseTo(1, 5);
    expect(relativeLuminance(parseHex('#000000'))).toBe(0);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 3);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 3);
    expect(() => parseHex('red')).toThrow('Color inesperado: red');
  });

  it('readTokens lee el bloque pedido y devuelve vacío si el selector no existe', () => {
    expect(readTokens(':root { --cv-a: #ABCDEF; --cv-size: 12px; }', ':root').get('--cv-a')).toBe('#abcdef');
    expect(readTokens(':root { --cv-a: #abcdef; }', '[data-theme=dark]').size).toBe(0);
  });

  it.each([
    ['claro', ':root {'],
    ['oscuro', ":root[data-theme='dark']"],
  ])('en modo %s todas las parejas documentadas dan AA (≥ 4,5:1)', (_mode, selector) => {
    const tokens = readTokens(css, selector);
    expect(tokens.size).toBeGreaterThan(10);
    const ratios = PAIRS.map(([fg, bg]) => {
      const foreground = tokens.get(fg);
      const background = tokens.get(bg);
      if (foreground === undefined || background === undefined) {
        throw new Error(`Falta el token ${fg} o ${bg} en ${selector}`);
      }
      return [fg, bg, contrastRatio(foreground, background)] as const;
    });
    for (const [fg, bg, ratio] of ratios) {
      expect(ratio, `${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
