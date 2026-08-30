/**
 * Analizar una oferta contra el perfil sin generar nada (`docs/trimming-cli.md` §4.5): adecuación,
 * evidencias y carencias. `analysisPayload` es la estructura JSON que comparten `--json` y la API.
 */
import { resolve } from 'node:path';

import { type MatchSummary, type ScoredSelection, type SuggestedSpecialty, suggestSpecialty, summarizeMatch } from '../core/scoring';
import type { AppContext } from './context';
import { buildProfile, loadProfile } from './dataset';
import type { AppError } from './errors';
import { checkArtifactFreshness, freshnessWarning, type AppWarning } from './freshness';
import { lookupHistory, offerFingerprint, readHistory, recordHistory, type HistoryEntry } from './history';
import { readOffer, type OfferInput } from './offer';
import { tailorWithOffer, type JobRequirements } from './tailor';

export interface AnalyzeRequest {
  readonly profile: string;
  readonly data: string;
  readonly specialty?: string | undefined;
  readonly offer: OfferInput;
  readonly build: boolean;
}

export interface OfferAnalysis {
  readonly offerName: string;
  readonly requirements: JobRequirements;
  readonly scored: ScoredSelection;
  readonly summary: MatchSummary;
  /** La especialidad real que más cubre la oferta (T-8.9), si alguna destaca. */
  readonly suggestedSpecialty: SuggestedSpecialty | undefined;
}

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
  const tailored = tailorWithOffer(loaded.profile, read.offer, request.specialty);
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
  return {
    ok: true,
    analysis: { offerName: read.offer.name, requirements, scored, summary: summarizeMatch(scored.report, scored.profile), suggestedSpecialty: suggestSpecialty(loaded.profile, requirements) },
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
  };
}
