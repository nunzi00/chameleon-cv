/**
 * Búsqueda de términos en líneas normalizadas (`docs/scoring.md` §4.5): de más largo a más corto,
 * con límites propios (el carácter anterior y posterior no puede ser alfanumérico, porque `\b`
 * no sirve con `c++`, `.net` o `node.js`) y enmascarando cada aparición para que un término más
 * corto no vuelva a contar dentro de uno más largo.
 */
import { isWordChar } from './normalize';

export interface NormalizedLine {
  readonly normalized: string;
}

export interface TermHit<L extends NormalizedLine> {
  readonly line: L;
  readonly lineIndex: number;
  readonly offset: number;
}

export interface TermHits<L extends NormalizedLine> {
  readonly first: TermHit<L>;
  readonly all: readonly TermHit<L>[];
}

export interface MatchResult<L extends NormalizedLine> {
  /** Apariciones por término, solo de los términos hallados. */
  readonly hits: ReadonlyMap<string, TermHits<L>>;
  /** Líneas normalizadas con las apariciones sustituidas por espacios. */
  readonly masked: readonly string[];
}

/** Términos ordenados de más largo a más corto y, a igual longitud, alfabéticamente. */
export function longestFirst(terms: readonly string[]): string[] {
  return [...terms].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
}

/** Índice de la primera aparición de `term` en `text` desde `from` con límites de palabra, o -1. */
export function findTerm(text: string, term: string, from = 0): number {
  let position = from;
  for (;;) {
    const start = text.indexOf(term, position);
    if (start === -1) {
      return -1;
    }
    const end = start + term.length;
    if (!isWordChar(text[start - 1]) && !isWordChar(text[end])) {
      return start;
    }
    position = start + 1;
  }
}

export function containsTerm(text: string, term: string): boolean {
  return findTerm(text, term) !== -1;
}

export function matchTerms<L extends NormalizedLine>(lines: readonly L[], terms: readonly string[]): MatchResult<L> {
  const states = lines.map((line, lineIndex) => ({ line, lineIndex, working: line.normalized }));
  const hits = new Map<string, { first: TermHit<L>; all: TermHit<L>[] }>();
  for (const term of longestFirst(terms)) {
    for (const state of states) {
      let from = 0;
      for (;;) {
        const start = findTerm(state.working, term, from);
        if (start === -1) {
          break;
        }
        const end = start + term.length;
        const hit: TermHit<L> = { line: state.line, lineIndex: state.lineIndex, offset: start };
        const existing = hits.get(term);
        if (existing === undefined) {
          hits.set(term, { first: hit, all: [hit] });
        } else {
          existing.all.push(hit);
        }
        state.working = `${state.working.slice(0, start)}${' '.repeat(term.length)}${state.working.slice(end)}`;
        from = end;
      }
    }
  }
  return { hits, masked: states.map((state) => state.working) };
}
