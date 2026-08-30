/**
 * Contraste WCAG 2.x de la paleta (T-8.6 S1): las parejas texto/fondo documentadas en app.css deben dar AA
 * (≥ 4,5:1 en texto normal) en claro y en oscuro. Se comprueba en las pruebas leyendo los tokens de la hoja.
 */
export type Rgb = readonly [number, number, number];

export function parseHex(color: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (match === null) {
    throw new Error(`Color inesperado: ${color}`);
  }
  const value = Number.parseInt(match[1] as string, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(parseHex(foreground));
  const b = relativeLuminance(parseHex(background));
  const [light, dark] = a >= b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

/** Tokens `--cv-*: #rrggbb` del primer bloque cuyo selector contiene `selector`. */
export function readTokens(css: string, selector: string): ReadonlyMap<string, string> {
  const tokens = new Map<string, string>();
  const start = css.indexOf(selector);
  if (start === -1) {
    return tokens;
  }
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  for (const match of css.slice(open, close).matchAll(/(--cv-[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    tokens.set(match[1] as string, (match[2] as string).toLowerCase());
  }
  return tokens;
}
