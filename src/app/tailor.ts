/**
 * Selección y adaptación (`docs/selector-engine.md`, `docs/scoring.md`): la misma regla para todos los
 * clientes. `specialty` elige la versión del CV y `offer` la afina puntuando y reordenando; sin ninguna,
 * el perfil completo. Puro: sin contexto ni efectos.
 */
import { buildVocabulary, extractJobRequirements } from '../core/keywords';
import type { MasterProfile } from '../core/schema';
import { NO_SCORES, scoresFromReport, tailorToOffer, type MatchReport, type ScoreLookup, type ScoredSelection } from '../core/scoring';
import { selectForSpecialty, type SelectionReport } from '../core/selection';
import { dataError, type AppError } from './errors';
import type { OfferText } from './offer';

export type JobRequirements = ReturnType<typeof extractJobRequirements>;

export type OfferTailorOutcome =
  | { readonly ok: true; readonly scored: ScoredSelection; readonly requirements: JobRequirements }
  | { readonly ok: false; readonly error: AppError };

/** Requisitos de la oferta leídos con el vocabulario del perfil, y el perfil puntuado y reordenado. */
export function tailorWithOffer(base: MasterProfile, offer: OfferText, specialty: string | undefined): OfferTailorOutcome {
  const requirements = extractJobRequirements(offer.text, buildVocabulary(base));
  const tailored = tailorToOffer(base, requirements, { specialtyId: specialty });
  return tailored.ok ? { ok: true, scored: tailored.scored, requirements } : { ok: false, error: dataError(tailored.error.message) };
}

export interface TailorRequest {
  readonly specialty?: string | undefined;
  readonly offer?: OfferText | undefined;
}

export interface TailoredProfile {
  readonly profile: MasterProfile;
  readonly selection: SelectionReport | undefined;
  readonly match: MatchReport | undefined;
  readonly requirements: JobRequirements | undefined;
  readonly scoreOf: ScoreLookup;
  readonly offerName: string | undefined;
}

export type TailorOutcome = { readonly ok: true; readonly tailored: TailoredProfile } | { readonly ok: false; readonly error: AppError };

export function tailorProfile(base: MasterProfile, request: TailorRequest): TailorOutcome {
  if (request.offer !== undefined) {
    const tailored = tailorWithOffer(base, request.offer, request.specialty);
    if (!tailored.ok) {
      return tailored;
    }
    return {
      ok: true,
      tailored: {
        profile: tailored.scored.profile,
        selection: tailored.scored.selection.report,
        match: tailored.scored.report,
        requirements: tailored.requirements,
        scoreOf: scoresFromReport(tailored.scored.report),
        offerName: request.offer.name,
      },
    };
  }
  if (request.specialty !== undefined) {
    const selection = selectForSpecialty(base, request.specialty);
    if (!selection.ok) {
      return { ok: false, error: dataError(selection.error.message) };
    }
    return { ok: true, tailored: { profile: selection.selection.profile, selection: selection.selection.report, match: undefined, requirements: undefined, scoreOf: NO_SCORES, offerName: undefined } };
  }
  return { ok: true, tailored: { profile: base, selection: undefined, match: undefined, requirements: undefined, scoreOf: NO_SCORES, offerName: undefined } };
}
