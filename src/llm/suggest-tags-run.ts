/**
 * Orquestación de `cv suggest tags` (T-4.6): para cada fragmento, caché o proveedor → validación
 * zod → verificación del diccionario cerrado y evidencia (C10) → ítem con las etiquetas
 * aceptadas y las rechazadas. Un fallo en un ítem no aborta el lote, salvo la cuota agotada (quota-exceeded): sin reintentos (C11), el resto de la tanda se detiene y el mensaje conserva el «reintenta en Xs» del proveedor. Sin I/O de ficheros.
 */
import { formatHashtags, verifyTagSuggestions, type AcceptedTag, type RejectedTag } from '../core/llm/tags';
import { buildVocabulary } from '../core/keywords';
import type { MasterProfile } from '../core/schema';
import { cacheKey, type LlmCacheStore } from './cache';
import { locateLabel } from './improve-batch';
import type { LlmCompletion, LlmProvider, LlmUsage } from './provider';
import { SUGGEST_TAGS_PROMPT_VERSION, interpretSuggestTags, runSuggestTags, type SuggestTagsFragment } from './tasks/suggest-tags';

export interface TagSuggestionItem {
  /** Id del logro; `undefined` para un texto suelto. */
  readonly id: string | undefined;
  readonly location: string;
  readonly text: string;
  readonly currentTags: readonly string[];
  readonly accepted: readonly AcceptedTag[];
  readonly rejected: readonly RejectedTag[];
  readonly error?: string | undefined;
  readonly fromCache: boolean;
  readonly elapsedMs: number;
  readonly usage: LlmUsage;
}

export interface SuggestTagsBatchOptions {
  readonly profile: MasterProfile;
  readonly fragments: readonly SuggestTagsFragment[];
  readonly provider: LlmProvider;
  readonly prompt: string;
  readonly cache?: LlmCacheStore | undefined;
  readonly timeoutMs?: number | undefined;
  readonly progress?: ((line: string) => void) | undefined;
  readonly now?: (() => Date) | undefined;
  /** Cancelación: el lote se detiene antes del siguiente fragmento y la petición en curso se aborta. */
  readonly signal?: AbortSignal | undefined;
}

function describeEvidence(accepted: readonly AcceptedTag[]): string {
  const count = (evidence: AcceptedTag['evidence']): number => accepted.filter((tag) => tag.evidence === evidence).length;
  return `${count('literal')} literal · ${count('contexto')} por contexto · ${count('inferida')} inferida`;
}

export async function runSuggestTagsBatch(options: SuggestTagsBatchOptions): Promise<TagSuggestionItem[]> {
  const aborted = (): boolean => options.signal?.aborted === true;
  const vocabulary = buildVocabulary(options.profile);
  const items: TagSuggestionItem[] = [];
  const total = options.fragments.length;
  for (const [index, fragment] of options.fragments.entries()) {
    const id = fragment.input.id;
    const location = id === undefined ? 'texto' : locateLabel(options.profile, id);
    const label = `[${index + 1}/${total}] ${id ?? 'texto'}`;
    if (aborted()) {
      options.progress?.(`${label}: cancelado`);
      break;
    }
    const base = { id, location, text: fragment.text, currentTags: fragment.currentTags };
    const verify = (suggestions: ReadonlyArray<{ tag: string; reason: string }>): Pick<TagSuggestionItem, 'accepted' | 'rejected'> =>
      verifyTagSuggestions(suggestions, { dictionary: fragment.dictionary.tags, text: fragment.text, contextText: fragment.contextText, currentTags: fragment.currentTags, vocabulary, maxTags: fragment.input.maxTags });
    const key = cacheKey({ task: 'suggest-tags', promptVersion: SUGGEST_TAGS_PROMPT_VERSION, provider: `${options.provider.id}@${options.provider.baseUrl}`, model: options.provider.model, input: fragment.input });

    const cached = options.cache === undefined ? undefined : await options.cache.get(key);
    if (cached !== undefined) {
      const completion: LlmCompletion = { ok: true, json: cached.json, raw: cached.raw, model: cached.model, usage: cached.usage, elapsedMs: 0 };
      const result = interpretSuggestTags(fragment, completion);
      if (result.ok) {
        const verdict = verify(result.suggestions);
        items.push({ ...base, ...verdict, fromCache: true, elapsedMs: 0, usage: cached.usage });
        options.progress?.(`${label}: ${formatHashtags(verdict.accepted.map((tag) => tag.tag)) || 'ninguna etiqueta del diccionario'} · desde caché`);
        continue;
      }
    }

    const result = await runSuggestTags(options.provider, fragment, options.prompt, options.timeoutMs, options.signal);
    if (!result.ok && aborted()) {
      options.progress?.(`${label}: cancelado`);
      break;
    }
    if (!result.ok) {
      items.push({ ...base, accepted: [], rejected: [], error: `${result.code}: ${result.message}`, fromCache: false, elapsedMs: 0, usage: {} });
      if (result.code === 'quota-exceeded') {
        options.progress?.(`${label}: cuota agotada; el lote se detiene (${result.message})`);
        break;
      }
      options.progress?.(`${label}: fallo (${result.code})`);
      continue;
    }
    if (options.cache !== undefined) {
      await options.cache.set(key, { createdAt: (options.now ?? (() => new Date()))().toISOString(), model: result.model, raw: result.raw, json: result.json, usage: result.usage, elapsedMs: result.elapsedMs });
    }
    const verdict = verify(result.suggestions);
    items.push({ ...base, ...verdict, fromCache: false, elapsedMs: result.elapsedMs, usage: result.usage });
    options.progress?.(`${label}: ${formatHashtags(verdict.accepted.map((tag) => tag.tag)) || 'ninguna etiqueta del diccionario'} (${describeEvidence(verdict.accepted)}) · ${result.elapsedMs} ms`);
  }
  return items;
}

/** La línea limpia para copiar en la fuente: `#tag1 #tag2` (vacía si no hay etiquetas aceptadas). */
export function formatTagLine(item: TagSuggestionItem): string {
  return formatHashtags(item.accepted.map((tag) => tag.tag));
}

export interface TagStats {
  readonly items: number;
  readonly suggested: number;
  readonly fresh: number;
  readonly rejected: number;
  readonly failed: number;
  readonly fromCache: number;
}

export function tagStats(items: readonly TagSuggestionItem[]): TagStats {
  return {
    items: items.length,
    suggested: items.reduce((sum, item) => sum + item.accepted.length, 0),
    fresh: items.reduce((sum, item) => sum + item.accepted.filter((tag) => tag.isNew).length, 0),
    rejected: items.reduce((sum, item) => sum + item.rejected.length, 0),
    failed: items.filter((item) => item.error !== undefined).length,
    fromCache: items.filter((item) => item.fromCache).length,
  };
}
