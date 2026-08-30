/**
 * Tarea `suggest tags` (T-4.6): etiquetas de un logro (o de un texto suelto) elegidas de un
 * **diccionario cerrado** —las tags de las especialidades del perfil—. El fragmento lleva el
 * texto seudonimizado (C4), su contexto inmediato, las tags actuales y el diccionario; el
 * JSON Schema que recibe el proveedor restringe `tag` a ese diccionario (`enum`) y, además, el
 * código verifica cada etiqueta (`src/core/llm/tags.ts`, canon C10) sin confiar en el modelo.
 */
import { z } from 'zod';

import { createRedaction, type Redaction } from '../../core/llm/redact';
import type { ClosedDictionary, TagSuggestion } from '../../core/llm/tags';
import type { MasterProfile } from '../../core/schema';
import type { LlmCompletion, LlmErrorCode, LlmProvider, LlmUsage } from '../provider';
import { loadPrompt, locateAchievement, type PromptSource } from './improve';

export const SUGGEST_TAGS_PROMPT_VERSION = 'suggest-tags.v1';
export const SUGGEST_TAGS_LIMITS = { maxTags: 5, maxTagsCeiling: 10, maxText: 600, maxTokens: 400 } as const;

export const SuggestTagsContextSchema = z.strictObject({
  role: z.string().optional(),
  company: z.string().optional(),
  technologies: z.array(z.string()),
});

/** Lo único que sale hacia el modelo: por construcción no hay email, teléfono, ubicación ni enlaces. */
export const SuggestTagsInputSchema = z.strictObject({
  id: z.string().optional(),
  text: z.string().min(1).max(SUGGEST_TAGS_LIMITS.maxText),
  currentTags: z.array(z.string()),
  locale: z.string(),
  maxTags: z.int().min(1).max(SUGGEST_TAGS_LIMITS.maxTagsCeiling),
  context: SuggestTagsContextSchema,
  specialties: z.array(z.strictObject({ id: z.string(), title: z.string(), tags: z.array(z.string()) })).min(1),
  dictionary: z.array(z.string()).min(1),
});

/** Validación de la respuesta: tolerante en `tag` (grafía libre) porque la verificación por etiqueta es del código. */
export const SuggestTagsOutputSchema = z.strictObject({
  suggestions: z.array(z.strictObject({ tag: z.string().min(1).max(60), reason: z.string().max(200) })).max(20),
});

export type SuggestTagsInput = z.output<typeof SuggestTagsInputSchema>;
export type SuggestTagsOutput = z.output<typeof SuggestTagsOutputSchema>;

/** JSON Schema para el proveedor: la misma forma con `tag` restringida al diccionario (`enum`). */
export function suggestTagsJsonSchema(dictionary: readonly string[]): Record<string, unknown> {
  const strict = z.strictObject({
    suggestions: z.array(z.strictObject({ tag: z.enum(dictionary as [string, ...string[]]), reason: z.string().max(200) })).max(20),
  });
  return z.toJSONSchema(strict) as Record<string, unknown>;
}

export interface TagTarget {
  /** Logro del perfil (por id) o texto suelto; con texto, `currentTags` son sus `#hashtags` finales. */
  readonly id?: string | undefined;
  readonly text?: string | undefined;
  readonly currentTags?: readonly string[] | undefined;
}

export interface SuggestTagsFragmentOptions {
  readonly locale?: string | undefined;
  readonly maxTags?: number | undefined;
  readonly redactCompanies?: boolean | undefined;
}

export interface SuggestTagsFragment {
  readonly input: SuggestTagsInput;
  readonly redaction: Redaction;
  /** Texto original (sin seudonimizar) y contexto contra los que se calcula la evidencia. */
  readonly text: string;
  readonly contextText: string;
  readonly currentTags: readonly string[];
  readonly dictionary: ClosedDictionary;
}

/** Fragmento seudonimizado de un logro o de un texto; `undefined` si el id no existe o no hay texto. */
export function buildSuggestTagsFragment(profile: MasterProfile, target: TagTarget, dictionary: ClosedDictionary, options: SuggestTagsFragmentOptions = {}): SuggestTagsFragment | undefined {
  const located = target.id === undefined ? undefined : locateAchievement(profile, target.id);
  if (target.id !== undefined && located === undefined) {
    return undefined;
  }
  const text = located === undefined ? (target.text ?? '').trim() : located.achievement.text;
  if (text === '') {
    return undefined;
  }
  const currentTags = located === undefined ? [...(target.currentTags ?? [])] : [...located.achievement.tags];
  const redaction = createRedaction({
    fullName: profile.personal.fullName,
    companies: options.redactCompanies === true && located?.company !== undefined ? [located.company] : [],
  });
  const contextParts = located === undefined ? [] : [located.role, ...located.technologies, ...located.containerTags].filter((part): part is string => part !== undefined);
  const input = SuggestTagsInputSchema.parse({
    ...(target.id === undefined ? {} : { id: target.id }),
    text: redaction.redact(text),
    currentTags,
    locale: options.locale ?? profile.meta.locale ?? 'es',
    maxTags: options.maxTags ?? SUGGEST_TAGS_LIMITS.maxTags,
    context: {
      ...(located?.role === undefined ? {} : { role: redaction.redact(located.role) }),
      ...(located?.company === undefined ? {} : { company: redaction.redact(located.company) }),
      technologies: (located?.technologies ?? []).map((technology) => redaction.redact(technology)),
    },
    specialties: dictionary.specialties.map((specialty) => ({ id: specialty.id, title: redaction.redact(specialty.title), tags: [...specialty.tags] })),
    dictionary: [...dictionary.tags],
  });
  return { input, redaction, text, contextText: contextParts.join(' · '), currentTags, dictionary };
}

export function loadSuggestTagsPrompt(source?: PromptSource): Promise<string> {
  return loadPrompt(SUGGEST_TAGS_PROMPT_VERSION, source);
}

export type SuggestTagsErrorCode = LlmErrorCode | 'invalid-output';

export type SuggestTagsResult =
  | {
      readonly ok: true;
      readonly suggestions: readonly TagSuggestion[];
      readonly raw: string;
      readonly json: unknown;
      readonly model: string;
      readonly usage: LlmUsage;
      readonly elapsedMs: number;
      readonly promptVersion: string;
    }
  | { readonly ok: false; readonly code: SuggestTagsErrorCode; readonly message: string };

/** Valida una respuesta (del proveedor o de la caché) y deshace los seudónimos en las justificaciones. */
export function interpretSuggestTags(fragment: SuggestTagsFragment, completion: LlmCompletion): SuggestTagsResult {
  if (!completion.ok) {
    return { ok: false, code: completion.code, message: completion.message };
  }
  const output = SuggestTagsOutputSchema.safeParse(completion.json);
  if (!output.success) {
    return { ok: false, code: 'invalid-output', message: `La respuesta no cumple el esquema de «suggest tags»: ${output.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}` };
  }
  return {
    ok: true,
    suggestions: output.data.suggestions.map((suggestion) => ({ tag: suggestion.tag, reason: fragment.redaction.restore(suggestion.reason) })),
    raw: completion.raw,
    json: completion.json,
    model: completion.model,
    usage: completion.usage,
    elapsedMs: completion.elapsedMs,
    promptVersion: SUGGEST_TAGS_PROMPT_VERSION,
  };
}

export function suggestTagsMessages(fragment: SuggestTagsFragment, prompt: string): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    { role: 'system', content: prompt },
    { role: 'user', content: JSON.stringify(fragment.input) },
  ];
}

/** Envía el fragmento al proveedor (con el diccionario como `enum` del esquema) e interpreta la respuesta. */
export async function runSuggestTags(provider: LlmProvider, fragment: SuggestTagsFragment, prompt: string, timeoutMs?: number, signal?: AbortSignal): Promise<SuggestTagsResult> {
  const completion = await provider.complete({
    messages: suggestTagsMessages(fragment, prompt),
    schema: suggestTagsJsonSchema(fragment.input.dictionary),
    schemaName: 'suggest-tags',
    // Modelos que razonan (p. ej. gpt-oss en Groq): el suelo del registro evita la generación vacía.
    maxTokens: Math.max(SUGGEST_TAGS_LIMITS.maxTokens, provider.outputTokensFloor ?? 0),
    timeoutMs,
    signal,
  });
  return interpretSuggestTags(fragment, completion);
}
