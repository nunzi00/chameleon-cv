/**
 * Puntuación contra una oferta (T-2.2, `docs/scoring.md` §5.2–5.4): aditiva y transparente.
 * Reordena solo logros y skills; el resto conserva su orden (el renderer lo hará cronológico).
 */
import type { JobRequirements } from '../keywords';
import type { Achievement, MasterProfile, Skill } from '../schema';
import type { Selection } from '../selection';
import type { MatchReport, ScoredDecision, ScoredSelection, ScoringOptions } from './types';

interface Tagged {
  readonly id: string;
  readonly tags: readonly string[];
}

interface ItemScore {
  readonly score: number;
  readonly terms: readonly string[];
}

/** Suma de los pesos de las tags del ítem presentes en la oferta. */
export function itemScore(tags: readonly string[], tagWeights: Readonly<Record<string, number>>): number {
  return tags.reduce((sum, tag) => sum + (tagWeights[tag] ?? 0), 0);
}

/** Términos de la oferta cuyas tags intersecan las del ítem, en el orden de la oferta. */
export function matchedTerms(tags: readonly string[], requirements: JobRequirements): string[] {
  return requirements.terms.filter((term) => term.tags.some((tag) => tags.includes(tag))).map((term) => term.term);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function byScoreDescending<T>(items: ReadonlyArray<{ readonly item: T; readonly score: number }>): T[] {
  return [...items].sort((a, b) => b.score - a.score).map(({ item }) => item);
}

export function scoreSelection(selection: Selection, requirements: JobRequirements, options: ScoringOptions = {}): ScoredSelection {
  const decimals = options.decimals ?? 2;
  const { tagWeights } = requirements;
  const { profile } = selection;
  const scores = new Map<string, ItemScore>();

  /** Puntúa un ítem: la puntuación exacta se usa para sumar y ordenar; la redondeada, para el informe. */
  const scoreFlat = <T extends Tagged>(item: T): { item: T; score: number } => {
    const score = itemScore(item.tags, tagWeights);
    scores.set(item.id, { score: round(score, decimals), terms: matchedTerms(item.tags, requirements) });
    return { item, score };
  };
  const scoreContainer = <T extends Tagged & { readonly achievements: readonly Achievement[] }>(container: T): T => {
    const achievements = container.achievements.map(scoreFlat);
    const total = itemScore(container.tags, tagWeights) + achievements.reduce((sum, { score }) => sum + score, 0);
    scores.set(container.id, { score: round(total, decimals), terms: matchedTerms(container.tags, requirements) });
    return { ...container, achievements: byScoreDescending(achievements) };
  };

  const experience = profile.experience.map(scoreContainer);
  const projects = profile.projects.map(scoreContainer);
  const education = profile.education.map((item) => scoreFlat(item).item);
  const skills = byScoreDescending<Skill>(profile.skills.map(scoreFlat));
  const certifications = profile.certifications.map((item) => scoreFlat(item).item);
  const achievements = byScoreDescending<Achievement>(profile.achievements.map(scoreFlat));

  const decisions: ScoredDecision[] = selection.report.decisions.map((decision) => {
    const scored = scores.get(decision.id);
    return scored === undefined
      ? { ...decision, score: 0, matchedTerms: [] }
      : { ...decision, score: scored.score, matchedTerms: scored.terms };
  });

  const coverage: Record<string, readonly string[]> = {};
  for (const term of requirements.terms) {
    coverage[term.term] = decisions.filter((decision) => decision.included && decision.matchedTerms.includes(term.term)).map((decision) => decision.id);
  }

  const scoredProfile: MasterProfile = { ...profile, experience, projects, education, skills, certifications, achievements };
  const report: MatchReport = { requirements, decisions, coverage };
  return { selection, profile: scoredProfile, report };
}
