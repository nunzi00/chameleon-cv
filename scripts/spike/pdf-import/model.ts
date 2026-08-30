/**
 * P2 · Estructurador con el co-piloto local (T-8.4, docs/pdf-import-spike.md §4.2): el texto del CV va al modelo con el
 * esquema JSON del borrador (salida guiada, como las tareas del producto) y la respuesta pasa por la verificación de
 * `verify.ts`. Solo modelos locales (C3); nada del spike entra en el producto.
 */
import type { LlmProvider } from '../../../src/llm';
import type { DraftProfile } from './structure';
import { MODEL_LIMITS, ModelDraftSchema, SYSTEM_PROMPT, modelJsonSchema, verifyModelDraft, type Dropped } from './verify';

export interface ModelOutcome {
  readonly ok: true;
  readonly draft: DraftProfile;
  /** La respuesta del modelo validada por el esquema, antes de la verificación. */
  readonly raw: unknown;
  readonly dropped: Dropped;
  readonly model: string;
  readonly elapsedMs: number;
  readonly promptTokens: number | undefined;
  readonly completionTokens: number | undefined;
}

export type ModelResult = ModelOutcome | { readonly ok: false; readonly message: string; readonly elapsedMs: number };

/** Envía el texto al modelo local con el esquema y verifica la respuesta. */
export async function structureWithModel(provider: LlmProvider, text: string, seed = 7): Promise<ModelResult> {
  const started = Date.now();
  const completion = await provider.complete({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text.slice(0, MODEL_LIMITS.maxTextChars) },
    ],
    schema: modelJsonSchema(),
    schemaName: 'structure_cv',
    maxTokens: MODEL_LIMITS.maxTokens,
    temperature: 0,
    seed,
    timeoutMs: MODEL_LIMITS.timeoutMs,
  });
  const elapsedMs = Date.now() - started;
  if (!completion.ok) {
    return { ok: false, message: `${completion.code}: ${completion.message}`, elapsedMs };
  }
  const parsed = ModelDraftSchema.safeParse(completion.json);
  if (!parsed.success) {
    return { ok: false, message: `la respuesta no cumple el esquema: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).slice(0, 5).join('; ')}`, elapsedMs };
  }
  const verified = verifyModelDraft(parsed.data, text);
  return { ok: true, draft: verified.draft, raw: parsed.data, dropped: verified.dropped, model: completion.model, elapsedMs, promptTokens: completion.usage.promptTokens, completionTokens: completion.usage.completionTokens };
}
