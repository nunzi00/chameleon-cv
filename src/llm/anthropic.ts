/**
 * Proveedor remoto Anthropic (Messages API, T-4.5): la salida estructurada se obtiene forzando una
 * herramienta cuyo `input_schema` es el JSON Schema de la tarea (`tool_choice` fijo), de modo que
 * el modelo devuelve el objeto ya parseado en `content[].input`. Solo https hacia la lista blanca.
 * Contrato según la documentación pública; verificado contra un doble local (sin claves en tests).
 */
import { z } from 'zod';

import { LLM_HTTP_LIMITS, type JsonHttp } from './http';
import { httpErrorToLlm } from './ollama';
import { DEFAULT_TEMPERATURE, type LlmCompletion, type LlmHealth, type LlmProvider, type LlmRequest } from './provider';

export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';
export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-4-5';
export const ANTHROPIC_VERSION = '2023-06-01';

const MessageSchema = z.looseObject({
  model: z.string().optional(),
  content: z.array(z.looseObject({ type: z.string(), name: z.string().optional(), input: z.unknown().optional(), text: z.string().optional() })),
  usage: z.looseObject({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).optional(),
});
const ModelsSchema = z.looseObject({ data: z.array(z.looseObject({ id: z.string() })) });

export interface AnthropicOptions {
  readonly apiKey: string;
  readonly http: JsonHttp;
  readonly baseUrl?: string | undefined;
  readonly model?: string | undefined;
}

export function createAnthropicProvider(options: AnthropicOptions): LlmProvider {
  const baseUrl = (options.baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = options.model ?? ANTHROPIC_DEFAULT_MODEL;
  const headers = { 'x-api-key': options.apiKey, 'anthropic-version': ANTHROPIC_VERSION };

  return {
    id: 'anthropic',
    kind: 'remote',
    baseUrl,
    model,
    async complete(request: LlmRequest): Promise<LlmCompletion> {
      const started = Date.now();
      const system = request.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
      const user = request.messages.filter((message) => message.role === 'user').map((message) => message.content).join('\n\n');
      const result = await options.http({
        url: `${baseUrl}/v1/messages`,
        method: 'POST',
        headers,
        timeoutMs: request.timeoutMs,
        signal: request.signal,
        body: {
          model,
          max_tokens: request.maxTokens,
          temperature: request.temperature ?? DEFAULT_TEMPERATURE,
          ...(system === '' ? {} : { system }),
          messages: [{ role: 'user', content: user }],
          tools: [{ name: request.schemaName, description: `Devuelve el resultado de la tarea «${request.schemaName}» con la forma exigida.`, input_schema: request.schema }],
          tool_choice: { type: 'tool', name: request.schemaName },
        },
      });
      if (!result.ok) {
        return { ok: false, code: httpErrorToLlm(result.code), message: `Anthropic: ${result.message}` };
      }
      const parsed = MessageSchema.safeParse(result.data);
      if (!parsed.success) {
        return { ok: false, code: 'invalid-response', message: 'Anthropic: respuesta con una forma inesperada (falta content[])' };
      }
      const tool = parsed.data.content.find((block) => block.type === 'tool_use' && block.name === request.schemaName);
      if (tool === undefined || tool.input === undefined) {
        return { ok: false, code: 'invalid-response', message: `Anthropic: la respuesta no contiene la herramienta «${request.schemaName}»` };
      }
      const usage = parsed.data.usage;
      return {
        ok: true,
        json: tool.input,
        raw: JSON.stringify(tool.input),
        model: parsed.data.model ?? model,
        usage: { ...(usage?.input_tokens === undefined ? {} : { promptTokens: usage.input_tokens }), ...(usage?.output_tokens === undefined ? {} : { completionTokens: usage.output_tokens }) },
        elapsedMs: Date.now() - started,
      };
    },
    async health(): Promise<LlmHealth> {
      const result = await options.http({ url: `${baseUrl}/v1/models`, method: 'GET', headers, timeoutMs: LLM_HTTP_LIMITS.healthTimeoutMs });
      if (!result.ok) {
        return { ok: false, code: httpErrorToLlm(result.code), message: `Anthropic no responde en ${baseUrl}: ${result.message}` };
      }
      const parsed = ModelsSchema.safeParse(result.data);
      if (!parsed.success) {
        return { ok: false, code: 'invalid-response', message: 'Anthropic: la lista de modelos tiene una forma inesperada' };
      }
      const models = parsed.data.data.map((entry) => entry.id);
      return { ok: true, version: undefined, models, modelAvailable: models.includes(model) };
    },
  };
}
