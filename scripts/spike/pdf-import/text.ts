/**
 * Utilidades de texto del spike (T-8.4, docs/pdf-import-spike.md): normalización sin acentos ni signos y una
 * similitud de Dice sobre bigramas de caracteres (robusta a guiones de partición, espacios y mayúsculas).
 */

/** Minúsculas, sin acentos, con espacios colapsados; mantiene letras, dígitos y algunos signos útiles. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/[«»"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Solo letras y dígitos, para comparar contenido sin puntuación ni espacios. */
export function alphanumeric(text: string): string {
  return normalize(text).replace(/[^a-z0-9]/g, '');
}

function bigrams(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let index = 0; index + 1 < text.length; index += 1) {
    const pair = text.slice(index, index + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return counts;
}

/** Coeficiente de Dice sobre bigramas de la forma alfanumérica: 1 = iguales, 0 = nada en común. */
export function similarity(a: string, b: string): number {
  const left = alphanumeric(a);
  const right = alphanumeric(b);
  if (left === right) {
    return 1;
  }
  if (left.length < 2 || right.length < 2) {
    return 0;
  }
  const first = bigrams(left);
  const second = bigrams(right);
  let shared = 0;
  for (const [pair, count] of first) {
    shared += Math.min(count, second.get(pair) ?? 0);
  }
  return (2 * shared) / (left.length - 1 + right.length - 1);
}

/** `true` si el texto de la verdad aparece (normalizado) dentro del texto extraído, tolerando partición de palabras con guion. */
export function contains(haystack: string, needle: string): boolean {
  const target = alphanumeric(needle);
  return target !== '' && alphanumeric(haystack).includes(target);
}
