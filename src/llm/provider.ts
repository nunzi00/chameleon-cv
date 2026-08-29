/**
 * Contrato del proveedor de modelos (T-4.2, `docs/llm-integration.md` §4.2–4.3). La aplicación
 * habla con esta interfaz; cada proveedor traduce a su API REST. Toda respuesta llega como JSON
 * ya parseado (pero **no** validado contra el esquema de la tarea: eso lo hace la tarea con zod).
 */

export interface LlmMessage {
  readonly role: 'system' | 'user';
  readonly content: string;
}

export interface LlmRequest {
  readonly messages: readonly LlmMessage[];
  /** JSON Schema de la salida esperada (derivado de zod). */
  readonly schema: Record<string, unknown>;
  readonly schemaName: string;
  readonly maxTokens: number;
  /** Por defecto 0 (canon C8). */
  readonly temperature?: number | undefined;
  readonly seed?: number | undefined;
  readonly timeoutMs?: number | undefined;
  /** Cancelación por el llamador (un trabajo de la API). */
  readonly signal?: AbortSignal | undefined;
}

export interface LlmUsage {
  readonly promptTokens?: number | undefined;
  readonly completionTokens?: number | undefined;
}

export type LlmErrorCode = 'refused' | 'unreachable' | 'timeout' | 'cancelled' | 'http' | 'invalid-response' | 'invalid-json' | 'failed';

export type LlmCompletion =
  | { readonly ok: true; readonly json: unknown; readonly raw: string; readonly model: string; readonly usage: LlmUsage; readonly elapsedMs: number }
  | { readonly ok: false; readonly code: LlmErrorCode; readonly message: string };

export type LlmHealth =
  | { readonly ok: true; readonly version: string | undefined; readonly models: readonly string[]; readonly modelAvailable: boolean }
  | { readonly ok: false; readonly code: LlmErrorCode; readonly message: string };

export type LocalProviderId = 'ollama' | 'openai-compatible';
export type LlmProviderId = LocalProviderId | 'openai' | 'anthropic';

export interface LlmProvider {
  readonly id: LlmProviderId;
  /** `local` = loopback; `remote` = https hacia la lista blanca, solo con `--provider` explícito (T-4.5). */
  readonly kind: 'local' | 'remote';
  readonly baseUrl: string;
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmCompletion>;
  health(): Promise<LlmHealth>;
}

export const DEFAULT_TEMPERATURE = 0;
export const DEFAULT_SEED = 7;

/** Interpreta el texto devuelto por el modelo como JSON (los proveedores con esquema devuelven JSON puro). */
export function parseModelJson(raw: string): { readonly ok: true; readonly json: unknown } | { readonly ok: false; readonly message: string } {
  try {
    return { ok: true, json: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, message: `el modelo no devolvió JSON válido: ${raw.slice(0, 160).trim()}` };
  }
}
