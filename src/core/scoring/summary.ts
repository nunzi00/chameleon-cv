/**
 * Resumen de adecuación (`docs/trimming-cli.md` §4.5): base común del texto y del JSON de
 * `cv analyze-offer`. Función pura sobre el `MatchReport` y el perfil puntuado.
 */
import type { MasterProfile } from '../schema';
import type { SelectionSection } from '../selection';
import type { MatchReport, ScoredDecision } from './types';

export interface Evidence {
  readonly id: string;
  readonly section: SelectionSection;
  readonly score: number;
  /** Texto identificativo del ítem (empresa y puesto, nombre…). */
  readonly label: string;
}

export interface TermCoverage {
  readonly term: string;
  readonly emphasis: 'required' | 'desirable' | 'unknown';
  readonly occurrences: number;
  readonly weight: number;
  /** Ids de los ítems incluidos que lo demuestran (vacío = no demostrado). */
  readonly evidence: readonly string[];
}

export interface MatchSummary {
  readonly recognized: number;
  readonly demonstrated: number;
  /** `demonstrated / recognized`, o 0 si no se reconoció nada. */
  readonly ratio: number;
  readonly requiredTotal: number;
  readonly requiredDemonstrated: number;
  readonly terms: readonly TermCoverage[];
  readonly gaps: readonly string[];
  readonly experienceYears: number | undefined;
  /** Ítems de nivel superior incluidos, de mayor a menor puntuación. */
  readonly topEvidence: readonly Evidence[];
}

const LABEL_MAX_LENGTH = 60;

function shorten(text: string): string {
  return text.length > LABEL_MAX_LENGTH ? `${text.slice(0, LABEL_MAX_LENGTH - 1)}…` : text;
}

/** Etiqueta legible de un ítem de nivel superior, o `undefined` si no está en el perfil. */
export function labelFor(profile: MasterProfile, section: SelectionSection, id: string): string | undefined {
  switch (section) {
    case 'experience': {
      const item = profile.experience.find((candidate) => candidate.id === id);
      return item === undefined ? undefined : `${item.company} — ${item.role}`;
    }
    case 'projects':
      return profile.projects.find((candidate) => candidate.id === id)?.name;
    case 'education':
      return profile.education.find((candidate) => candidate.id === id)?.degree;
    case 'skills':
      return profile.skills.find((candidate) => candidate.id === id)?.name;
    case 'certifications':
      return profile.certifications.find((candidate) => candidate.id === id)?.name;
    case 'achievements': {
      const item = profile.achievements.find((candidate) => candidate.id === id);
      return item === undefined ? undefined : shorten(item.text);
    }
  }
}

/** Etiqueta legible o, si el ítem no está en el perfil, su id. */
export function labelOrId(profile: MasterProfile, section: SelectionSection, id: string): string {
  return labelFor(profile, section, id) ?? id;
}

function isDemonstrated(report: MatchReport, term: string): boolean {
  return report.decisions.some((decision) => decision.included && decision.matchedTerms.includes(term));
}

function evidenceFor(report: MatchReport, term: string): string[] {
  return report.decisions.filter((decision) => decision.included && decision.matchedTerms.includes(term)).map((decision) => decision.id);
}

function topLevelIncluded(report: MatchReport): ScoredDecision[] {
  return report.decisions.filter((decision) => decision.included && decision.parentId === undefined);
}

export function summarizeMatch(report: MatchReport, profile: MasterProfile, evidenceLimit = 5): MatchSummary {
  const { requirements } = report;
  const terms: TermCoverage[] = requirements.terms.map((term) => ({
    term: term.term,
    emphasis: term.emphasis,
    occurrences: term.occurrences,
    weight: term.weight,
    evidence: evidenceFor(report, term.term),
  }));
  const demonstrated = terms.filter((term) => term.evidence.length > 0).length;
  const required = requirements.terms.filter((term) => term.emphasis === 'required');
  const requiredDemonstrated = required.filter((term) => isDemonstrated(report, term.term)).length;
  const topEvidence: Evidence[] = topLevelIncluded(report)
    .map((decision, index) => ({ decision, index }))
    .sort((a, b) => b.decision.score - a.decision.score || a.index - b.index)
    .slice(0, evidenceLimit)
    .map(({ decision }) => ({
      id: decision.id,
      section: decision.section,
      score: decision.score,
      label: labelOrId(profile, decision.section, decision.id),
    }));
  return {
    recognized: terms.length,
    demonstrated,
    ratio: terms.length === 0 ? 0 : demonstrated / terms.length,
    requiredTotal: required.length,
    requiredDemonstrated,
    terms,
    gaps: requirements.gaps,
    experienceYears: requirements.experienceYears,
    topEvidence,
  };
}
