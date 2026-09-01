/**
 * Tarea `offer map` (T-9.10, docs/scoring.md §11): el co-piloto lee una oferta y dice qué **etiquetas del
 * candidato** demuestra lo que pide, cuando la oferta lo dice con otras palabras. El análisis determinista ya
 * casa lo literal; esto tiende el puente semántico que a él se le escapa —«arquitectura orientada a eventos»
 * frente a la etiqueta `kafka`— y **no decide nada del CV**: devuelve el mismo `JobRequirements` de siempre y
 * el *scoring*, la selección y el informe siguen intactos.
 *
 * Dos guardas, verificadas por CÓDIGO y no por confianza: la etiqueta ha de estar en el vocabulario cerrado que
 * se envió, y la evidencia ha de aparecer LITERALMENTE en la oferta. Lo que no cumpla ambas se descarta y se
 * cuenta, para que el informe pueda decir cuántas propuestas se cayeron.
 */
import { z } from 'zod';

import { EmphasisSchema, normalizeLine, type Emphasis } from '../../core/keywords';
import { loadPrompt, type PromptSource } from './improve';
import type { LlmCompletion, LlmErrorCode, LlmProvider, LlmUsage } from '../provider';

export const OFFER_MAP_PROMPT_VERSION = 'offer-map.v1';
/** Límites de la tarea: la oferta recortada, el vocabulario acotado y el techo de salida. */
export const OFFER_MAP_LIMITS = { maxOfferChars: 12000, maxTags: 200, maxEvidence: 120, maxTokens: 1200 } as const;

/** Lo único que sale hacia el modelo: el texto de la oferta —que es público— y la lista de etiquetas. */
export const OfferMapInputSchema = z.strictObject({
  locale: z.string(),
  offer: z.string().min(1).max(OFFER_MAP_LIMITS.maxOfferChars),
  tags: z.array(z.string().min(1).max(80)).min(1).max(OFFER_MAP_LIMITS.maxTags),
});

/** Validación tolerante en `tag` y `emphasis`: la verificación contra el vocabulario es del código. */
export const OfferMapOutputSchema = z.strictObject({
  mappings: z
    .array(z.strictObject({ tag: z.string().min(1).max(80), emphasis: z.string().max(20).optional(), evidence: z.string().min(1).max(300) }))
    .max(OFFER_MAP_LIMITS.maxTags),
});

export type OfferMapInput = z.output<typeof OfferMapInputSchema>;

export interface OfferMapFragment {
  readonly input: OfferMapInput;
}

/** Una etiqueta del perfil que el modelo dice que la oferta pide, con el fragmento que lo demuestra. */
export interface OfferMapping {
  readonly tag: string;
  readonly emphasis: Emphasis;
  /** Fragmento literal de la oferta; verificado por código, no por confianza. */
  readonly evidence: string;
}

/** Por qué se descartó una propuesta: se cuenta por motivo para que el informe lo explique. */
export interface OfferMapRejections {
  /** La etiqueta no está en el vocabulario del perfil: el modelo se la inventó. */
  readonly unknownTag: number;
  /** La evidencia no aparece literalmente en la oferta. */
  readonly unverifiedEvidence: number;
  /** La etiqueta ya venía del análisis determinista: no aporta nada nuevo. */
  readonly alreadyKnown: number;
  /** Repetida. */
  readonly duplicate: number;
}

export type OfferMapErrorCode = LlmErrorCode | 'invalid-output';

export type OfferMapResult =
  | {
      readonly ok: true;
      readonly mappings: readonly OfferMapping[];
      readonly rejected: OfferMapRejections;
      readonly raw: string;
      readonly json: unknown;
      readonly model: string;
      readonly usage: LlmUsage;
      readonly elapsedMs: number;
      readonly promptVersion: string;
    }
  | { readonly ok: false; readonly code: OfferMapErrorCode; readonly message: string; /** Con «cuota agotada», lo que el proveedor pide esperar (T-9.16). */ readonly retryAfterSeconds?: number | undefined };

/**
 * JSON Schema para el proveedor: `tag` restringida al vocabulario enviado (`enum`). Todas las propiedades van en
 * `required`, incluida `emphasis`: la salida estructurada estricta de OpenAI y de Groq **exige** que `required`
 * liste cada clave de `properties` y, si falta una, rechaza la petición entera con un HTTP 400 (visto en vivo con
 * Groq). Que el modelo tenga que escribir siempre `emphasis` no cambia nada aquí: el código sigue admitiendo
 * cualquier valor y traduciendo lo que no reconozca a «unknown».
 */
export function offerMapJsonSchema(tags: readonly string[]): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['mappings'],
    properties: {
      mappings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['tag', 'emphasis', 'evidence'],
          properties: {
            tag: { type: 'string', enum: [...tags] },
            emphasis: { type: 'string', enum: ['required', 'desirable', 'unknown'] },
            evidence: { type: 'string' },
          },
        },
      },
    },
  };
}

/** Prepara el fragmento: recorta la oferta y el vocabulario a los límites de la tarea. */
export function offerMapFragment(offer: string, tags: readonly string[], locale = 'es'): OfferMapFragment | undefined {
  const text = offer.trim().slice(0, OFFER_MAP_LIMITS.maxOfferChars);
  const usable = [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag !== ''))].slice(0, OFFER_MAP_LIMITS.maxTags);
  if (text === '' || usable.length === 0) {
    return undefined;
  }
  return { input: OfferMapInputSchema.parse({ locale, offer: text, tags: usable }) };
}

function asEmphasis(value: string | undefined): Emphasis {
  const parsed = EmphasisSchema.safeParse(value);
  return parsed.success ? parsed.data : 'unknown';
}

/**
 * Valida la respuesta y verifica cada propuesta: la etiqueta ha de estar en el vocabulario enviado y la
 * evidencia ha de aparecer literalmente en la oferta. `known` son las etiquetas que el análisis determinista ya
 * encontró: repetirlas no aporta, así que se descartan aparte para poder decir cuántas fueron.
 */
export function interpretOfferMap(fragment: OfferMapFragment, known: ReadonlySet<string>, completion: LlmCompletion): OfferMapResult {
  if (!completion.ok) {
    // El «retry-after» del proveedor viaja con el error: sin él no se puede esperar lo que pide (T-9.16).
    return { ok: false, code: completion.code, message: completion.message, ...(completion.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: completion.retryAfterSeconds }) };
  }
  const output = OfferMapOutputSchema.safeParse(completion.json);
  if (!output.success) {
    return {
      ok: false,
      code: 'invalid-output',
      message: `La respuesta no cumple el esquema de «offer map»: ${output.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    };
  }
  const vocabulary = new Set(fragment.input.tags);
  const offer = normalizeLine(fragment.input.offer);
  const seen = new Set<string>();
  const mappings: OfferMapping[] = [];
  const rejected = { unknownTag: 0, unverifiedEvidence: 0, alreadyKnown: 0, duplicate: 0 };
  for (const mapping of output.data.mappings) {
    const tag = mapping.tag.trim();
    if (!vocabulary.has(tag)) {
      rejected.unknownTag += 1;
      continue;
    }
    if (seen.has(tag)) {
      rejected.duplicate += 1;
      continue;
    }
    if (known.has(tag)) {
      rejected.alreadyKnown += 1;
      continue;
    }
    const evidence = mapping.evidence.trim().slice(0, OFFER_MAP_LIMITS.maxEvidence);
    if (evidence === '' || !offer.includes(normalizeLine(evidence))) {
      rejected.unverifiedEvidence += 1;
      continue;
    }
    seen.add(tag);
    mappings.push({ tag, emphasis: asEmphasis(mapping.emphasis), evidence });
  }
  return {
    ok: true,
    mappings,
    rejected,
    raw: completion.raw,
    json: completion.json,
    model: completion.model,
    usage: completion.usage,
    elapsedMs: completion.elapsedMs,
    promptVersion: OFFER_MAP_PROMPT_VERSION,
  };
}

export function loadOfferMapPrompt(source?: PromptSource): Promise<string> {
  return loadPrompt(OFFER_MAP_PROMPT_VERSION, source);
}

export function offerMapMessages(fragment: OfferMapFragment, prompt: string): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    { role: 'system', content: prompt },
    { role: 'user', content: JSON.stringify(fragment.input) },
  ];
}

export async function runOfferMap(
  provider: LlmProvider,
  fragment: OfferMapFragment,
  known: ReadonlySet<string>,
  prompt: string,
  timeoutMs?: number,
  signal?: AbortSignal,
): Promise<OfferMapResult> {
  const completion = await provider.complete({
    messages: offerMapMessages(fragment, prompt),
    schema: offerMapJsonSchema(fragment.input.tags),
    schemaName: 'offer-map',
    // Modelos que razonan: el suelo del registro evita la generación vacía (hallazgo de Groq y de Gemini).
    maxTokens: Math.max(OFFER_MAP_LIMITS.maxTokens, provider.outputTokensFloor ?? 0),
    timeoutMs,
    signal,
  });
  return interpretOfferMap(fragment, known, completion);
}
