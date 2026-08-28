/**
 * Configuración y selección del proveedor (T-4.2/T-4.5, `docs/llm-integration.md` §4.3 y §5):
 * - Solo variables con prefijo `CHAMELEON_` (canon aprobado).
 * - El proveedor por defecto es **local** (loopback) y viene del entorno; un proveedor **remoto**
 *   solo se usa con `--provider <openai|anthropic>` explícito en cada orden (canon C3): nunca por
 *   configuración silenciosa.
 * - Los remotos hablan solo https con una lista blanca de hosts (por defecto, los dominios
 *   oficiales; `CHAMELEON_LLM_ALLOWED_HOSTS` la amplía) y con clave de `CHAMELEON_*_API_KEY` o del
 *   fichero de claves 0600.
 */
import { ANTHROPIC_DEFAULT_BASE_URL, ANTHROPIC_DEFAULT_MODEL, createAnthropicProvider } from './anthropic';
import { allowsHosts, createRemoteHttp, isLoopbackUrl, type JsonHttp } from './http';
import { KEY_ENV_VARIABLES, resolveApiKey, type KeyLookupOptions, type KeySource, type RemoteProviderId } from './keys';
import { OLLAMA_DEFAULT_BASE_URL, OLLAMA_DEFAULT_MODEL, createOllamaProvider } from './ollama';
import { OPENAI_COMPATIBLE_DEFAULT_BASE_URL, OPENAI_COMPATIBLE_DEFAULT_MODEL, createOpenAiCompatibleProvider } from './openai-compatible';
import type { LlmProvider, LlmProviderId, LocalProviderId } from './provider';

export const LLM_ENV = {
  provider: 'CHAMELEON_LLM_PROVIDER',
  baseUrl: 'CHAMELEON_LLM_BASE_URL',
  model: 'CHAMELEON_LLM_MODEL',
  allowedHosts: 'CHAMELEON_LLM_ALLOWED_HOSTS',
  openaiBaseUrl: 'CHAMELEON_OPENAI_BASE_URL',
  anthropicBaseUrl: 'CHAMELEON_ANTHROPIC_BASE_URL',
} as const;

/** Claves de proveedores remotos; `status` solo informa de su procedencia. */
export const REMOTE_KEY_VARIABLES = [KEY_ENV_VARIABLES.openai, KEY_ENV_VARIABLES.anthropic] as const;

export const LOCAL_PROVIDER_IDS: readonly LocalProviderId[] = ['ollama', 'openai-compatible'];
export const REMOTE_PROVIDER_IDS: readonly RemoteProviderId[] = ['openai', 'anthropic'];
export const LLM_PROVIDER_IDS: readonly LlmProviderId[] = [...LOCAL_PROVIDER_IDS, ...REMOTE_PROVIDER_IDS];

export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com';
export const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';

/** Dominios oficiales: lo único permitido si el usuario no amplía la lista. */
export const DEFAULT_ALLOWED_HOSTS: Readonly<Record<RemoteProviderId, string>> = { openai: 'api.openai.com', anthropic: 'api.anthropic.com' };

export function isLocalProviderId(value: string): value is LocalProviderId {
  return (LOCAL_PROVIDER_IDS as readonly string[]).includes(value);
}

export function isRemoteProviderId(value: string): value is RemoteProviderId {
  return (REMOTE_PROVIDER_IDS as readonly string[]).includes(value);
}

/** Lista blanca efectiva: dominios oficiales más `CHAMELEON_LLM_ALLOWED_HOSTS` (separados por comas). */
export function allowedHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env[LLM_ENV.allowedHosts] ?? '').split(',').map((host) => host.trim().toLowerCase()).filter((host) => host !== '');
  return [...new Set([...Object.values(DEFAULT_ALLOWED_HOSTS), ...extra])];
}

export interface LlmConfig {
  readonly provider: LocalProviderId;
  readonly baseUrl: string;
  readonly model: string;
  /** Qué vino del entorno y qué es valor por defecto, para explicarlo en `status`. */
  readonly sources: { readonly provider: 'env' | 'default'; readonly baseUrl: 'env' | 'default'; readonly model: 'env' | 'default' };
}

export type LlmConfigResult = { readonly ok: true; readonly config: LlmConfig } | { readonly ok: false; readonly message: string };

function localDefaults(provider: LocalProviderId): { readonly baseUrl: string; readonly model: string } {
  return provider === 'ollama' ? { baseUrl: OLLAMA_DEFAULT_BASE_URL, model: OLLAMA_DEFAULT_MODEL } : { baseUrl: OPENAI_COMPATIBLE_DEFAULT_BASE_URL, model: OPENAI_COMPATIBLE_DEFAULT_MODEL };
}

/** Configuración local desde el entorno; `providerOverride` = `--provider` con un proveedor local. */
export function resolveLlmConfig(env: NodeJS.ProcessEnv = process.env, providerOverride?: LocalProviderId): LlmConfigResult {
  const providerValue = providerOverride ?? env[LLM_ENV.provider];
  const provider = providerValue === undefined || providerValue === '' ? 'ollama' : providerValue.trim().toLowerCase();
  if (isRemoteProviderId(provider)) {
    return { ok: false, message: `${LLM_ENV.provider}=«${provider}» es un proveedor remoto: los remotos exigen --provider explícito en cada orden y nunca son el valor por defecto` };
  }
  if (!isLocalProviderId(provider)) {
    return { ok: false, message: `${LLM_ENV.provider}=«${provider}» no es un proveedor conocido (${LLM_PROVIDER_IDS.join(', ')})` };
  }
  const defaults = localDefaults(provider);
  const baseUrlValue = env[LLM_ENV.baseUrl];
  const baseUrl = baseUrlValue === undefined || baseUrlValue === '' ? defaults.baseUrl : baseUrlValue.trim();
  if (!isLoopbackUrl(baseUrl)) {
    return { ok: false, message: `${LLM_ENV.baseUrl}=«${baseUrl}» no es una dirección local (loopback): los proveedores remotos exigen --provider explícito` };
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

/* ─────────────────────────── selección explícita (T-4.5) ─────────────────────────── */

export interface ProviderSelection {
  /** `--provider`: si es remoto, es el consentimiento explícito de red de esta orden. */
  readonly provider?: string | undefined;
  /** `--model`: sobrescribe el modelo por defecto del proveedor elegido. */
  readonly model?: string | undefined;
}

export interface SelectProviderOptions extends KeyLookupOptions {
  /** Cliente local inyectable (pruebas). */
  readonly http?: JsonHttp | undefined;
  /** Constructor del cliente remoto inyectable (pruebas); por defecto https + lista blanca. */
  readonly remoteHttp?: ((allowed: readonly string[]) => JsonHttp) | undefined;
}

export type ProviderSelectionResult =
  | { readonly ok: true; readonly provider: LlmProvider; readonly keySource?: KeySource }
  | { readonly ok: false; readonly message: string };

/** URL base de un proveedor remoto: la oficial o la variable `CHAMELEON_<PROVEEDOR>_BASE_URL`, siempre dentro de la lista blanca. */
export function remoteBaseUrl(provider: RemoteProviderId, env: NodeJS.ProcessEnv): string {
  const override = env[provider === 'openai' ? LLM_ENV.openaiBaseUrl : LLM_ENV.anthropicBaseUrl];
  const fallback = provider === 'openai' ? OPENAI_DEFAULT_BASE_URL : ANTHROPIC_DEFAULT_BASE_URL;
  return (override === undefined || override.trim() === '' ? fallback : override.trim()).replace(/\/+$/, '');
}

export async function selectProvider(selection: ProviderSelection = {}, options: SelectProviderOptions = {}): Promise<ProviderSelectionResult> {
  const env = options.env ?? process.env;
  const requested = selection.provider?.trim().toLowerCase();

  if (requested === undefined || requested === '' || isLocalProviderId(requested)) {
    const config = resolveLlmConfig(env, requested === undefined || requested === '' ? undefined : requested);
    if (!config.ok) {
      return { ok: false, message: config.message };
    }
    const model = selection.model === undefined || selection.model.trim() === '' ? config.config.model : selection.model.trim();
    return { ok: true, provider: createProvider({ ...config.config, model }, options.http) };
  }
  if (!isRemoteProviderId(requested)) {
    return { ok: false, message: `--provider «${requested}» no es un proveedor conocido (${LLM_PROVIDER_IDS.join(', ')})` };
  }

  const key = await resolveApiKey(requested, options);
  if (!key.ok) {
    return { ok: false, message: key.message };
  }
  const hosts = allowedHosts(env);
  const baseUrl = remoteBaseUrl(requested, env);
  if (!allowsHosts(hosts)(`${baseUrl}/`)) {
    return { ok: false, message: `La URL base de «${requested}» (${baseUrl}) no es https o su host no está en la lista blanca (${hosts.join(', ')}); amplíala con ${LLM_ENV.allowedHosts}` };
  }
  const http = (options.remoteHttp ?? createRemoteHttp)(hosts);
  const model = selection.model === undefined || selection.model.trim() === '' ? undefined : selection.model.trim();
  const provider =
    requested === 'openai'
      ? createOpenAiCompatibleProvider({ id: 'openai', kind: 'remote', baseUrl, model: model ?? OPENAI_DEFAULT_MODEL, http, headers: { authorization: `Bearer ${key.key}` } })
      : createAnthropicProvider({ apiKey: key.key, http, baseUrl, model: model ?? ANTHROPIC_DEFAULT_MODEL });
  return { ok: true, provider, keySource: key.source };
}
