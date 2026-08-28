/**
 * Años de experiencia exigidos (`docs/scoring.md` §4.4): solo en líneas que hablan de experiencia,
 * tomando el mínimo de cada rango y el máximo entre menciones.
 */
const EXPERIENCE_LINE = /\bexperiencia\b|\bexperience\b/;
const RANGE = /(\d{1,2})\s*(?:-|–|a|to)\s*(\d{1,2})\s*\+?\s*(?:anos|years?|yrs)\b/g;
const SINGLE = /(\d{1,2})\s*\+?\s*(?:anos|years?|yrs)\b/g;

const MAX_PLAUSIBLE_YEARS = 40;

function numbersOf(match: RegExpMatchArray): number[] {
  return match.slice(1).map(Number);
}

/** Mínimos de años mencionados en una línea normalizada. */
export function yearsMentionedIn(line: string): number[] {
  const mentions: number[] = [];
  for (const match of line.matchAll(RANGE)) {
    mentions.push(Math.min(...numbersOf(match)));
  }
  for (const match of line.replace(RANGE, ' ').matchAll(SINGLE)) {
    mentions.push(Math.min(...numbersOf(match)));
  }
  return mentions.filter((years) => years <= MAX_PLAUSIBLE_YEARS);
}

export function extractExperienceYears(normalizedLines: readonly string[]): number | undefined {
  const mentions = normalizedLines.filter((line) => EXPERIENCE_LINE.test(line)).flatMap(yearsMentionedIn);
  return mentions.length === 0 ? undefined : Math.max(...mentions);
}
