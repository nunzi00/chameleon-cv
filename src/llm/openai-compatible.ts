/**
 * Proveedor «compatible con la API de OpenAI» en loopback (`/v1/chat/completions` con
 * `response_format: json_schema`, `/v1/models`): llama.cpp `llama-server`, LM Studio, vLLM o el
 * propio Ollama en modo compatible. Verificado en T-4.2 con `llama-server` y un modelo 7B real.
 */
import { z } from 'zod';

import { LLM_HTTP_LIMITS, loopbackOnlyHttp, type JsonHttp } from './http';
import { httpErrorToLlm, llmFailure } from './ollama';
import { DEFAULT_SEED, DEFAULT_TEMPERATURE, parseModelJson, type LlmCompletion, type LlmHealth, type LlmProvider, type LlmProviderId, type LlmRequest } from './provider';

export const OPENAI_COMPATIBLE_DEFAULT_BASE_URL = 'http://127.0.0.1:8080';
/** Los servidores de un solo modelo ignoran el nombre; «default» significa «el que sirva». */
export const OPENAI_COMPATIBLE_DEFAULT_MODEL = 'default';

const CompletionSchema = z.looseObject({
  model: z.string().optional(),
  choices: z.array(z.looseObject({ message: z.looseObject({ content: z.string().nullable() }) })).min(1),
  usage: z.looseObject({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() }).optional(),
});
const ModelsSchema = z.looseObject({ data: z.array(z.looseObject({ id: z.string() })) });

export interface OpenAiCompatibleOptions {
  readonly baseUrl?: string | undefined;
  readonly model?: string | undefined;
  readonly http?: JsonHttp | undefined;
  /** Identidad del proveedor: `openai-compatible` (local) u `openai` (remoto, T-4.5). */
  readonly id?: LlmProviderId | undefined;
  readonly kind?: 'local' | 'remote' | undefined;
  /** Cabeceras de autenticación (`Authorization: Bearer …`); nunca se registran. */
  readonly headers?: Readonly<Record<string, string>> | undefined;
  /** Suelo de tokens de salida del modelo (registro), para modelos que razonan. */
  readonly outputTokensFloor?: number | undefined;
  /** Rutas propias del dialecto (Gemini no usa el prefijo /v1); por defecto, las estándar. */
  readonly chatPath?: string | undefined;
  readonly modelsPath?: string | undefined;
}

export function createOpenAiCompatibleProvider(options: OpenAiCompatibleOptions = {}): LlmProvider {
  const baseUrl = (options.baseUrl ?? OPENAI_COMPATIBLE_DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = options.model ?? OPENAI_COMPATIBLE_DEFAULT_MODEL;
  const http = options.http ?? loopbackOnlyHttp;
  const headers = options.headers;

  return {
    id: options.id ?? 'openai-compatible',
    kind: options.kind ?? 'local',
    baseUrl,
    model,
    ...(options.outputTokensFloor === undefined ? {} : { outputTokensFloor: options.outputTokensFloor }),
    async complete(request: LlmRequest): Promise<LlmCompletion> {
      const started = Date.now();
      const result = await http({
        url: `${baseUrl}${options.chatPath ?? '/v1/chat/completions'}`,
        method: 'POST',
        headers,
        timeoutMs: request.timeoutMs,
        signal: request.signal,
        body: {
          model,
          messages: request.messages,
          temperature: request.temperature ?? DEFAULT_TEMPERATURE,
          seed: request.seed ?? DEFAULT_SEED,
          max_tokens: request.maxTokens,
          response_format: { type: 'json_schema', json_schema: { name: request.schemaName, schema: request.schema, strict: true } },
        },
      });
      if (!result.ok) {
        return llmFailure(result, 'Servidor compatible con OpenAI');
      }
      const parsed = CompletionSchema.safeParse(result.data);
      if (!parsed.success) {
        return { ok: false, code: 'invalid-response', message: 'Servidor compatible con OpenAI: respuesta con una forma inesperada (falta choices[0].message)' };
      }
      const content = parsed.data.choices[0]?.message.content ?? '';
      const json = parseModelJson(content);
      if (!json.ok) {
        return { ok: false, code: 'invalid-json', message: `Servidor compatible con OpenAI: ${json.message}` };
      }
      const usage = parsed.data.usage;
      return {
        ok: true,
        json: json.json,
        raw: content,
        model: parsed.data.model ?? model,
        usage: { ...(usage?.prompt_tokens === undefined ? {} : { promptTokens: usage.prompt_tokens }), ...(usage?.completion_tokens === undefined ? {} : { completionTokens: usage.completion_tokens }) },
        elapsedMs: Date.now() - started,
      };
    },
    async health(): Promise<LlmHealth> {
      const result = await http({ url: `${baseUrl}${options.modelsPath ?? '/v1/models'}`, method: 'GET', headers, timeoutMs: LLM_HTTP_LIMITS.healthTimeoutMs });
      if (!result.ok) {
        return { ok: false, code: httpErrorToLlm(result.code), message: `El servidor compatible con OpenAI no responde en ${baseUrl}: ${result.message}` };
      }
      const parsed = ModelsSchema.safeParse(result.data);
      if (!parsed.success) {
        return { ok: false, code: 'invalid-response', message: 'Servidor compatible con OpenAI: la lista de modelos tiene una forma inesperada' };
      }
      const models = parsed.data.data.map((entry) => entry.id);
      return { ok: true, version: undefined, models, modelAvailable: models.length > 0 && (model === OPENAI_COMPATIBLE_DEFAULT_MODEL || models.includes(model)) };
    },
  };
}
