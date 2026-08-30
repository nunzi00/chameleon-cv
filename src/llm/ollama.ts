/**
 * Proveedor Ollama nativo (`/api/chat` con `format: <JSON Schema>`, `/api/tags`, `/api/version`).
 * Contrato según la documentación pública de Ollama; verificado contra un doble local en tests
 * y pendiente de verificación con un Ollama real cuando esté disponible (véase el informe de T-4.2).
 */
import { z } from 'zod';

import { LLM_HTTP_LIMITS, loopbackOnlyHttp, type JsonHttp, type JsonHttpErrorCode, type JsonHttpResult } from './http';
import { parseDuration } from './quota';
import { thinkingOf } from './registry';
import { DEFAULT_SEED, DEFAULT_TEMPERATURE, parseModelJson, type LlmCompletion, type LlmErrorCode, type LlmHealth, type LlmProvider, type LlmRequest } from './provider';

export const OLLAMA_DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
/** Defecto desde T-8.11/T-8.13 (docs/qwen3-evaluation.md §4): 16/16 en el arnés de IA y reescrituras que superan la verificación C2. */
export const OLLAMA_DEFAULT_MODEL = 'qwen3:8b';
/**
 * Ventana de contexto (`options.num_ctx`) pedida en cada petición: sin ella Ollama carga el modelo con su
 * defecto (4096) y los prompts largos (propuestas con fuentes) fallan con HTTP 400 `exceed_context_size_error`.
 */
export const OLLAMA_DEFAULT_CONTEXT = 16384;

const ChatResponseSchema = z.looseObject({
  model: z.string(),
  message: z.looseObject({ content: z.string() }),
  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional(),
});
const TagsSchema = z.looseObject({ models: z.array(z.looseObject({ name: z.string(), size: z.number().optional() })) });
const VersionSchema = z.looseObject({ version: z.string() });

/** Modelos que razonan (catálogo o familia, T-8.13): Qwen3 y gpt-oss lo conmutan con `think`; los DeepSeek-R1 razonan siempre. */
export function isThinkingModel(model: string): boolean {
  return thinkingOf(model) !== 'none';
}

/**
 * El parámetro `think` de `/api/chat`: solo para los modelos que lo conmutan (apagado salvo `[llm] think = true`,
 * T-8.13 D3); los que razonan siempre no lo admiten y su bloque se descarta con `stripThinking`.
 */
export function thinkParameter(model: string, think: boolean | undefined): { readonly think?: boolean } {
  return thinkingOf(model) === 'switchable' ? { think: think === true } : {};
}

/** Quita un bloque `<think>…</think>` residual (o abierto) antes del JSON; el resto se devuelve intacto. */
export function stripThinking(content: string): string {
  return content.replace(/^\s*<think>[\s\S]*?(?:<\/think>|$)/i, '').trimStart();
}

export interface OllamaOptions {
  readonly baseUrl?: string | undefined;
  readonly model?: string | undefined;
  readonly http?: JsonHttp | undefined;
  /** `[llm] think` (T-8.13): pedir razonamiento a los modelos que lo conmutan. */
  readonly think?: boolean | undefined;
  /** `[llm] context`: ventana de contexto (`num_ctx`); por defecto `OLLAMA_DEFAULT_CONTEXT`. */
  readonly contextLength?: number | undefined;
}

export function httpErrorToLlm(code: JsonHttpErrorCode): LlmErrorCode {
  return code === 'too-large' ? 'invalid-response' : code;
}

type HttpFailure = Extract<JsonHttpResult, { ok: false }>;
type LlmFailure = Extract<LlmCompletion, { ok: false }>;

/** Un fallo HTTP como fallo del proveedor; un 429 es `quota-exceeded` con el `retry-after` si lo hay (C11: sin reintentos). */
export function llmFailure(result: HttpFailure, prefix: string): LlmFailure {
  if (result.status === 429) {
    const retryAfter = result.headers?.['retry-after'];
    const retryAfterSeconds = retryAfter === undefined ? undefined : parseDuration(retryAfter);
    const wait = retryAfterSeconds === undefined ? '' : ` (el proveedor pide esperar ${retryAfterSeconds} s)`;
    return { ok: false, code: 'quota-exceeded', message: `${prefix}: cuota agotada, HTTP 429${wait}; no se reintenta`, retryAfterSeconds };
  }
  return { ok: false, code: httpErrorToLlm(result.code), message: `${prefix}: ${result.message}` };
}

/** `qwen2.5:7b-instruct` y `qwen2.5:7b-instruct:latest` son el mismo modelo para Ollama. */
export function modelListed(model: string, names: readonly string[]): boolean {
  return names.includes(model) || names.includes(`${model}:latest`) || (model.endsWith(':latest') && names.includes(model.slice(0, -':latest'.length)));
}

export function createOllamaProvider(options: OllamaOptions = {}): LlmProvider {
  const baseUrl = (options.baseUrl ?? OLLAMA_DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = options.model ?? OLLAMA_DEFAULT_MODEL;
  const http = options.http ?? loopbackOnlyHttp;

  return {
    id: 'ollama',
    kind: 'local',
    baseUrl,
    model,
    async complete(request: LlmRequest): Promise<LlmCompletion> {
      const started = Date.now();
      const result = await http({
        url: `${baseUrl}/api/chat`,
        method: 'POST',
        timeoutMs: request.timeoutMs,
        signal: request.signal,
        body: {
          model,
          messages: request.messages,
          stream: false,
          format: request.schema,
          // Qwen3 y gpt-oss razonan por defecto y romperían el JSON estricto (T-8.11): apagado salvo que se pida (T-8.13).
          // Con esquema, NUNCA: el razonamiento consume todo `num_predict` y el content llega vacío (reproducido el
          // 30-ago-2026 con qwen3:8b y think=true: 20/20 propuestas con `invalid-json`). El conmutador queda para
          // futuras tareas sin esquema estricto.
          ...thinkParameter(model, options.think === true && request.schema === undefined),
          options: { temperature: request.temperature ?? DEFAULT_TEMPERATURE, seed: request.seed ?? DEFAULT_SEED, num_predict: request.maxTokens, num_ctx: options.contextLength ?? OLLAMA_DEFAULT_CONTEXT },
        },
      });
      if (!result.ok) {
        return llmFailure(result, 'Ollama');
      }
      const parsed = ChatResponseSchema.safeParse(result.data);
      if (!parsed.success) {
        return { ok: false, code: 'invalid-response', message: 'Ollama: respuesta con una forma inesperada (falta model o message.content)' };
      }
      const json = parseModelJson(stripThinking(parsed.data.message.content));
      if (!json.ok) {
        return { ok: false, code: 'invalid-json', message: `Ollama: ${json.message}` };
      }
      return {
        ok: true,
        json: json.json,
        raw: parsed.data.message.content,
        model: parsed.data.model,
        usage: { ...(parsed.data.prompt_eval_count === undefined ? {} : { promptTokens: parsed.data.prompt_eval_count }), ...(parsed.data.eval_count === undefined ? {} : { completionTokens: parsed.data.eval_count }) },
        elapsedMs: Date.now() - started,
      };
    },
    async health(): Promise<LlmHealth> {
      const version = await http({ url: `${baseUrl}/api/version`, method: 'GET', timeoutMs: LLM_HTTP_LIMITS.healthTimeoutMs });
      if (!version.ok) {
        return { ok: false, code: httpErrorToLlm(version.code), message: `Ollama no responde en ${baseUrl}: ${version.message}` };
      }
      const tags = await http({ url: `${baseUrl}/api/tags`, method: 'GET', timeoutMs: LLM_HTTP_LIMITS.healthTimeoutMs });
      if (!tags.ok) {
        return { ok: false, code: httpErrorToLlm(tags.code), message: `Ollama: no se pudo listar los modelos: ${tags.message}` };
      }
      const list = TagsSchema.safeParse(tags.data);
      if (!list.success) {
        return { ok: false, code: 'invalid-response', message: 'Ollama: la lista de modelos tiene una forma inesperada' };
      }
      const names = list.data.models.map((entry) => entry.name);
      const sizes = Object.fromEntries(list.data.models.flatMap((entry) => (entry.size === undefined ? [] : [[entry.name, entry.size]])));
      const parsedVersion = VersionSchema.safeParse(version.data);
      return { ok: true, version: parsedVersion.success ? parsedVersion.data.version : undefined, models: names, modelAvailable: modelListed(model, names), sizes };
    },
  };
}
