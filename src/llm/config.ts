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
import { createAnthropicProvider } from './anthropic';
import { allowsHosts, createRemoteHttp, isLoopbackUrl, type JsonHttp, type QuotaObserver } from './http';
import { KEY_ENV_VARIABLES, resolveApiKey, type KeyLookupOptions, type KeySource } from './keys';
import { QuotaLedger, defaultQuotaLedger } from './quota';
import { REMOTE_PROVIDERS, REMOTE_PROVIDER_IDS, isRemoteProviderId, registryHosts, remoteProvider, unavailableMessage, type RemoteProviderId } from './registry';
import { OLLAMA_DEFAULT_BASE_URL, OLLAMA_DEFAULT_MODEL, createOllamaProvider } from './ollama';
import { OPENAI_COMPATIBLE_DEFAULT_BASE_URL, OPENAI_COMPATIBLE_DEFAULT_MODEL, createOpenAiCompatibleProvider } from './openai-compatible';
import type { LlmProvider, LlmProviderId, LocalProviderId } from './provider';
import type { LlmSettings } from './settings';

export const LLM_ENV = {
  provider: 'CHAMELEON_LLM_PROVIDER',
  baseUrl: 'CHAMELEON_LLM_BASE_URL',
  model: 'CHAMELEON_LLM_MODEL',
  allowedHosts: 'CHAMELEON_LLM_ALLOWED_HOSTS',
  openaiBaseUrl: 'CHAMELEON_OPENAI_BASE_URL',
  anthropicBaseUrl: 'CHAMELEON_ANTHROPIC_BASE_URL',
} as const;

/** Claves de proveedores remotos; `status` solo informa de su procedencia. */
export const REMOTE_KEY_VARIABLES: readonly string[] = REMOTE_PROVIDER_IDS.map((id) => KEY_ENV_VARIABLES[id]);

export const LOCAL_PROVIDER_IDS: readonly LocalProviderId[] = ['ollama', 'openai-compatible'];
export const LLM_PROVIDER_IDS: readonly LlmProviderId[] = [...LOCAL_PROVIDER_IDS, ...REMOTE_PROVIDER_IDS];

export const OPENAI_DEFAULT_BASE_URL = remoteProvider('openai').baseUrl;
export const OPENAI_DEFAULT_MODEL = remoteProvider('openai').defaultModel;

/** Dominios oficiales: lo único permitido si el usuario no amplía la lista. */
export const DEFAULT_ALLOWED_HOSTS: Readonly<Record<RemoteProviderId, string>> = Object.fromEntries(REMOTE_PROVIDERS.map((entry) => [entry.id, entry.host])) as Record<RemoteProviderId, string>;

export function isLocalProviderId(value: string): value is LocalProviderId {
  return (LOCAL_PROVIDER_IDS as readonly string[]).includes(value);
}


/** Lista blanca efectiva: dominios oficiales más `CHAMELEON_LLM_ALLOWED_HOSTS` (separados por comas). */
export function allowedHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env[LLM_ENV.allowedHosts] ?? '').split(',').map((host) => host.trim().toLowerCase()).filter((host) => host !== '');
  return [...new Set([...registryHosts(), ...extra])];
}

export interface LlmConfig {
  readonly provider: LocalProviderId;
  readonly baseUrl: string;
  readonly model: string;
  /** Qué vino de dónde, para explicarlo en `status` y en «Ajustes». */
  readonly sources: { readonly provider: ConfigSource; readonly baseUrl: ConfigSource; readonly model: ConfigSource };
}

/** De dónde sale cada valor efectivo: la orden (`--provider`/`--model`), el entorno, `cv.toml` o el valor por defecto. */
export type ConfigSource = 'flag' | 'env' | 'file' | 'default';

/** Un valor con su origen, según la precedencia orden > entorno > `cv.toml` > defecto. */
function pick(flag: string | undefined, env: string | undefined, file: string | undefined, fallback: string): { readonly value: string; readonly source: ConfigSource } {
  const present = (value: string | undefined): value is string => value !== undefined && value.trim() !== '';
  if (present(flag)) {
    return { value: flag.trim(), source: 'flag' };
  }
  if (present(env)) {
    return { value: env.trim(), source: 'env' };
  }
  if (present(file)) {
    return { value: file.trim(), source: 'file' };
  }
  return { value: fallback, source: 'default' };
}

export type LlmConfigResult = { readonly ok: true; readonly config: LlmConfig } | { readonly ok: false; readonly message: string };

function localDefaults(provider: LocalProviderId): { readonly baseUrl: string; readonly model: string } {
  return provider === 'ollama' ? { baseUrl: OLLAMA_DEFAULT_BASE_URL, model: OLLAMA_DEFAULT_MODEL } : { baseUrl: OPENAI_COMPATIBLE_DEFAULT_BASE_URL, model: OPENAI_COMPATIBLE_DEFAULT_MODEL };
}

export interface ResolveOptions {
  /** `--provider` con un proveedor local. */
  readonly provider?: LocalProviderId | undefined;
  /** `--model`. */
  readonly model?: string | undefined;
  /** La tabla `[llm]` de `cv.toml`, si la hay. */
  readonly settings?: LlmSettings | undefined;
}

const SOURCE_LABELS: Readonly<Record<ConfigSource, string>> = { flag: '--provider', env: LLM_ENV.provider, file: 'cv.toml [llm].provider', default: 'valor por defecto' };

/** Configuración local: orden > entorno > `cv.toml` > defecto, campo a campo y con su origen. */
export function resolveLlmConfig(env: NodeJS.ProcessEnv = process.env, options: ResolveOptions | LocalProviderId = {}): LlmConfigResult {
  const resolved = typeof options === 'string' ? { provider: options } : options;
  const settings = resolved.settings;
  const chosen = pick(resolved.provider, env[LLM_ENV.provider], settings?.provider, 'ollama');
  const provider = chosen.value.toLowerCase();
  const label = SOURCE_LABELS[chosen.source];
  if (isRemoteProviderId(provider)) {
    return { ok: false, message: `${label}=«${provider}» es un proveedor remoto: los remotos exigen --provider explícito en cada orden y nunca son el valor por defecto` };
  }
  if (!isLocalProviderId(provider)) {
    return { ok: false, message: `${label}=«${provider}» no es un proveedor conocido (${LLM_PROVIDER_IDS.join(', ')})` };
  }
  const defaults = localDefaults(provider);
  const baseUrl = pick(undefined, env[LLM_ENV.baseUrl], settings?.base_url, defaults.baseUrl);
  if (!isLoopbackUrl(baseUrl.value)) {
    const origin = baseUrl.source === 'file' ? 'cv.toml [llm].base_url' : LLM_ENV.baseUrl;
    return { ok: false, message: `${origin}=«${baseUrl.value}» no es una dirección local (loopback): los proveedores remotos exigen --provider explícito` };
  }
  const model = pick(resolved.model, env[LLM_ENV.model], settings?.model, defaults.model);
  return {
    ok: true,
    config: { provider, baseUrl: baseUrl.value, model: model.value, sources: { provider: chosen.source, baseUrl: baseUrl.source, model: model.source } },
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
  /** La tabla `[llm]` de `cv.toml`, si la hay (la carga la capa de aplicación). */
  readonly settings?: LlmSettings | undefined;
  /** `cv.toml` existe pero no es válido: ninguna selección puede ignorarlo. */
  readonly settingsError?: string | undefined;
  /** Cliente local inyectable (pruebas). */
  readonly http?: JsonHttp | undefined;
  /** Constructor del cliente remoto inyectable (pruebas); por defecto https + lista blanca, con observador de cuota. */
  readonly remoteHttp?: ((allowed: readonly string[], fetchImpl?: typeof fetch, observe?: QuotaObserver) => JsonHttp) | undefined;
  /** Libro de cuotas donde anotar las cabeceras de cada respuesta remota (por defecto, el del proceso). */
  readonly quotaLedger?: QuotaLedger | undefined;
  readonly now?: (() => Date) | undefined;
}

export type ProviderSelectionResult =
  | { readonly ok: true; readonly provider: LlmProvider; readonly keySource?: KeySource }
  | { readonly ok: false; readonly message: string };

/** URL base de un proveedor remoto: la del registro o la variable `CHAMELEON_<PROVEEDOR>_BASE_URL`, siempre dentro de la lista blanca. */
export function remoteBaseUrl(provider: RemoteProviderId, env: NodeJS.ProcessEnv): string {
  const entry = remoteProvider(provider);
  const override = env[entry.baseUrlEnv];
  const fallback = entry.baseUrl;
  return (override === undefined || override.trim() === '' ? fallback : override.trim()).replace(/\/+$/, '');
}

export async function selectProvider(selection: ProviderSelection = {}, options: SelectProviderOptions = {}): Promise<ProviderSelectionResult> {
  const env = options.env ?? process.env;
  if (options.settingsError !== undefined) {
    return { ok: false, message: options.settingsError };
  }
  const requested = selection.provider?.trim().toLowerCase();

  if (requested === undefined || requested === '' || isLocalProviderId(requested)) {
    const config = resolveLlmConfig(env, { provider: requested === undefined || requested === '' ? undefined : requested, model: selection.model, settings: options.settings });
    if (!config.ok) {
      return { ok: false, message: config.message };
    }
    return { ok: true, provider: createProvider(config.config, options.http) };
  }
  if (!isRemoteProviderId(requested)) {
    return { ok: false, message: `--provider «${requested}» no es un proveedor conocido (${LLM_PROVIDER_IDS.join(', ')})` };
  }
  const entry = remoteProvider(requested);
  if (entry.availability !== 'available') {
    return { ok: false, message: unavailableMessage(entry) };
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
  const ledger = options.quotaLedger ?? defaultQuotaLedger;
  const observe: QuotaObserver = (headers) => {
    ledger.record(requested, headers, options.now?.() ?? new Date());
  };
  const http = (options.remoteHttp ?? createRemoteHttp)(hosts, undefined, observe);
  const flagModel = selection.model === undefined || selection.model.trim() === '' ? undefined : selection.model.trim();
  const model = flagModel ?? options.settings?.models?.[requested] ?? entry.defaultModel;
  const provider =
    entry.api === 'anthropic-messages'
      ? createAnthropicProvider({ apiKey: key.key, http, baseUrl, model })
      : createOpenAiCompatibleProvider({ id: entry.id, kind: 'remote', baseUrl, model, http, headers: { authorization: `Bearer ${key.key}` } });
  return { ok: true, provider, keySource: key.source };
}
