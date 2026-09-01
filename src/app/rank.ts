/**
 * Comparar varias ofertas de una vez (T-9.13): el motor es el mismo `analyzeOffer` de siempre, ejecutado una vez
 * por oferta, y lo que aporta este módulo es la **agregación** —la tabla que responde «¿a cuál me presento
 * primero?»— sin inventarse ninguna métrica nueva: adecuación, imprescindibles y carencias son exactamente las
 * que ya ves al analizar una sola.
 *
 * Se ordena por imprescindibles cubiertos y después por adecuación, no al revés: una oferta con el 100 % de
 * cuatro requisitos flojos importa menos que otra con el 80 % de diez, y lo que de verdad cierra puertas es un
 * imprescindible sin cubrir.
 */
import { analyzeOffer, type AnalyzeRequest } from './analyze';
import { buildProfile, loadProfile } from './dataset';
import type { AppContext } from './context';
import type { AppError } from './errors';
import type { AppWarning } from './freshness';
import type { OfferInput } from './offer';

export interface RankedOffer {
  readonly name: string;
  /** Requisitos reconocidos y cuántos demuestra el perfil. */
  readonly recognized: number;
  readonly demonstrated: number;
  /** 0–1; `undefined` si la oferta no declara ni un requisito reconocible. */
  readonly ratio: number | undefined;
  readonly requiredTotal: number;
  readonly requiredDemonstrated: number;
  readonly gaps: readonly string[];
  /** La especialidad del perfil que más cubre esta oferta, si alguna destaca. */
  readonly suggestedSpecialty: string | undefined;
}

export interface RankFailure {
  /** Posición de la oferta en la lista que se pasó: quien llama sabe cómo la nombra su usuario. */
  readonly offer: number;
  readonly message: string;
}

/** Un aviso del análisis, con la oferta que lo provocó: comparando varias, «la oferta» no dice cuál. */
export interface RankWarning {
  readonly offer: number;
  readonly warning: AppWarning;
}

export interface RankResult {
  readonly ranked: readonly RankedOffer[];
  /** Las que no se pudieron analizar, con su motivo: una oferta rota no tumba la comparación. */
  readonly failed: readonly RankFailure[];
  readonly warnings: readonly RankWarning[];
}

export type RankOutcome = { readonly ok: true; readonly result: RankResult } | { readonly ok: false; readonly error: AppError };

/** Imprescindibles cubiertos primero, adecuación después: lo que cierra puertas es un imprescindible sin cubrir. */
function compare(a: RankedOffer, b: RankedOffer): number {
  const required = (offer: RankedOffer): number => (offer.requiredTotal === 0 ? 0 : offer.requiredDemonstrated / offer.requiredTotal);
  return required(b) - required(a) || (b.ratio ?? 0) - (a.ratio ?? 0) || b.recognized - a.recognized || a.name.localeCompare(b.name, 'es');
}

/**
 * Analiza cada oferta con el motor de siempre y devuelve la tabla ordenada. `build` solo se hace una vez: el
 * perfil no cambia entre ofertas, y recompilarlo por cada una sería trabajo tirado.
 */
export async function rankOffers(context: AppContext, request: Omit<AnalyzeRequest, 'offer'>, offers: readonly OfferInput[]): Promise<RankOutcome> {
  // El perfil se compila y se comprueba UNA vez, antes de mirar ninguna oferta: si falla, falla la comparación
  // entera y hay que decirlo una sola vez. A partir de ahí, lo que salga mal es de la oferta que lo provoca.
  if (request.build) {
    const built = await buildProfile(context, { data: request.data, out: request.profile, check: false });
    if (!built.ok) {
      return { ok: false, error: built.error };
    }
  }
  const loaded = await loadProfile(context, { profile: request.profile });
  if (!loaded.ok) {
    return { ok: false, error: loaded.error };
  }
  const ranked: RankedOffer[] = [];
  const failed: RankFailure[] = [];
  const warnings: RankWarning[] = [];
  for (const [index, offer] of offers.entries()) {
    const result = await analyzeOffer(context, { ...request, offer, build: false });
    for (const warning of result.warnings) {
      warnings.push({ offer: index, warning });
    }
    if (!result.ok) {
      failed.push({ offer: index, message: result.error.message });
      continue;
    }
    const { analysis } = result;
    ranked.push({
      name: analysis.offerName,
      recognized: analysis.summary.recognized,
      demonstrated: analysis.summary.demonstrated,
      ratio: analysis.summary.recognized === 0 ? undefined : analysis.summary.ratio,
      requiredTotal: analysis.summary.requiredTotal,
      requiredDemonstrated: analysis.summary.requiredDemonstrated,
      gaps: analysis.requirements.gaps,
      suggestedSpecialty: analysis.suggestedSpecialty?.id,
    });
  }
  return { ok: true, result: { ranked: [...ranked].sort(compare), failed, warnings } };
}
