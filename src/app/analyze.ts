/**
 * Analizar una oferta contra el perfil sin generar nada (`docs/trimming-cli.md` §4.5): adecuación,
 * evidencias y carencias. `analysisPayload` es la estructura JSON que comparten `--json` y la API.
 */
import { resolve } from 'node:path';

import { type MatchSummary, type ScoredSelection, type SuggestedSpecialty, suggestSpecialty, summarizeMatch } from '../core/scoring';
import type { AppContext } from './context';
import { buildProfile, loadProfile } from './dataset';
import { dataError, type AppError } from './errors';
import { checkArtifactFreshness, freshnessWarning, type AppWarning } from './freshness';
import { lookupHistory, offerFingerprint, readHistory, recordHistory, type HistoryEntry } from './history';
import { readOffer, type OfferInput } from './offer';
import { offerRequirements, tailorWithOffer, type JobRequirements } from './tailor';
import { executeOfferMap, offerMapEstimate, planOfferMap } from './offer-map';
import type { OfferMapRejections, OfferMapping } from '../llm/tasks/offer-map';
import type { LlmProvider } from '../llm/provider';
import { outputTokensFloorFor, type CostEstimate } from '../llm';

export interface AnalyzeRequest {
  readonly profile: string;
  readonly data: string;
  readonly specialty?: string | undefined;
  readonly offer: OfferInput;
  readonly build: boolean;
  /**
   * El co-piloto como segunda fuente de requisitos (T-9.10): lee la oferta y propone etiquetas del perfil que el
   * matcher literal no vio. Sin esto, cero red y la extracción determinista de siempre.
   */
  readonly copilot?: OfferCopilotOptions | undefined;
}

/** Lo que hace falta para pedirle al co-piloto que lea la oferta; ausente = no se le pide nada. */
export interface OfferCopilotOptions {
  readonly provider: LlmProvider;
  /**
   * Consentimiento con la estimación ya calculada (C11): se pregunta DESPUÉS de planificar, porque antes no se
   * sabe cuánto se envía. Devolver `false` aborta sin llamar al proveedor. Sin esta función no se pregunta —la
   * usan la API y las pruebas, que consienten por otra vía—.
   */
  readonly consent?: ((estimate: CostEstimate) => Promise<boolean>) | undefined;
  readonly locale?: string | undefined;
  readonly progress?: ((line: string) => void) | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface OfferAnalysis {
  readonly offerName: string;
  readonly requirements: JobRequirements;
  readonly scored: ScoredSelection;
  readonly summary: MatchSummary;
  /** La especialidad real que más cubre la oferta (T-8.9), si alguna destaca. */
  readonly suggestedSpecialty: SuggestedSpecialty | undefined;
  /** Lo que aportó el co-piloto (T-9.10): ausente sin `--copilot`. Se enseña para poder juzgarlo. */
  readonly copilot?: { readonly mappings: readonly OfferMapping[]; readonly rejected: OfferMapRejections } | undefined;
}

/** Umbrales del aviso «oferta sin requisitos»: texto de sobra y casi nada reconocido. */
const REQUIREMENTS_EXPECTED_WORDS = 200;
const REQUIREMENTS_TOO_FEW = 3;

export type AnalyzeResult =
  | { readonly ok: true; readonly analysis: OfferAnalysis; readonly history: readonly HistoryEntry[]; readonly warnings: readonly AppWarning[] }
  | { readonly ok: false; readonly error: AppError; readonly warnings: readonly AppWarning[] };

export async function analyzeOffer(context: AppContext, request: AnalyzeRequest): Promise<AnalyzeResult> {
  const warnings: AppWarning[] = [];
  const artifactPath = resolve(context.cwd, request.profile);
  if (request.build) {
    const built = await buildProfile(context, { data: request.data, out: request.profile, check: false });
    if (!built.ok) {
      return { ok: false, error: built.error, warnings };
    }
  }
  const loaded = await loadProfile(context, request);
  if (!loaded.ok) {
    return { ok: false, error: loaded.error, warnings };
  }
  if (!request.build) {
    const warning = freshnessWarning(await checkArtifactFreshness(context.datasetFileSystem, artifactPath, resolve(context.cwd, request.data)));
    if (warning !== undefined) {
      warnings.push(warning);
    }
  }
  const read = await readOffer(context, request.offer);
  if (!read.ok) {
    return { ok: false, error: read.error, warnings };
  }
  const extracted = offerRequirements(loaded.profile, read.offer);
  let enriched = extracted.requirements;
  let contributed: OfferAnalysis['copilot'];
  if (request.copilot !== undefined) {
    const planned = planOfferMap(read.offer.text, extracted.requirements, extracted.vocabulary, request.copilot.locale);
    if (!planned.ok) {
      return { ok: false, error: planned.error, warnings };
    }
    if (request.copilot.consent !== undefined) {
      const estimate = await offerMapEstimate(context, planned.plan, outputTokensFloorFor(request.copilot.provider.id, request.copilot.provider.model));
      if (!(await request.copilot.consent(estimate))) {
        return { ok: false, error: dataError('Cancelado: no se envió nada al proveedor'), warnings };
      }
    }
    const mapped = await executeOfferMap(context, planned.plan, extracted.requirements, {
      provider: request.copilot.provider,
      cache: false,
      progress: request.copilot.progress,
      signal: request.copilot.signal,
    });
    if (!mapped.ok) {
      return { ok: false, error: mapped.error, warnings };
    }
    enriched = mapped.outcome.requirements;
    contributed = { mappings: mapped.outcome.mappings, rejected: mapped.outcome.rejected };
  }
  const tailored = tailorWithOffer(loaded.profile, read.offer, request.specialty, enriched);
  if (!tailored.ok) {
    return { ok: false, error: tailored.error, warnings };
  }
  const { scored, requirements } = tailored;
  const sha256 = offerFingerprint(read.offer.text);
  const history = lookupHistory(await readHistory(context), sha256);
  const failure = await recordHistory(context, { at: new Date().toISOString(), action: 'analyze', offer: { name: read.offer.name, sha256 }, specialty: request.specialty });
  if (failure !== undefined) {
    warnings.push({ kind: 'history-unwritable', message: failure });
  }
  const summary = summarizeMatch(scored.report, scored.profile);
  const words = read.offer.text.split(/\s+/).filter((word) => word !== '').length;
  // Mucho texto y casi nada reconocido: casi siempre los requisitos están en otra página. Se avisa con el enlace
  // si la oferta lo lleva, porque es lo que hay que ir a buscar.
  if (words >= REQUIREMENTS_EXPECTED_WORDS && summary.recognized <= REQUIREMENTS_TOO_FEW) {
    const link = /https?:\/\/\S+/.exec(read.offer.text.replace(/^#.*$/gm, ''))?.[0];
    warnings.push({ kind: 'offer-without-requirements', words, recognized: summary.recognized, link });
  }
  return {
    ok: true,
    analysis: { offerName: read.offer.name, requirements, scored, summary, suggestedSpecialty: suggestSpecialty(loaded.profile, requirements), copilot: contributed },
    history,
    warnings,
  };
}

/** La salida de `cv analyze-offer --json`, campo a campo en este orden (también la de POST /analyze-offer). */
export interface AnalysisPayload {
  readonly offer: { readonly source: string } & OfferAnalysis['requirements'];
  /** Procesamientos previos de la misma oferta (huella del texto), del más reciente al más antiguo. */
  readonly history: readonly HistoryEntry[];
  readonly summary: Pick<OfferAnalysis['summary'], 'recognized' | 'demonstrated' | 'ratio' | 'requiredTotal' | 'requiredDemonstrated'>;
  readonly coverage: OfferAnalysis['scored']['report']['coverage'];
  readonly decisions: OfferAnalysis['scored']['report']['decisions'];
  readonly ranking: OfferAnalysis['summary']['topEvidence'];
  readonly suggestedSpecialty: SuggestedSpecialty | undefined;
  /** Lo que aportó el co-piloto (T-9.10) con la evidencia de cada etiqueta; ausente si no se le pidió nada. */
  readonly copilot?: OfferAnalysis['copilot'];
}

export function analysisPayload(analysis: OfferAnalysis, history: readonly HistoryEntry[] = []): AnalysisPayload {
  const { summary, scored, requirements } = analysis;
  return {
    offer: { source: analysis.offerName, ...requirements },
    history,
    summary: {
      recognized: summary.recognized,
      demonstrated: summary.demonstrated,
      ratio: summary.ratio,
      requiredTotal: summary.requiredTotal,
      requiredDemonstrated: summary.requiredDemonstrated,
    },
    coverage: scored.report.coverage,
    decisions: scored.report.decisions,
    ranking: summary.topEvidence,
    suggestedSpecialty: analysis.suggestedSpecialty,
    ...(analysis.copilot === undefined ? {} : { copilot: analysis.copilot }),
  };
}
