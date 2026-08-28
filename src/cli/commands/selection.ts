/**
 * Preparación compartida de los comandos del co-piloto (`improve`, `summarize`): la **misma
 * selección determinista** que vería el CV —especialidad, oferta (con sus términos) y límites—
 * aplicada sobre el artefacto. Los errores se imprimen aquí; el llamador solo devuelve el código.
 */
import { buildVocabulary, extractJobRequirements } from '../../core/keywords';
import type { MasterProfile } from '../../core/schema';
import { NO_SCORES, applyLimits, scoresFromReport, tailorToOffer, type ScoreLookup } from '../../core/scoring';
import { selectForSpecialty } from '../../core/selection';
import type { CliContext } from '../context';
import { hasLimits, resolveLimits, type LimitOptions } from '../limits';
import { readOfferText } from '../offer';
import { EXIT_DATA_ERROR } from '../output';

export interface SelectionOptions extends LimitOptions {
  readonly specialty?: string | undefined;
  readonly fromJobOffer?: string | undefined;
}

export interface PreparedSelection {
  /** Perfil ya seleccionado, puntuado y recortado. */
  readonly profile: MasterProfile;
  readonly offerName: string | undefined;
  readonly offerTerms: readonly string[];
}

export type PreparedResult = { readonly ok: true; readonly prepared: PreparedSelection } | { readonly ok: false; readonly exitCode: number };

export async function prepareSelection(context: CliContext, base: MasterProfile, options: SelectionOptions): Promise<PreparedResult> {
  let profile = base;
  let scoreOf: ScoreLookup = NO_SCORES;
  let offerName: string | undefined;
  let offerTerms: string[] = [];
  if (options.fromJobOffer !== undefined) {
    const offer = await readOfferText(context, options.fromJobOffer);
    if (!offer.ok) {
      context.stderr(`${offer.message}\n`);
      return { ok: false, exitCode: offer.exitCode };
    }
    const requirements = extractJobRequirements(offer.offer.text, buildVocabulary(base));
    const tailored = tailorToOffer(base, requirements, { specialtyId: options.specialty });
    if (!tailored.ok) {
      context.stderr(`${tailored.error.message}\n`);
      return { ok: false, exitCode: EXIT_DATA_ERROR };
    }
    profile = tailored.scored.profile;
    scoreOf = scoresFromReport(tailored.scored.report);
    offerName = offer.offer.name;
    offerTerms = requirements.terms.map((term) => term.term);
  } else if (options.specialty !== undefined) {
    const selection = selectForSpecialty(base, options.specialty);
    if (!selection.ok) {
      context.stderr(`${selection.error.message}\n`);
      return { ok: false, exitCode: EXIT_DATA_ERROR };
    }
    profile = selection.selection.profile;
  }
  const limits = resolveLimits(options);
  if (hasLimits(limits)) {
    profile = applyLimits(profile, limits, scoreOf).profile;
  }
  return { ok: true, prepared: { profile, offerName, offerTerms } };
}
