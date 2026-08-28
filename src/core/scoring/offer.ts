/**
 * Integración con el `SelectorEngine` (`docs/scoring.md` §5.1): la oferta induce una
 * especialidad virtual y el selector se reutiliza sin cambios; con una especialidad real, esta
 * elige la versión del CV y la oferta solo puntúa.
 */
import type { JobRequirements } from '../keywords';
import type { MasterProfile, Specialty } from '../schema';
import { selectForSpecialty, type SelectionError } from '../selection';
import { scoreSelection } from './scorer';
import type { ScoredSelection, ScoringOptions } from './types';

export const OFFER_SPECIALTY_ID = 'offer';

/** Especialidad virtual: las tags evidenciadas por la oferta; titular por defecto del perfil. */
export function offerSpecialty(profile: MasterProfile, requirements: JobRequirements): Specialty {
  return {
    id: OFFER_SPECIALTY_ID,
    title: profile.personal.headline ?? profile.personal.fullName,
    tags: Object.keys(requirements.tagWeights),
  };
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
