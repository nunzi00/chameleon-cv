/**
 * Orquestación de `cv improve` (T-4.3): para cada logro, fragmento seudonimizado → caché o
 * proveedor → validación zod → verificador C2 → ítem del fichero de revisión. Un fallo en un
 * logro no aborta el lote. Sin I/O de ficheros: el comando decide dónde escribir.
 */
import { policyOptions, verifyProposal, type Verdict } from '../core/llm/verify';
import { DEFAULT_DICTIONARY, buildVocabulary } from '../core/keywords';
import type { MasterProfile } from '../core/schema';
import { cacheKey, type LlmCacheStore } from './cache';
import { DEFAULT_SEED, DEFAULT_TEMPERATURE, type LlmCompletion, type LlmProvider } from './provider';
import type { ReviewItem, ReviewProposal } from './review';
import { IMPROVE_PROMPT_VERSION, buildImproveFragment, interpretImprove, runImprove, type FragmentOptions, type ImproveFragment } from './tasks/improve';

export interface ImproveBatchOptions {
  readonly profile: MasterProfile;
  readonly ids: readonly string[];
  readonly provider: LlmProvider;
  readonly prompt: string;
  readonly fragment: FragmentOptions;
  readonly cache?: LlmCacheStore | undefined;
  readonly timeoutMs?: number | undefined;
  readonly progress?: ((line: string) => void) | undefined;
  readonly now?: (() => Date) | undefined;
  /** Cancelación: el lote se detiene antes del siguiente logro y la petición en curso se aborta. */
  readonly signal?: AbortSignal | undefined;
}

/** Términos vigilados por el verificador: el perfil es el diccionario (tags, skills, alias, tecnologías) más el diccionario base. */
export function verificationVocabulary(profile: MasterProfile): Set<string> {
  const terms = new Set<string>(buildVocabulary(profile).keys());
  for (const container of [...profile.experience, ...profile.projects]) {
    for (const technology of container.technologies) {
      terms.add(technology);
    }
  }
  for (const term of DEFAULT_DICTIONARY) {
    terms.add(term);
  }
  return terms;
}

/** Dónde vive un logro, para el fichero de revisión. */
export function locateLabel(profile: MasterProfile, id: string): string {
  for (const item of profile.experience) {
    if (item.achievements.some((achievement) => achievement.id === id)) {
      return `${item.role} · ${item.company}`;
    }
  }
  for (const item of profile.projects) {
    if (item.achievements.some((achievement) => achievement.id === id)) {
      return `Proyecto ${item.name}`;
    }
  }
  return 'Logros transversales';
}

function verifyAll(fragment: ImproveFragment, proposals: ReadonlyArray<{ readonly text: string; readonly rationale: string }>, vocabulary: Set<string>): ReviewProposal[] {
  const original = fragment.redaction.restore(fragment.input.text);
  const allowed = [fragment.input.impact, fragment.input.context.role, fragment.input.context.company].filter((value): value is string => value !== undefined).map((value) => fragment.redaction.restore(value));
  return proposals.map((proposal) => {
    const verdict: Verdict = verifyProposal(original, proposal.text, { allowed, vocabulary, maxLength: fragment.input.maxLength, locale: fragment.input.locale, ...policyOptions('strict') });
    return { text: proposal.text, rationale: proposal.rationale, verdict };
  });
}

export async function runImproveBatch(options: ImproveBatchOptions): Promise<ReviewItem[]> {
  const vocabulary = verificationVocabulary(options.profile);
  const items: ReviewItem[] = [];
  const total = options.ids.length;
  for (const [index, id] of options.ids.entries()) {
    const label = `[${index + 1}/${total}] ${id}`;
    if (options.signal?.aborted === true) {
      options.progress?.(`${label}: cancelado`);
      break;
    }
    const fragment = buildImproveFragment(options.profile, id, options.fragment);
    if (fragment === undefined) {
      items.push({ id, location: 'desconocido', original: '', proposals: [], error: `no existe el logro «${id}»`, fromCache: false, elapsedMs: 0, usage: {} });
      options.progress?.(`${label}: no existe`);
      continue;
    }
    const original = fragment.redaction.restore(fragment.input.text);
    const impact = fragment.input.impact === undefined ? undefined : fragment.redaction.restore(fragment.input.impact);
    const location = locateLabel(options.profile, id);
    const key = cacheKey({ task: 'improve', promptVersion: IMPROVE_PROMPT_VERSION, provider: `${options.provider.id}@${options.provider.baseUrl}`, model: options.provider.model, input: fragment.input });

    const cached = options.cache === undefined ? undefined : await options.cache.get(key);
    if (cached !== undefined) {
      const completion: LlmCompletion = { ok: true, json: cached.json, raw: cached.raw, model: cached.model, usage: cached.usage, elapsedMs: 0 };
      const result = interpretImprove(fragment, completion);
      if (result.ok) {
        items.push({ id, location, original, impact, proposals: verifyAll(fragment, result.proposals, vocabulary), fromCache: true, elapsedMs: 0, usage: cached.usage });
        options.progress?.(`${label}: desde caché`);
        continue;
      }
    }

    const result = await runImprove(options.provider, fragment, options.prompt, options.timeoutMs, options.signal);
    if (!result.ok) {
      items.push({ id, location, original, impact, proposals: [], error: `${result.code}: ${result.message}`, fromCache: false, elapsedMs: 0, usage: {} });
      options.progress?.(`${label}: fallo (${result.code})`);
      continue;
    }
    if (options.cache !== undefined) {
      await options.cache.set(key, { createdAt: (options.now ?? (() => new Date()))().toISOString(), model: result.model, raw: result.raw, json: result.json, usage: result.usage, elapsedMs: result.elapsedMs });
    }
    const proposals = verifyAll(fragment, result.proposals, vocabulary);
    items.push({ id, location, original, impact, proposals, fromCache: false, elapsedMs: result.elapsedMs, usage: result.usage });
    options.progress?.(`${label}: ${proposals.filter((proposal) => proposal.verdict.accepted).length}/${proposals.length} aceptadas · ${result.elapsedMs} ms`);
  }
  return items;
}

export const IMPROVE_SAMPLING = { temperature: DEFAULT_TEMPERATURE, seed: DEFAULT_SEED } as const;
