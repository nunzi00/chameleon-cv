/**
 * El co-piloto como segunda fuente de `JobRequirements` (T-9.10, docs/scoring.md §11): plan, estimación y
 * ejecución de la tarea `offer map`. Lo que devuelve se FUNDE con lo que el análisis determinista ya encontró,
 * nunca lo sustituye: el modelo solo puede AÑADIR etiquetas que el matcher no vio, y con el peso de una
 * evidencia única —jamás por encima de lo que la oferta dice literalmente—.
 *
 * El modelo no decide el CV. Devuelve el mismo `JobRequirements` de siempre y, a partir de ahí, la selección, la
 * puntuación y el informe son los de toda la vida.
 */
import { DEFAULT_EXTRACTION_OPTIONS, type Emphasis, type JobRequirements, type Vocabulary } from '../core/keywords';
import { estimateBatch, type CostEstimate } from '../llm';
import { OFFER_MAP_LIMITS, loadOfferMapPrompt, offerMapFragment, offerMapMessages, runOfferMap, type OfferMapFragment, type OfferMapRejections, type OfferMapping } from '../llm/tasks/offer-map';
import type { AppContext } from './context';
import type { ExecuteOptions } from './copilot';
import { dataError, environmentError, type AppError } from './errors';

export interface OfferMapPlan {
  readonly fragment: OfferMapFragment;
  /** Etiquetas que el análisis determinista ya encontró: proponerlas otra vez no aporta. */
  readonly known: ReadonlySet<string>;
  /** Etiquetas del perfil que se envían como vocabulario cerrado. */
  readonly tags: readonly string[];
}

export type OfferMapPlanOutcome = { readonly ok: true; readonly plan: OfferMapPlan } | { readonly ok: false; readonly error: AppError };

/** Las etiquetas del perfil, que es lo único del candidato que sale hacia el modelo (C4: lo mínimo). */
export function profileTags(vocabulary: Vocabulary): string[] {
  const tags = new Set<string>();
  for (const set of vocabulary.values()) {
    for (const tag of set) {
      tags.add(tag);
    }
  }
  return [...tags].sort();
}

export function planOfferMap(offerText: string, requirements: JobRequirements, vocabulary: Vocabulary, locale = 'es'): OfferMapPlanOutcome {
  const tags = profileTags(vocabulary);
  const fragment = offerMapFragment(offerText, tags, locale);
  if (fragment === undefined) {
    return { ok: false, error: dataError('No hay nada que refinar: la oferta está vacía o el perfil no tiene etiquetas') };
  }
  return { ok: true, plan: { fragment, known: new Set(Object.keys(requirements.tagWeights)), tags } };
}

export async function offerMapEstimate(context: AppContext, plan: OfferMapPlan, outputTokensFloor = 0): Promise<CostEstimate> {
  const prompt = await loadOfferMapPrompt(context.assets);
  return estimateBatch([offerMapMessages(plan.fragment, prompt)], Math.max(OFFER_MAP_LIMITS.maxTokens, outputTokensFloor));
}

export interface OfferMapOutcome {
  readonly requirements: JobRequirements;
  readonly mappings: readonly OfferMapping[];
  readonly rejected: OfferMapRejections;
}

export type OfferMapResultOutcome = { readonly ok: true; readonly outcome: OfferMapOutcome } | { readonly ok: false; readonly error: AppError };

/**
 * Funde las propuestas verificadas en los requisitos. El peso es el de una evidencia ÚNICA sin refuerzo por
 * frecuencia: el modelo aporta que el requisito existe, no cuántas veces lo repite la oferta, y así una
 * propuesta suya nunca pesa más que un término que la oferta nombra tres veces.
 */
export function mergeOfferMap(requirements: JobRequirements, mappings: readonly OfferMapping[]): JobRequirements {
  const weightOf = (emphasis: Emphasis): number =>
    emphasis === 'required' ? DEFAULT_EXTRACTION_OPTIONS.requiredWeight : emphasis === 'desirable' ? DEFAULT_EXTRACTION_OPTIONS.desirableWeight : DEFAULT_EXTRACTION_OPTIONS.unknownWeight;
  const tagWeights = { ...requirements.tagWeights };
  const terms = [...requirements.terms];
  for (const mapping of mappings) {
    const weight = weightOf(mapping.emphasis);
    terms.push({ term: mapping.evidence.toLowerCase(), tags: [mapping.tag], occurrences: 1, emphasis: mapping.emphasis, weight, contexts: [mapping.evidence], source: 'copiloto' });
    tagWeights[mapping.tag] = Math.max(tagWeights[mapping.tag] ?? 0, weight);
  }
  terms.sort((a, b) => b.weight - a.weight);
  // Una etiqueta que el co-piloto evidencia deja de ser una carencia.
  const gaps = requirements.gaps.filter((gap) => !mappings.some((mapping) => mapping.tag === gap));
  return { ...requirements, terms, tagWeights, gaps };
}

/** Envía la oferta y el vocabulario, verifica cada propuesta y devuelve los requisitos ya fundidos. */
export async function executeOfferMap(context: AppContext, plan: OfferMapPlan, requirements: JobRequirements, options: ExecuteOptions): Promise<OfferMapResultOutcome> {
  const prompt = await loadOfferMapPrompt(context.assets);
  options.progress?.(`Enviando la oferta y ${plan.tags.length} etiquetas del perfil a ${options.provider.id} (${options.provider.model})`);
  const mapped = await runOfferMap(options.provider, plan.fragment, plan.known, prompt, undefined, options.signal);
  if (!mapped.ok) {
    return { ok: false, error: mapped.code === 'invalid-output' ? dataError(mapped.message) : environmentError(mapped.message) };
  }
  const descartadas = mapped.rejected.unknownTag + mapped.rejected.unverifiedEvidence + mapped.rejected.alreadyKnown + mapped.rejected.duplicate;
  options.progress?.(`${mapped.mappings.length} etiqueta(s) verificadas${descartadas === 0 ? '' : `, ${descartadas} descartada(s) por el código`}`);
  return { ok: true, outcome: { requirements: mergeOfferMap(requirements, mapped.mappings), mappings: mapped.mappings, rejected: mapped.rejected } };
}
