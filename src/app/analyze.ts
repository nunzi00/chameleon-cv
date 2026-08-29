/**
 * Analizar una oferta contra el perfil sin generar nada (`docs/trimming-cli.md` §4.5): adecuación,
 * evidencias y carencias. `analysisPayload` es la estructura JSON que comparten `--json` y la API.
 */
import { resolve } from 'node:path';

import { summarizeMatch, type MatchSummary, type ScoredSelection } from '../core/scoring';
import type { AppContext } from './context';
import { buildProfile, loadProfile } from './dataset';
import type { AppError } from './errors';
import { checkArtifactFreshness, freshnessWarning, type AppWarning } from './freshness';
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
}

export type AnalyzeResult =
  | { readonly ok: true; readonly analysis: OfferAnalysis; readonly warnings: readonly AppWarning[] }
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
  return { ok: true, analysis: { offerName: read.offer.name, requirements, scored, summary: summarizeMatch(scored.report, scored.profile) }, warnings };
}

/** La salida de `cv analyze-offer --json`, campo a campo en este orden. */
export function analysisPayload(analysis: OfferAnalysis): Record<string, unknown> {
  const { summary, scored, requirements } = analysis;
  return {
    offer: { source: analysis.offerName, ...requirements },
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
  };
}
