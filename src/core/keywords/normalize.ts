/** Normalización compartida por vocabulario y oferta: minúsculas y sin diacríticos. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

/** Una línea o un término: normalizados y con los espacios colapsados. */
export function normalizeLine(text: string): string {
  return normalizeText(text).replace(/\s+/g, ' ').trim();
}

/** Texto de entrada de una oferta: sin BOM y con finales de línea `\n`. */
export function normalizeInput(text: string): string {
  const withoutBom = text.startsWith('﻿') ? text.slice(1) : text;
  return withoutBom.replace(/\r\n?/g, '\n');
}

/** Letras y números de cualquier alfabeto: lo que delimita una palabra. */
export function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}
