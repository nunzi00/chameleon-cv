/**
 * `cv llm status` (T-4.2/T-4.5): proveedor local que se usaría, si responde y qué modelos sirve;
 * procedencia de las claves remotas (solo entorno/fichero/ninguna, nunca valores) y lista blanca.
 * Con `--provider <remoto>` explícito, también comprueba ese proveedor (única llamada de red aquí).
 */
import { DEFAULT_ALLOWED_HOSTS, allowedHosts, createProvider, isLocalProviderId, resolveLlmConfig, selectProvider, type ConfigSource, type LlmConfig, type SelectProviderOptions } from './config';
import type { JsonHttp } from './http';
import { KEY_ENV_VARIABLES, describeKeys, keysFilePath, type KeySource } from './keys';
import { QuotaLedger, defaultQuotaLedger, describeQuotaSnapshot, type QuotaSnapshot } from './quota';
import { REMOTE_PROVIDERS, describeQuota, type ProviderEvidence, type ProviderQuota, type RemoteProviderId } from './registry';
import type { LlmHealth } from './provider';

export type KeyPresence = KeySource | 'none' | 'insecure-file' | 'invalid-file';

export interface RemoteStatus {
  readonly id: RemoteProviderId;
  readonly baseUrl: string;
  readonly model: string;
  readonly keySource: KeySource | undefined;
  readonly health: LlmHealth;
}

export interface SettingsStatus {
  /** Ruta de `cv.toml` (exista o no). */
  readonly path: string | undefined;
  readonly present: boolean;
  /** Hay tabla `[llm]`. */
  readonly configured: boolean;
  readonly error: string | undefined;
}

/** Un proveedor remoto del registro tal como lo ven `cv llm status`, la API y «Ajustes»: nunca la clave. */
export interface RemoteProviderStatus {
  readonly id: RemoteProviderId;
  readonly plan: 'free' | 'paid';
  readonly host: string;
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly keyPresence: KeyPresence;
  readonly quota: ProviderQuota | undefined;
  readonly rateLimitsUrl: string;
  readonly c7: ProviderEvidence;
  /** Última cuota leída de las cabeceras en este proceso. */
  readonly live: QuotaSnapshot | undefined;
}

export interface LlmStatus {
  readonly config: LlmConfig | undefined;
  readonly configError: string | undefined;
  readonly health: LlmHealth | undefined;
  readonly keys: Readonly<Record<RemoteProviderId, KeyPresence>>;
  readonly keysFile: string;
  readonly allowedHosts: readonly string[];
  /** Solo con `--provider <remoto>`: resultado de comprobarlo (o el error de selección). */
  readonly remote: RemoteStatus | { readonly error: string } | undefined;
  /** Hay proveedor local válido, responde y sirve el modelo configurado. */
  readonly usable: boolean;
  /** `cv.toml` y su tabla `[llm]` (T-8.2). */
  readonly settings: SettingsStatus;
  /** Los remotos del registro con su plan, cuota publicada, evidencia C7, clave (procedencia) y cuota viva. */
  readonly providers: readonly RemoteProviderStatus[];
}

export interface LlmStatusOptions extends SelectProviderOptions {
  readonly http?: JsonHttp | undefined;
  /** Ruta de `cv.toml`, para explicarla. */
  readonly settingsPath?: string | undefined;
  readonly settingsPresent?: boolean | undefined;
  /** Libro de cuotas a consultar (por defecto, el del proceso). */
  readonly quotaLedger?: QuotaLedger | undefined;
  /** `--provider` explícito: si es remoto, se comprueba de verdad. */
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
}

export async function llmStatus(options: LlmStatusOptions = {}): Promise<LlmStatus> {
  const env = options.env ?? process.env;
  const keys = await describeKeys(options);
  const settings: SettingsStatus = { path: options.settingsPath, present: options.settingsPresent ?? false, configured: options.settings !== undefined, error: options.settingsError };
  const ledger = options.quotaLedger ?? defaultQuotaLedger;
  const providers: RemoteProviderStatus[] = REMOTE_PROVIDERS.map((entry) => ({
    id: entry.id,
    plan: entry.plan,
    host: entry.host,
    baseUrl: entry.baseUrl,
    defaultModel: entry.defaultModel,
    keyPresence: keys[entry.id],
    quota: entry.quota,
    rateLimitsUrl: entry.rateLimitsUrl,
    c7: entry.c7,
    live: ledger.get(entry.id),
  }));
  const base = { keys, keysFile: keysFilePath(env, options.platform ?? process.platform, options.home), allowedHosts: allowedHosts(env), settings, providers };
  let remote: LlmStatus['remote'];
  const requested = options.provider?.trim().toLowerCase();
  // Un `--provider` local se resuelve como configuración local (más abajo); solo un remoto (o un id desconocido) se comprueba aquí.
  if (requested !== undefined && requested !== '' && !isLocalProviderId(requested)) {
    const selected = await selectProvider({ provider: options.provider, model: options.model }, options);
    if (!selected.ok) {
      remote = { error: selected.message };
    } else {
      // Un id que no es local y se seleccionó con éxito es, por construcción, un remoto del registro.
      remote = { id: selected.provider.id as RemoteProviderId, baseUrl: selected.provider.baseUrl, model: selected.provider.model, keySource: selected.keySource, health: await selected.provider.health() };
    }
  }
  if (options.settingsError !== undefined) {
    return { ...base, config: undefined, configError: options.settingsError, health: undefined, remote, usable: false };
  }
  const localFlag = requested !== undefined && isLocalProviderId(requested) ? requested : undefined;
  // `--model` sin `--provider` (o con uno local) afecta al local; con un remoto pertenece al remoto.
  const localModel = requested === undefined || requested === '' || localFlag !== undefined ? options.model : undefined;
  const resolved = resolveLlmConfig(env, { provider: localFlag, model: localModel, settings: options.settings });
  if (!resolved.ok) {
    return { ...base, config: undefined, configError: resolved.message, health: undefined, remote, usable: false };
  }
  const health = await createProvider(resolved.config, options.http).health();
  return { ...base, config: resolved.config, configError: undefined, health, remote, usable: health.ok && health.modelAvailable };
}

const PROVIDER_LABELS = { ollama: 'Ollama', 'openai-compatible': 'servidor compatible con OpenAI' } as const;

function describeHealth(health: LlmHealth, model: string): string {
  if (!health.ok) {
    return `no disponible · ${health.message}`;
  }
  const version = health.version === undefined ? '' : ` · versión ${health.version}`;
  const models = health.models.length === 0 ? 'ningún modelo servido' : `${health.models.length} ${health.models.length === 1 ? 'modelo' : 'modelos'} (${health.models.slice(0, 6).join(', ')}${health.models.length > 6 ? ', …' : ''})`;
  return `alcanzable${version} · ${models} · ${health.modelAvailable ? 'el modelo configurado está disponible' : `el modelo configurado «${model}» no está disponible`}`;
}

function describeKey(presence: KeyPresence, variable: string): string {
  switch (presence) {
    case 'env':
      return `definida en ${variable}`;
    case 'file':
      return 'definida en el fichero de claves';
    case 'insecure-file':
      return 'fichero de claves con permisos abiertos (corrígelo con chmod 600)';
    case 'invalid-file':
      return 'fichero de claves inválido';
    case 'none':
      return 'ninguna';
  }
}

export function formatLlmStatus(status: LlmStatus): string {
  const lines: string[] = [];
  if (status.config === undefined) {
    lines.push(`Configuración inválida: ${status.configError}`);
  } else {
    const { config } = status;
    const origin = (source: ConfigSource): string => ({ flag: 'orden', env: 'entorno', file: 'cv.toml', default: 'por defecto' })[source];
    lines.push(`Proveedor local: ${config.provider} (${config.baseUrl}; ${origin(config.sources.provider)}) · modelo: ${config.model} (${origin(config.sources.model)})`);
    const health = status.health;
    if (health === undefined || !health.ok) {
      lines.push(`Estado: no disponible · ${health?.message ?? 'sin comprobar'}`);
      lines.push(`  Arranca ${PROVIDER_LABELS[config.provider]} en ${config.baseUrl} o configura CHAMELEON_LLM_PROVIDER/CHAMELEON_LLM_BASE_URL/CHAMELEON_LLM_MODEL`);
    } else {
      lines.push(`Estado: ${describeHealth(health, config.model)}`);
    }
  }
  const { settings } = status;
  if (settings.path !== undefined) {
    lines.push(`Configuración del proyecto: ${settings.path} ${settings.error !== undefined ? '(inválida)' : settings.present ? (settings.configured ? '(tabla [llm] presente)' : '(sin tabla [llm])') : '(no existe)'}`);
  }
  lines.push('Proveedores remotos (solo con --provider explícito):');
  for (const provider of status.providers) {
    const published = provider.quota === undefined ? 'límites según la cuenta' : `${describeQuota(provider.quota)} (${provider.quota.sourceUrl}, ${provider.quota.verifiedAt})`;
    const plan = provider.plan === 'free' ? `plan gratuito: ${published}` : `plan de pago (${published})`;
    lines.push(`  ${provider.id} → clave ${describeKey(status.keys[provider.id], KEY_ENV_VARIABLES[provider.id])} · ${plan} · ${provider.host} · modelo por defecto ${provider.defaultModel}`);
    if (provider.live !== undefined) {
      lines.push(`    cuota viva: ${describeQuotaSnapshot(provider.live)} (leída ${provider.live.observedAt})`);
    }
  }
  lines.push(`Fichero de claves: ${status.keysFile}`);
  lines.push(`Lista blanca de hosts: ${status.allowedHosts.join(', ')}${status.allowedHosts.length > Object.keys(DEFAULT_ALLOWED_HOSTS).length ? ' (ampliada con CHAMELEON_LLM_ALLOWED_HOSTS)' : ''}`);
  if (status.remote !== undefined) {
    if ('error' in status.remote) {
      lines.push(`Remoto: ${status.remote.error}`);
    } else {
      lines.push(`Remoto ${status.remote.id} (${status.remote.baseUrl}; modelo ${status.remote.model}; clave ${status.remote.keySource === 'env' ? 'del entorno' : 'del fichero'}): ${describeHealth(status.remote.health, status.remote.model)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
