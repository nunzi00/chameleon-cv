/**
 * Normalización compartida por vocabulario y oferta: minúsculas, sin diacríticos y con los separadores de un
 * término compuesto unificados. Lo último importa más de lo que parece: una oferta escribe «CI/CD» y un perfil
 * etiqueta `ci-cd`, y sin unificarlos el requisito se daba por NO cubierto teniéndolo (medido el 1-sep-2026 con
 * ofertas reales). La sustitución es de IGUAL LONGITUD a propósito: el informe cita la evidencia por
 * desplazamiento dentro de la línea, y quitar caracteres la descolocaría.
 *
 * Solo `/` y `_`, y solo entre alfanuméricos: el punto se deja porque separa versiones («8.3») y frases, y el
 * «·» porque en este proyecto separa campos distintos («Rol · Empresa»), no partes de un mismo término.
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/(?<=[\p{L}\p{N}])[/_](?=[\p{L}\p{N}])/gu, '-');
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
