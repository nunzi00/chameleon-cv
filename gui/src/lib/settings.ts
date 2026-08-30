/**
 * La pantalla «Ajustes» sin DOM (docs/copilot-settings.md §4.6): qué editar de `cv.toml`, qué está fijado por
 * el entorno, cómo validar antes de guardar y cómo describir cada proveedor del registro (plan, cuota
 * publicada y viva, clave). Nunca ve claves: solo su procedencia.
 */
import type { LlmCheckResponse, LlmConfigResponse, LlmSettingsWriteRequest, LocalModelsState, RuntimeState } from './api/types';
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

export type RuntimeRunnerChoice = '' | 'native' | 'docker';

export interface LocalForm {
  provider: LocalProvider;
  baseUrl: string;
  model: string;
  /** `[llm.runtime]` (T-8.8): runner forzado ('' = detectar) e imagen de Ollama para el runner docker. */
  runtimeRunner: RuntimeRunnerChoice;
  runtimeImage: string;
  /** `[llm] think` (T-8.13): pedir razonamiento a los modelos locales que lo conmutan. */
  think: boolean;
}

export const RUNNER_CHOICES: readonly { readonly id: RuntimeRunnerChoice; readonly label: string }[] = [
  { id: '', label: 'Detectar (native si hay ollama; si no, docker)' },
  { id: 'native', label: 'native (binario ollama)' },
  { id: 'docker', label: 'docker (contenedor chameleon-ollama)' },
];

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
  const runtime = config.llm.settings.values?.runtime;
  const preferences = { runtimeRunner: runtime?.runner ?? '', runtimeImage: runtime?.image ?? '', think: config.llm.settings.values?.think === true } as const;
  if (effective === undefined) {
    return { provider: 'ollama', baseUrl: '', model: '', ...preferences };
  }
  return { provider: effective.provider, baseUrl: effective.sources.baseUrl === 'default' ? '' : effective.baseUrl, model: effective.sources.model === 'default' ? '' : effective.model, ...preferences };
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
  const image = form.runtimeImage.trim();
  const runtime = { ...(form.runtimeRunner === '' ? {} : { runner: form.runtimeRunner }), ...(image === '' ? {} : { image }) };
  return {
    ok: true,
    value: {
      provider: form.provider,
      ...(baseUrl === '' ? {} : { base_url: baseUrl }),
      ...(model === '' ? {} : { model }),
      ...(models === undefined || Object.keys(models).length === 0 ? {} : { models }),
      ...(form.think ? { think: true } : {}),
      ...(Object.keys(runtime).length === 0 ? {} : { runtime }),
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
  /** Con qué vía arrancará y por qué (T-8.14): «Se usará Docker: …», o cómo instalar una vía si no hay ninguna. */
  readonly plan: string;
}

/** La vía de arranque para humanos: binario ollama, Docker (contenedor chameleon-ollama) o ninguna, con el motivo del plan. */
export function describePlan(state: RuntimeState): string {
  if (state.disabled !== undefined) {
    return '';
  }
  if (state.running) {
    return state.managed ? `Arrancado por cv con ${state.runner === 'docker' ? 'Docker (contenedor chameleon-ollama)' : 'el binario ollama'}.` : 'Arrancado fuera de cv.';
  }
  if (state.plan.runner === 'none') {
    return `No hay con qué arrancar: ${state.plan.note}. Instala Ollama (binario) o Docker; cv detectará el que haya.`;
  }
  return `Se usará ${state.plan.runner === 'docker' ? 'Docker (contenedor chameleon-ollama)' : 'el binario ollama'}: ${state.plan.note}.`;
}

export function describeRuntime(state: RuntimeState): RuntimeView {
  const start = `Arrancar Ollama con «${state.model.name}»`;
  const plan = describePlan(state);
  if (state.disabled !== undefined) {
    return { tone: 'warn', badge: 'no disponible', detail: state.disabled, canStart: false, canStop: false, startLabel: start, startHint: state.disabled, needsPull: false, plan };
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
      plan,
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
    startHint: canStart ? undefined : state.plan.note,
    needsPull: !state.model.present,
    plan,
  };
}

/** Cuota viva como barra: porcentaje usado de peticiones (o de tokens si no hay peticiones); sin límites, `undefined`. */
export function quotaMeter(live: ProviderStatus['live']): { readonly percent: number } | undefined {
  if (live === undefined) {
    return undefined;
  }
  const pairs = [
    [live.remainingRequests, live.limitRequests],
    [live.remainingTokens, live.limitTokens],
  ] as const;
  for (const [remaining, limit] of pairs) {
    if (remaining !== undefined && limit !== undefined && limit > 0) {
      return { percent: Math.min(100, Math.max(0, Math.round(((limit - remaining) / limit) * 100))) };
    }
  }
  return undefined;
}

/** Una línea por modelo del catálogo para el selector de Ajustes (T-8.13): razonamiento, tamaño, RAM y si está descargado. */
export function describeLocalModel(entry: LocalModelsState['catalogue'][number], running: boolean): string {
  const thinking = entry.thinking === 'none' ? 'sin razonamiento' : entry.thinking === 'switchable' ? 'razonamiento conmutable' : 'razona siempre';
  const presence = !running ? '' : entry.present ? ' · descargado' : ' · no descargado';
  return `${entry.id} — ${thinking} · ${entry.downloadGiB} GiB · RAM ≥ ${entry.minRamGiB} GiB${presence}`;
}

/** El valor del selector de modelo: '' (el del proveedor), una entrada del catálogo u «otro» (campo libre). */
export const OTHER_MODEL = '__otro__';
export function modelChoice(model: string, catalogue: LocalModelsState['catalogue']): string {
  const name = model.trim().replace(/:latest$/, '');
  return name === '' ? '' : catalogue.some((entry) => entry.id === name) ? name : OTHER_MODEL;
}

/** Qué descargará Ollama para un modelo: el registro y, si el catálogo tiene espejo, la reserva en Hugging Face. */
export function describeDownload(model: string, catalogue: LocalModelsState['catalogue'] | undefined): string {
  const entry = catalogue?.find((candidate) => candidate.id === model.trim().replace(/:latest$/, ''));
  const size = entry === undefined ? 'varios GB' : `unos ${entry.downloadGiB} GiB`;
  const mirror = entry?.mirror === undefined ? '' : `; si el registro falla, se descarga el espejo «${entry.mirror}» desde huggingface.co y se crea el alias`;
  return `Ollama descargará «${model}» (${size}) del registro público de Ollama (registry.ollama.ai)${mirror}. No sale ningún dato tuyo; solo entra el modelo.`;
}
