/**
 * Configuración del proveedor (T-4.2, `docs/llm-integration.md` §4.3 y §5): solo variables con
 * prefijo `CHAMELEON_` (canon aprobado), proveedor local por defecto y URL base obligatoriamente
 * en loopback: un proveedor remoto requiere `--provider` explícito y llega con T-4.5.
 */
import { isLoopbackUrl, type JsonHttp } from './http';
import { OLLAMA_DEFAULT_BASE_URL, OLLAMA_DEFAULT_MODEL, createOllamaProvider } from './ollama';
import { OPENAI_COMPATIBLE_DEFAULT_BASE_URL, OPENAI_COMPATIBLE_DEFAULT_MODEL, createOpenAiCompatibleProvider } from './openai-compatible';
import type { LlmProvider, LlmProviderId } from './provider';

export const LLM_ENV = {
  provider: 'CHAMELEON_LLM_PROVIDER',
  baseUrl: 'CHAMELEON_LLM_BASE_URL',
  model: 'CHAMELEON_LLM_MODEL',
} as const;

/** Claves de proveedores remotos (T-4.5); `status` solo informa de si están definidas. */
export const REMOTE_KEY_VARIABLES = ['CHAMELEON_OPENAI_API_KEY', 'CHAMELEON_ANTHROPIC_API_KEY'] as const;

export const LLM_PROVIDER_IDS: readonly LlmProviderId[] = ['ollama', 'openai-compatible'];

export interface LlmConfig {
  readonly provider: LlmProviderId;
  readonly baseUrl: string;
  readonly model: string;
  /** Qué vino del entorno y qué es valor por defecto, para explicarlo en `status`. */
  readonly sources: { readonly provider: 'env' | 'default'; readonly baseUrl: 'env' | 'default'; readonly model: 'env' | 'default' };
}

export type LlmConfigResult = { readonly ok: true; readonly config: LlmConfig } | { readonly ok: false; readonly message: string };

function isProviderId(value: string): value is LlmProviderId {
  return (LLM_PROVIDER_IDS as readonly string[]).includes(value);
}

export function resolveLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfigResult {
  const providerValue = env[LLM_ENV.provider];
  const provider = providerValue === undefined || providerValue === '' ? 'ollama' : providerValue.trim().toLowerCase();
  if (!isProviderId(provider)) {
    return { ok: false, message: `${LLM_ENV.provider}=«${provider}» no es un proveedor conocido (${LLM_PROVIDER_IDS.join(', ')})` };
  }
  const defaults = provider === 'ollama' ? { baseUrl: OLLAMA_DEFAULT_BASE_URL, model: OLLAMA_DEFAULT_MODEL } : { baseUrl: OPENAI_COMPATIBLE_DEFAULT_BASE_URL, model: OPENAI_COMPATIBLE_DEFAULT_MODEL };
  const baseUrlValue = env[LLM_ENV.baseUrl];
  const baseUrl = baseUrlValue === undefined || baseUrlValue === '' ? defaults.baseUrl : baseUrlValue.trim();
  if (!isLoopbackUrl(baseUrl)) {
    return { ok: false, message: `${LLM_ENV.baseUrl}=«${baseUrl}» no es una dirección local (loopback): los proveedores remotos exigen --provider explícito y llegan en T-4.5` };
  }
  const modelValue = env[LLM_ENV.model];
  const model = modelValue === undefined || modelValue === '' ? defaults.model : modelValue.trim();
  return {
    ok: true,
    config: {
      provider,
      baseUrl,
      model,
      sources: {
        provider: providerValue === undefined || providerValue === '' ? 'default' : 'env',
        baseUrl: baseUrlValue === undefined || baseUrlValue === '' ? 'default' : 'env',
        model: modelValue === undefined || modelValue === '' ? 'default' : 'env',
      },
    },
  };
}

export function createProvider(config: LlmConfig, http?: JsonHttp): LlmProvider {
  return config.provider === 'ollama'
    ? createOllamaProvider({ baseUrl: config.baseUrl, model: config.model, http })
    : createOpenAiCompatibleProvider({ baseUrl: config.baseUrl, model: config.model, http });
}

/** Nombres de las variables de clave remota definidas (nunca sus valores). */
export function definedRemoteKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  return REMOTE_KEY_VARIABLES.filter((name) => env[name] !== undefined && env[name] !== '');
}
