/**
 * Énfasis por secciones (`docs/scoring.md` §4.3). Una línea de tipo encabezado que contiene un
 * patrón abre una sección; una línea normal que contiene un patrón toma ese énfasis solo para
 * sí misma («Experiencia con Kafka es un plus»).
 */
import { containsTerm } from './matcher';
import { normalizeLine } from './normalize';
import type { Emphasis } from './types';

export interface ClassifiedLine {
  readonly index: number;
  readonly original: string;
  readonly normalized: string;
  readonly emphasis: Emphasis;
}

export const REQUIRED_PATTERNS: readonly string[] = [
  'requisitos',
  'imprescindible',
  'se requiere',
  'necesitamos',
  'must have',
  'must-have',
  'requirements',
  'required',
  'what you need',
];

export const DESIRABLE_PATTERNS: readonly string[] = [
  'deseable',
  'valorable',
  'se valorara',
  'plus',
  'bonus',
  'nice to have',
  'nice-to-have',
  'good to have',
];

const HEADING_MAX_LENGTH = 60;
const HEADING_MAX_WORDS = 3;

const EMPHASIS_RANK: Readonly<Record<Emphasis, number>> = { required: 2, unknown: 1, desirable: 0 };

function containsAny(line: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => containsTerm(line, pattern));
}

/** Encabezado: corto y, además, terminado en «:» o de tres palabras como mucho. */
export function isHeadingLike(normalized: string): boolean {
  return normalized.length <= HEADING_MAX_LENGTH && (normalized.endsWith(':') || normalized.split(' ').length <= HEADING_MAX_WORDS);
}

/** El énfasis más fuerte: `required` > `unknown` > `desirable`. */
export function strongestEmphasis(candidates: readonly Emphasis[]): Emphasis {
  return candidates.reduce<Emphasis>((best, candidate) => (EMPHASIS_RANK[candidate] > EMPHASIS_RANK[best] ? candidate : best), 'desirable');
}

export function classifyLines(text: string): ClassifiedLine[] {
  let current: Emphasis = 'unknown';
  return text.split('\n').map((original, index) => {
    const normalized = normalizeLine(original);
    const marked: Emphasis | undefined = containsAny(normalized, REQUIRED_PATTERNS)
      ? 'required'
      : containsAny(normalized, DESIRABLE_PATTERNS)
        ? 'desirable'
        : undefined;
    if (marked !== undefined && isHeadingLike(normalized)) {
      current = marked;
    }
    return { index, original, normalized, emphasis: marked ?? current };
  });
}
