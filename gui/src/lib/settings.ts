/**
 * La pantalla «Ajustes» sin DOM (docs/copilot-settings.md §4.6): qué editar de `cv.toml`, qué está fijado por
 * el entorno, cómo validar antes de guardar y cómo describir cada proveedor del registro (plan, cuota
 * publicada y viva, clave). Nunca ve claves: solo su procedencia.
 */
import type { LlmCheckResponse, LlmConfigResponse, LlmSettingsWriteRequest, RuntimeState } from './api/types';
import { plural } from './format';

type Llm = LlmConfigResponse['llm'];
export type ProviderStatus = Llm['providers'][number];
export type ConfigSource = 'flag' | 'env' | 'file' | 'default';
export type LocalProvider = 'ollama' | 'openai-compatible';

export const LOCAL_PROVIDERS: readonly { readonly id: LocalProvider; readonly label: string }[] = [
  { id: 'ollama', label: 'Ollama (http://127.0.0.1:11434)' },
  { id: 'openai-compatible', label: 'Servidor compatible con OpenAI (llama-server, LM Studio, vLLM…)' },
];

export const SOURCE_LABELS: Readonly<Record<ConfigSource, string>> = { flag: 'la orden', env: 'el entorno', file: 'cv.toml', default: 'el valor por defecto' };

export interface LocalForm {
  provider: LocalProvider;
  baseUrl: string;
  model: string;
}

export interface LockedFields {
  readonly provider: boolean;
  readonly baseUrl: boolean;
  readonly model: boolean;
}

/** Misma regla que el servidor: `localhost`, `127.0.0.0/8` o `::1`, con http(s). */
export function isLoopbackUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  const host = parsed.hostname;
  return host === 'localhost' || host === '[::1]' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/** El formulario parte de la configuración efectiva (o de los valores por defecto si cv.toml es inválido). */
export function formFromConfig(config: LlmConfigResponse): LocalForm {
  const effective = config.llm.config;
  if (effective === undefined) {
    return { provider: 'ollama', baseUrl: '', model: '' };
  }
  return { provider: effective.provider, baseUrl: effective.sources.baseUrl === 'default' ? '' : effective.baseUrl, model: effective.sources.model === 'default' ? '' : effective.model };
}

/** Lo que el entorno (o la orden) fija no se puede cambiar desde cv.toml: el campo queda en solo lectura. */
export function lockedFields(config: LlmConfigResponse): LockedFields {
  const sources = config.llm.config?.sources;
  const locked = (source: ConfigSource | undefined): boolean => source === 'env' || source === 'flag';
  return { provider: locked(sources?.provider), baseUrl: locked(sources?.baseUrl), model: locked(sources?.model) };
}

export type SettingsResult = { readonly ok: true; readonly value: LlmSettingsWriteRequest } | { readonly ok: false; readonly message: string };

/** La tabla [llm] que se guardará: solo lo local, URL en loopback, sin vacíos; los modelos por defecto de los remotos se conservan. */
export function buildSettings(form: LocalForm, models: LlmSettingsWriteRequest['models'] | undefined): SettingsResult {
  const baseUrl = form.baseUrl.trim();
  if (baseUrl !== '' && !isLoopbackUrl(baseUrl)) {
    return { ok: false, message: 'La URL base debe ser local (loopback): http://127.0.0.1:… o http://localhost:…; los proveedores remotos se eligen en cada trabajo.' };
  }
  const model = form.model.trim();
  return {
    ok: true,
    value: {
      provider: form.provider,
      ...(baseUrl === '' ? {} : { base_url: baseUrl }),
      ...(model === '' ? {} : { model }),
      ...(models === undefined || Object.keys(models).length === 0 ? {} : { models }),
    },
  };
}

const KEY_LABELS: Readonly<Record<ProviderStatus['keyPresence'], string>> = {
  env: 'clave en el entorno',
  file: 'clave en el fichero de claves',
  none: 'sin clave',
  'insecure-file': 'fichero de claves con permisos abiertos (chmod 600)',
  'invalid-file': 'fichero de claves inválido',
};

export interface ProviderView {
  readonly key: string;
  readonly hasKey: boolean;
  readonly plan: string;
  readonly quota: string | undefined;
  readonly live: string | undefined;
}

function describePublished(quota: NonNullable<ProviderStatus['quota']>): string {
  const parts = [
    quota.requestsPerMinute === undefined ? undefined : `${quota.requestsPerMinute} peticiones/min`,
    quota.requestsPerDay === undefined ? undefined : `${quota.requestsPerDay} peticiones/día`,
    quota.tokensPerMinute === undefined ? undefined : `${quota.tokensPerMinute} tokens/min`,
    quota.tokensPerDay === undefined ? undefined : `${quota.tokensPerDay} tokens/día`,
  ].filter((part): part is string => part !== undefined);
  return `${parts.join(', ')} (según ${quota.sourceUrl}, ${quota.verifiedAt})`;
}

function describeLive(live: NonNullable<ProviderStatus['live']>): string {
  const parts: string[] = [];
  if (live.remainingRequests !== undefined || live.limitRequests !== undefined) {
    parts.push(`${live.remainingRequests ?? '?'}/${live.limitRequests ?? '?'} peticiones${live.resetRequestsSeconds === undefined ? '' : ` (se renueva en ${live.resetRequestsSeconds} s)`}`);
  }
  if (live.remainingTokens !== undefined || live.limitTokens !== undefined) {
    parts.push(`${live.remainingTokens ?? '?'}/${live.limitTokens ?? '?'} tokens${live.resetTokensSeconds === undefined ? '' : ` (se renueva en ${live.resetTokensSeconds} s)`}`);
  }
  if (live.retryAfterSeconds !== undefined) {
    parts.push(`reintentar en ${live.retryAfterSeconds} s`);
  }
  return `${parts.length === 0 ? 'sin datos' : `quedan ${parts.join(' · ')}`} · leída ${live.observedAt}`;
}

export function describeProvider(provider: ProviderStatus): ProviderView {
  return {
    key: KEY_LABELS[provider.keyPresence],
    hasKey: provider.keyPresence === 'env' || provider.keyPresence === 'file',
    plan: provider.plan === 'free' ? 'plan gratuito' : 'plan de pago (límites según la cuenta)',
    quota: provider.quota === undefined ? undefined : describePublished(provider.quota),
    live: provider.live === undefined ? undefined : describeLive(provider.live),
  };
}

/** El resultado de «Comprobar», en una frase. */
export function describeCheck(result: LlmCheckResponse): string {
  if (!result.ok && result.models.length === 0) {
    return `No responde: ${result.message ?? 'sin detalle'}`;
  }
  const models = result.models.length === 0 ? 'ningún modelo' : `${plural(result.models.length, 'modelo', 'modelos')} (${result.models.slice(0, 6).join(', ')}${result.models.length > 6 ? ', …' : ''})`;
  return result.ok ? `Responde: ${models} · el modelo configurado está disponible` : `Responde: ${models} · ${result.message ?? 'el modelo configurado no está disponible'}`;
}

const TASK_LABELS: Readonly<Record<ProviderStatus['models'][number]['recommendedFor'][number], string>> = { improve: 'mejorar logros', summarize: 'resumir', 'suggest-tags': 'sugerir etiquetas' };

/** Los modelos seleccionables de un remoto («id (estado; tareas)»), o nada si solo hay uno. */
export function describeModelOptions(models: ProviderStatus['models']): string | undefined {
  if (models.length < 2) {
    return undefined;
  }
  return models.map((model) => `${model.id} (${model.status === 'production' ? 'estable' : 'preview'}; ${model.recommendedFor.map((task) => TASK_LABELS[task]).join(', ')})`).join(' · ');
}

/* ─────────────────────────── Runtime de Ollama (T-8.8) ─────────────────────────── */

export interface RuntimeView {
  readonly tone: 'ok' | 'warn';
  /** Estado compacto para el badge. */
  readonly badge: string;
  readonly detail: string;
  readonly canStart: boolean;
  readonly canStop: boolean;
  /** Texto del botón de arranque: arrancar, o solo descargar el modelo si Ollama ya responde. */
  readonly startLabel: string;
  /** Por qué no se puede arrancar (title del botón deshabilitado). */
  readonly startHint: string | undefined;
  /** Arrancar implica descargar el modelo (consentimiento previo). */
  readonly needsPull: boolean;
}

export function describeRuntime(state: RuntimeState): RuntimeView {
  const start = `Arrancar Ollama con «${state.model.name}»`;
  if (state.disabled !== undefined) {
    return { tone: 'warn', badge: 'no disponible', detail: state.disabled, canStart: false, canStop: false, startLabel: start, startHint: state.disabled, needsPull: false };
  }
  if (state.running) {
    const present = state.model.present;
    return {
      tone: present ? 'ok' : 'warn',
      badge: state.managed ? `en marcha (${state.runner}, lo arrancó cv)` : 'en marcha (no lo arrancó cv)',
      detail: state.detail,
      canStart: !present,
      canStop: state.managed,
      startLabel: present ? start : `Descargar «${state.model.name}»`,
      startHint: present ? 'Ollama ya está en marcha con el modelo' : undefined,
      needsPull: !present,
    };
  }
  const canStart = state.runner !== 'none';
  return {
    tone: 'warn',
    badge: 'parado',
    detail: state.detail,
    canStart,
    canStop: false,
    startLabel: start,
    startHint: canStart ? undefined : 'No hay ollama ni Docker en esta máquina',
    needsPull: !state.model.present,
  };
}
