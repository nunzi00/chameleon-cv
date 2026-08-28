/**
 * Orquestación de `cv summarize` (T-4.4): un único ítem de revisión —el resumen— con la misma
 * cadena que `improve`: caché o proveedor → validación zod → verificador C2 (sin invención;
 * cobertura de hechos clave) → ítem del fichero de revisión.
 */
import { policyOptions, verifyProposal } from '../core/llm/verify';
import type { MasterProfile } from '../core/schema';
import { cacheKey, type LlmCacheStore } from './cache';
import { verificationVocabulary } from './improve-batch';
import type { LlmCompletion, LlmProvider } from './provider';
import type { ReviewItem, ReviewProposal } from './review';
import { SUMMARIZE_PROMPT_VERSION, interpretSummarize, runSummarize, type SummarizeFragment } from './tasks/summarize';

export const SUMMARY_ITEM_ID = 'summary';

export interface SummarizeRunOptions {
  /** Perfil completo (para el vocabulario vigilado) y fragmento ya construido sobre el perfil filtrado. */
  readonly profile: MasterProfile;
  readonly fragment: SummarizeFragment;
  readonly provider: LlmProvider;
  readonly prompt: string;
  readonly location: string;
  readonly cache?: LlmCacheStore | undefined;
  readonly timeoutMs?: number | undefined;
  readonly now?: (() => Date) | undefined;
}

function verifyAll(options: SummarizeRunOptions, proposals: ReadonlyArray<{ readonly text: string; readonly rationale: string }>): ReviewProposal[] {
  const vocabulary = verificationVocabulary(options.profile);
  return proposals.map((proposal) => ({
    text: proposal.text,
    rationale: proposal.rationale,
    verdict: verifyProposal(options.fragment.corpus, proposal.text, {
      vocabulary,
      maxLength: options.fragment.input.maxLength,
      locale: options.fragment.input.locale,
      ...policyOptions('synthesis', options.fragment.keyFacts),
    }),
  }));
}

export async function runSummarizeTask(options: SummarizeRunOptions): Promise<ReviewItem> {
  const { fragment, provider } = options;
  const original = fragment.input.currentSummary === undefined ? '(sin resumen actual)' : fragment.redaction.restore(fragment.input.currentSummary);
  const key = cacheKey({ task: 'summarize', promptVersion: SUMMARIZE_PROMPT_VERSION, provider: `${provider.id}@${provider.baseUrl}`, model: provider.model, input: fragment.input });

  const cached = options.cache === undefined ? undefined : await options.cache.get(key);
  if (cached !== undefined) {
    const completion: LlmCompletion = { ok: true, json: cached.json, raw: cached.raw, model: cached.model, usage: cached.usage, elapsedMs: 0 };
    const result = interpretSummarize(fragment, completion);
    if (result.ok) {
      return { id: SUMMARY_ITEM_ID, location: options.location, original, proposals: verifyAll(options, result.proposals), fromCache: true, elapsedMs: 0, usage: cached.usage };
    }
  }

  const result = await runSummarize(provider, fragment, options.prompt, options.timeoutMs);
  if (!result.ok) {
    return { id: SUMMARY_ITEM_ID, location: options.location, original, proposals: [], error: `${result.code}: ${result.message}`, fromCache: false, elapsedMs: 0, usage: {} };
  }
  if (options.cache !== undefined) {
    await options.cache.set(key, { createdAt: (options.now ?? (() => new Date()))().toISOString(), model: result.model, raw: result.raw, json: result.json, usage: result.usage, elapsedMs: result.elapsedMs });
  }
  return { id: SUMMARY_ITEM_ID, location: options.location, original, proposals: verifyAll(options, result.proposals), fromCache: false, elapsedMs: result.elapsedMs, usage: result.usage };
}
