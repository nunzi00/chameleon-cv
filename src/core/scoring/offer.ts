/**
 * Integración con el `SelectorEngine` (`docs/scoring.md` §5.1): la oferta induce una
 * especialidad virtual y el selector se reutiliza sin cambios; con una especialidad real, esta
 * elige la versión del CV y la oferta solo puntúa.
 */
import type { JobRequirements } from '../keywords';
import type { MasterProfile, Specialty } from '../schema';
import { selectForSpecialty, type SelectionError } from '../selection';
import { scoreSelection } from './scorer';
import type { MatchReport, ScoredSelection, ScoringOptions } from './types';

export const OFFER_SPECIALTY_ID = 'offer';

/** Especialidad virtual: las tags evidenciadas por la oferta; titular por defecto del perfil. */
export function offerSpecialty(profile: MasterProfile, requirements: JobRequirements): Specialty {
  return {
    id: OFFER_SPECIALTY_ID,
    title: profile.personal.headline ?? profile.personal.fullName,
    tags: Object.keys(requirements.tagWeights),
  };
}

export interface SuggestedSpecialty {
  readonly id: string;
  readonly title: string;
  /** Requisitos de la oferta (tags con peso) que la especialidad cubre, y el total. */
  readonly covered: number;
  readonly total: number;
}

/**
 * La especialidad real del perfil cuyas tags más pesan entre los requisitos de la oferta (T-8.9). Sin especialidades,
 * sin requisitos, sin ninguna coincidencia o con empate en cabeza, `undefined`.
 */
export function suggestSpecialty(profile: MasterProfile, requirements: JobRequirements): SuggestedSpecialty | undefined {
  const tags = Object.keys(requirements.tagWeights);
  if (tags.length === 0) {
    return undefined;
  }
  const ranked = profile.specialties
    .map((specialty) => {
      const own = new Set(specialty.tags);
      const covered = tags.filter((tag) => own.has(tag));
      // Las tags cubiertas salen de las claves de tagWeights: siempre tienen peso.
      return { specialty, covered: covered.length, weight: covered.reduce((sum, tag) => sum + (requirements.tagWeights[tag] as number), 0) };
    })
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || b.covered - a.covered);
  const best = ranked[0];
  if (best === undefined || (ranked[1] !== undefined && ranked[1].weight === best.weight && ranked[1].covered === best.covered)) {
    return undefined;
  }
  return { id: best.specialty.id, title: best.specialty.title, covered: best.covered, total: tags.length };
}

/** Ids de los ítems incluidos que demuestran algún requisito (T-8.9: no se recortan por los límites de cantidad). */
export function evidenceIds(report: MatchReport): readonly string[] {
  return report.decisions.filter((decision) => decision.included && decision.matchedTerms.length > 0).map((decision) => decision.id);
}

export interface TailorOptions {
  /** Especialidad real que elige la versión del CV; sin ella, la virtual de la oferta. */
  readonly specialtyId?: string | undefined;
  readonly scoring?: ScoringOptions | undefined;
}

export type TailorResult =
  | { readonly ok: true; readonly scored: ScoredSelection }
  | { readonly ok: false; readonly error: SelectionError };

export function tailorToOffer(profile: MasterProfile, requirements: JobRequirements, options: TailorOptions = {}): TailorResult {
  const selection =
    options.specialtyId === undefined
      ? selectForSpecialty({ ...profile, specialties: [offerSpecialty(profile, requirements)] }, OFFER_SPECIALTY_ID)
      : selectForSpecialty(profile, options.specialtyId);
  if (!selection.ok) {
    return selection;
  }
  return { ok: true, scored: scoreSelection(selection.selection, requirements, options.scoring) };
}
