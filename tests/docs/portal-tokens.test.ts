/**
 * Tokens del portal (T-8.6 S4, docs/gui-design/pantallas.md §8): los colores de website/.vitepress/theme/custom.css
 * cumplen AA (≥ 4,5:1 para texto normal) en claro y en oscuro, la tipografía es la del sistema y el tema no carga
 * la fuente descargada de VitePress. Solo lee ficheros.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const THEME = join(__dirname, '../../website/.vitepress/theme');
const css = readFileSync(join(THEME, 'custom.css'), 'utf8');

/** Los tokens `--nombre: #rrggbb;` de un bloque (`:root` o `.dark`). */
function tokens(block: string): Record<string, string> {
  const start = css.indexOf(`${block} {`);
  const end = css.indexOf('\n}', start);
  return Object.fromEntries(Array.from(css.slice(start, end).matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)).map((match) => [match[1]!, match[2]!.toLowerCase()]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}

const PAIRS: readonly [string, string][] = [
  ['vp-c-text-1', 'vp-c-bg'],
  ['vp-c-text-1', 'vp-c-bg-soft'],
  ['vp-c-text-2', 'vp-c-bg'],
  ['vp-c-text-2', 'vp-c-bg-soft'],
  ['vp-c-brand-1', 'vp-c-bg'],
  ['vp-c-brand-1', 'vp-c-bg-soft'],
  ['vp-c-tip-1', 'vp-c-tip-soft'],
  ['vp-c-warning-1', 'vp-c-warning-soft'],
  ['vp-c-danger-1', 'vp-c-danger-soft'],
  ['cv-ok', 'vp-c-bg-soft'],
  ['cv-error', 'vp-c-bg-soft'],
];

describe('tokens del portal (T-8.6 S4)', () => {
  it('claro y oscuro cumplen AA en texto, marca, avisos y marcas de la portada', () => {
    for (const block of [':root', '.dark']) {
      const palette = tokens(block);
      for (const [fg, bg] of PAIRS) {
        expect(palette[fg], `${block} ${fg}`).toBeDefined();
        expect(palette[bg], `${block} ${bg}`).toBeDefined();
        expect(contrast(palette[fg]!, palette[bg]!), `${block}: ${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('mapea la paleta del sistema visual (marca #1f4e79 / #6ea8d8, fondos y separadores de pantallas.md §8) y usa fuentes del sistema', () => {
    expect(tokens(':root')).toMatchObject({ 'vp-c-brand-1': '#1f4e79', 'vp-c-brand-2': '#2a6399', 'vp-c-brand-3': '#16405f', 'vp-c-bg': '#f4f6f8', 'vp-c-bg-soft': '#ffffff', 'vp-c-divider': '#dfe4ea' });
    expect(tokens('.dark')).toMatchObject({ 'vp-c-brand-1': '#6ea8d8', 'vp-c-brand-2': '#5c95c7', 'vp-c-brand-3': '#8dbde5', 'vp-c-bg': '#0f1216', 'vp-c-bg-soft': '#161a20', 'vp-c-divider': '#2a313b' });
    expect(css).toMatch(/--vp-font-family-base:\s*system-ui/);
    expect(css).not.toMatch(/@import|url\(https?:/);
    const entry = readFileSync(join(THEME, 'index.ts'), 'utf8');
    expect(entry).toContain("from 'vitepress/theme-without-fonts'");
    expect(entry).not.toMatch(/from 'vitepress\/theme'/);
  });
});
