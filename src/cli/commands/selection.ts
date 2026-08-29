/**
 * Preparación compartida de los comandos del co-piloto (`improve`, `summarize`): la **misma selección
 * determinista** que vería el CV —especialidad, oferta (con sus términos) y límites— aplicada sobre el
 * artefacto, por la capa de casos de uso. Los errores se imprimen aquí; el llamador solo devuelve el código.
 */
import { applyLimits } from '../../core/scoring';
import type { MasterProfile } from '../../core/schema';
import { tailorProfile } from '../../app/tailor';
import type { OfferText } from '../../app/offer';
import type { CliContext } from '../context';
import { hasLimits, resolveLimits, type LimitOptions } from '../limits';
import { readOfferText } from '../offer';

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
  let offer: OfferText | undefined;
  if (options.fromJobOffer !== undefined) {
    const read = await readOfferText(context, options.fromJobOffer);
    if (!read.ok) {
      context.stderr(`${read.message}\n`);
      return { ok: false, exitCode: read.exitCode };
    }
    offer = read.offer;
  }
  const tailored = tailorProfile(base, { specialty: options.specialty, offer });
  if (!tailored.ok) {
    context.stderr(`${tailored.error.message}\n`);
    return { ok: false, exitCode: tailored.error.exitCode };
  }
  const { profile, scoreOf, offerName, requirements } = tailored.tailored;
  const limits = resolveLimits(options);
  return {
    ok: true,
    prepared: {
      profile: hasLimits(limits) ? applyLimits(profile, limits, scoreOf).profile : profile,
      offerName,
      offerTerms: requirements === undefined ? [] : requirements.terms.map((term) => term.term),
    },
  };
}
