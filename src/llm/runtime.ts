/**
 * Runtime de Ollama (T-8.8): arrancar y parar el Ollama local desde cv con el modelo configurado. Dos runners,
 * `native` (`ollama serve` como proceso hijo desprendido) y `docker` (contenedor `chameleon-ollama` con la imagen
 * fijada por digest). Reglas: sin shell (argv fijo), el nombre del modelo validado, host y puerto solo de la
 * `baseUrl` loopback, y **solo se para lo que arrancó cv** (pid propio o contenedor propio). Dentro del contenedor
 * de Compose el runtime queda deshabilitado (Ollama es un servicio del propio Compose). Todo lo que toca el
 * sistema (procesos, ficheros, salud) entra por `RuntimeSystem`, inyectable en las pruebas.
 */
import { isAbsolute, join, resolve } from 'node:path';

import { cacheDirectory } from '../shared/cache';
import { type LlmConfig, type LlmConfigResult, resolveLlmConfig } from './config';
import type { LlmSettings } from './settings';
import type { LlmHealth } from './provider';
import { modelListed } from './ollama';
import { HUGGINGFACE_HOST, LOCAL_MODELS, type LocalModelEntry, localModel } from './registry';

export type RuntimeRunner = 'native' | 'docker';
export const RUNTIME_RUNNERS: readonly RuntimeRunner[] = ['native', 'docker'];

/** La misma imagen (y digest) que `compose.ai.yml`; una prueba lo comprueba. */
export const OLLAMA_IMAGE = 'ollama/ollama:0.33.2@sha256:020e4134285e2ef4d8fd801234176de3b4faadc992a3eb06c8e66a2f9d4c4ba2';
export const OLLAMA_CONTAINER = 'chameleon-ollama';
export const OLLAMA_VOLUME = 'chameleon-ollama';
export const OLLAMA_DEFAULT_PORT = 11434;

export const RUNTIME_ENV = {
  /** Fuerza el runner (`native` o `docker`). */
  runner: 'CHAMELEON_LLM_RUNNER',
  /** Ruta al binario `ollama` (relativa al directorio de trabajo o absoluta); por defecto, el del PATH. */
  ollama: 'CHAMELEON_OLLAMA_BIN',
  /** Ruta al binario `docker`; por defecto, el del PATH. */
  docker: 'CHAMELEON_DOCKER_BIN',
  /** Imagen de Ollama para el runner docker (por defecto, la fijada por digest). */
  image: 'CHAMELEON_OLLAMA_IMAGE',
  /** `1` dentro de la imagen del producto: el runtime queda deshabilitado. */
  container: 'CHAMELEON_CONTAINER',
} as const;

export const RUNTIME_LIMITS = {
  /** Comprobaciones rápidas (`--version`, `docker inspect`). */
  execTimeoutMs: 15_000,
  /** Arranque hasta que responda `/api/version`. */
  startTimeoutMs: 45_000,
  /** Parada hasta que el proceso desaparezca. */
  stopTimeoutMs: 15_000,
  /** Descarga del modelo (varios GB). */
  pullTimeoutMs: 3_600_000,
  pollMs: 500,
} as const;

/** Nombres de modelo de Ollama: `familia`, `familia:etiqueta` o `espacio/familia:etiqueta`, en minúsculas. */
/** `familia:etiqueta`, `espacio/nombre:etiqueta` o un GGUF de Hugging Face `hf.co/<usuario>/<repositorio>:<cuantización>` (T-8.13). */
const MODEL_NAME = /^(?:hf\.co\/[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*(?::[A-Za-z0-9._-]+)?|[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?(?::[a-z0-9._-]+)?)$/;
export const MODEL_NAME_MAX = 128;

export function isValidModelName(name: string): boolean {
  return name.length <= MODEL_NAME_MAX && MODEL_NAME.test(name);
}

// ── Sistema inyectable ─────────────────────────────────────────────────────────────────────────────
export interface ExecOptions {
  readonly timeoutMs: number;
  readonly env?: Readonly<Record<string, string>> | undefined;
  /** Progreso línea a línea (descarga del modelo). */
  readonly onLine?: ((line: string) => void) | undefined;
  readonly signal?: AbortSignal | undefined;
}
export interface ExecResult {
  readonly ok: boolean;
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly message: string | undefined;
}
export type Exec = (command: string, args: readonly string[], options: ExecOptions) => Promise<ExecResult>;
export interface DetachedOptions {
  readonly env: Readonly<Record<string, string>>;
  readonly logPath: string;
}
export type SpawnResult = { readonly ok: true; readonly pid: number } | { readonly ok: false; readonly message: string };
export type SpawnDetached = (command: string, args: readonly string[], options: DetachedOptions) => Promise<SpawnResult>;
export interface RuntimeFiles {
  readonly read: (path: string) => Promise<string | undefined>;
  /** Crea el directorio (0700) y escribe el fichero (0600). */
  readonly write: (path: string, content: string) => Promise<void>;
  readonly remove: (path: string) => Promise<void>;
}
export interface RuntimeSystem {
  readonly exec: Exec;
  readonly spawnDetached: SpawnDetached;
  readonly files: RuntimeFiles;
  readonly health: (config: LlmConfig) => Promise<LlmHealth>;
  readonly processAlive: (pid: number) => boolean;
  /** SIGTERM; `false` si el proceso ya no existe. */
  readonly terminate: (pid: number) => boolean;
  readonly sleep: (ms: number) => Promise<void>;
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly cwd: string;
}

// ── Estado y resultados ────────────────────────────────────────────────────────────────────────────
export interface RuntimeState {
  /** El runner que gestiona Ollama (si lo arrancó cv) o el disponible para arrancarlo; `none` si no hay ninguno. */
  readonly runner: RuntimeRunner | 'none';
  /** Lo arrancó cv (pid propio vivo o contenedor propio). */
  readonly managed: boolean;
  readonly running: boolean;
  readonly model: { readonly name: string; readonly present: boolean };
  /** Registro de `ollama serve` (runner native). */
  readonly log: string;
  /** Motivo por el que el runtime no aplica (Compose, proveedor que no es Ollama, configuración inválida). */
  readonly disabled: string | undefined;
  /** Una frase para humanos. */
  readonly detail: string;
}
export type RuntimeErrorCode = 'disabled' | 'invalid-model' | 'no-runner' | 'not-managed' | 'start-failed' | 'pull-failed' | 'stop-failed';
export type RuntimeResult =
  | { readonly ok: true; readonly state: RuntimeState; readonly lines: readonly string[] }
  | { readonly ok: false; readonly code: RuntimeErrorCode; readonly message: string; readonly lines: readonly string[] };
/** De dónde descargar el modelo (T-8.13): del registro de Ollama (y su espejo si falla) o directamente del espejo de Hugging Face. */
export type ModelSource = 'ollama' | 'huggingface';
export const MODEL_SOURCES: readonly ModelSource[] = ['ollama', 'huggingface'];
export function isModelSource(value: string): value is ModelSource {
  return (MODEL_SOURCES as readonly string[]).includes(value);
}

export interface RuntimeUpOptions {
  readonly runner?: RuntimeRunner | undefined;
  /** Modelo solo para este arranque; por defecto, el configurado. */
  readonly model?: string | undefined;
  /** `false`: no descargar el modelo si falta. */
  readonly pull?: boolean | undefined;
  /** Origen de la descarga; por defecto el registro de Ollama con el espejo de Hugging Face como reserva. */
  readonly source?: ModelSource | undefined;
  readonly progress?: ((line: string) => void) | undefined;
  readonly signal?: AbortSignal | undefined;
}
/** Un modelo del catálogo con su estado en el Ollama configurado (T-8.13). */
export interface LocalModelState extends LocalModelEntry {
  readonly present: boolean;
  /** Tamaño real en disco según `/api/tags`, si Ollama responde y lo tiene. */
  readonly sizeBytes: number | undefined;
  /** Es el modelo configurado (`[llm] model`, entorno u orden). */
  readonly configured: boolean;
}
export interface LocalModelsState {
  readonly catalogue: readonly LocalModelState[];
  /** Modelos presentes en Ollama que no están en el catálogo (p. ej. los `hf.co/…` de los espejos). */
  readonly others: readonly { readonly name: string; readonly sizeBytes: number | undefined }[];
  readonly running: boolean;
  readonly disabled: string | undefined;
}

export interface LlmRuntime {
  readonly status: () => Promise<RuntimeState>;
  readonly up: (options?: RuntimeUpOptions) => Promise<RuntimeResult>;
  readonly down: () => Promise<RuntimeResult>;
  /** El catálogo de modelos locales con lo que hay descargado (T-8.13). */
  readonly models: () => Promise<LocalModelsState>;
}

/** Lo que el runtime necesita de `cv.toml` y el entorno: la configuración efectiva del co-piloto y las preferencias de `[llm.runtime]`. */
export interface RuntimeConfiguration {
  readonly result: LlmConfigResult;
  readonly runner: RuntimeRunner | undefined;
  readonly image: string | undefined;
}

/** Un `cv.toml` inválido invalida la configuración entera; `[llm.runtime]` solo se lee si es válido. */
export function runtimeConfiguration(
  env: NodeJS.ProcessEnv,
  snapshot: { readonly settings?: LlmSettings | undefined; readonly settingsError?: string | undefined },
): RuntimeConfiguration {
  if (snapshot.settingsError !== undefined) {
    return { result: { ok: false, message: snapshot.settingsError }, runner: undefined, image: undefined };
  }
  return { result: resolveLlmConfig(env, { settings: snapshot.settings }), runner: snapshot.settings?.runtime?.runner, image: snapshot.settings?.runtime?.image };
}

export function isRuntimeRunner(value: string): value is RuntimeRunner {
  return RUNTIME_RUNNERS.includes(value as RuntimeRunner);
}

/** `<caché de usuario>/chameleon-cv/ollama`: pid y registro del runner native. */
export function runtimeDirectory(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string {
  return join(cacheDirectory(env, platform, home), 'ollama');
}

/** Host y puerto de la `baseUrl` loopback (el puerto por defecto de Ollama si no lleva). */
export function endpointOf(baseUrl: string): { readonly host: string; readonly port: number } {
  const url = new URL(baseUrl);
  return { host: url.hostname, port: url.port === '' ? OLLAMA_DEFAULT_PORT : Number(url.port) };
}

function binary(system: RuntimeSystem, variable: string, fallback: string): string {
  const value = system.env[variable]?.trim();
  if (value === undefined || value === '') {
    return fallback;
  }
  const explicitPath = isAbsolute(value) || value.includes('/') || value.includes('\\');
  return explicitPath ? resolve(system.cwd, value) : value;
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

interface Managed {
  readonly runner: RuntimeRunner;
  readonly pid: number | undefined;
}

export function createLlmRuntime(configure: () => Promise<RuntimeConfiguration>, system: RuntimeSystem): LlmRuntime {
  const directory = runtimeDirectory(system.env, system.platform, system.home);
  const pidPath = join(directory, 'ollama.pid');
  const logPath = join(directory, 'serve.log');
  const ollama = (): string => binary(system, RUNTIME_ENV.ollama, 'ollama');
  const docker = (): string => binary(system, RUNTIME_ENV.docker, 'docker');
  /** Preferencias de la última configuración leída (`[llm.runtime]`); el entorno manda sobre ellas. */
  let preferred: { runner: RuntimeRunner | undefined; image: string | undefined } = { runner: undefined, image: undefined };
  const image = (): string => system.env[RUNTIME_ENV.image]?.trim() || preferred.image || OLLAMA_IMAGE;
  const quick = { timeoutMs: RUNTIME_LIMITS.execTimeoutMs } as const;

  async function nativeAvailable(): Promise<boolean> {
    return (await system.exec(ollama(), ['--version'], quick)).ok;
  }

  async function dockerAvailable(): Promise<boolean> {
    return (await system.exec(docker(), ['version', '--format', '{{.Server.Version}}'], quick)).ok;
  }

  /** El runner pedido (opción o entorno) si está disponible, o el primero disponible: native, luego docker. */
  async function detect(forced: RuntimeRunner | undefined): Promise<{ readonly runner: RuntimeRunner } | { readonly runner: 'none'; readonly reason: string }> {
    if (forced !== undefined) {
      const available = forced === 'native' ? await nativeAvailable() : await dockerAvailable();
      return available ? { runner: forced } : { runner: 'none', reason: forced === 'native' ? `no se encontró el binario «${ollama()}»` : `Docker no responde (${docker()})` };
    }
    if (await nativeAvailable()) {
      return { runner: 'native' };
    }
    if (await dockerAvailable()) {
      return { runner: 'docker' };
    }
    return { runner: 'none', reason: `no hay «${ollama()}» ni Docker («${docker()}»): instala Ollama o Docker` };
  }

  function forcedRunner(option: RuntimeRunner | undefined): RuntimeRunner | undefined {
    if (option !== undefined) {
      return option;
    }
    const fromEnv = system.env[RUNTIME_ENV.runner]?.trim().toLowerCase();
    return fromEnv !== undefined && isRuntimeRunner(fromEnv) ? fromEnv : preferred.runner;
  }

  /** ¿Hay un Ollama arrancado por cv? Un pid guardado que ya no vive se olvida. */
  async function managed(): Promise<Managed | undefined> {
    const saved = await system.files.read(pidPath);
    if (saved !== undefined) {
      const pid = Number.parseInt(saved.trim(), 10);
      if (Number.isInteger(pid) && pid > 0 && system.processAlive(pid)) {
        return { runner: 'native', pid };
      }
      await system.files.remove(pidPath);
    }
    const inspect = await system.exec(docker(), ['inspect', '-f', '{{.State.Running}}', OLLAMA_CONTAINER], quick);
    return inspect.ok && inspect.stdout.trim() === 'true' ? { runner: 'docker', pid: undefined } : undefined;
  }

  async function disabledReason(): Promise<{ readonly reason: string; readonly model: string } | { readonly reason: undefined; readonly config: LlmConfig }> {
    if (system.env[RUNTIME_ENV.container] === '1') {
      return { reason: 'dentro del contenedor de Compose, Ollama es un servicio del propio Compose: gestiónalo con «docker compose»', model: '' };
    }
    const configuration = await configure();
    preferred = { runner: configuration.runner, image: configuration.image };
    const resolved = configuration.result;
    if (!resolved.ok) {
      return { reason: `configuración del co-piloto inválida: ${resolved.message}`, model: '' };
    }
    if (resolved.config.provider !== 'ollama') {
      return { reason: `el runtime solo gestiona Ollama; el proveedor configurado es «${resolved.config.provider}»`, model: resolved.config.model };
    }
    return { reason: undefined, config: resolved.config };
  }

  async function describe(config: LlmConfig, health: LlmHealth, current: Managed | undefined): Promise<RuntimeState> {
    const present = health.ok && health.modelAvailable;
    if (health.ok) {
      const who = current === undefined ? 'no lo arrancó cv' : `${current.runner}, lo arrancó cv`;
      return {
        runner: current?.runner ?? 'none',
        managed: current !== undefined,
        running: true,
        model: { name: config.model, present },
        log: logPath,
        disabled: undefined,
        detail: `Ollama en marcha (${who}) · modelo «${config.model}» ${present ? 'presente' : 'no descargado'}`,
      };
    }
    const available = await detect(forcedRunner(undefined));
    const how = available.runner === 'none' ? available.reason : `runner ${available.runner} disponible`;
    return { runner: available.runner, managed: false, running: false, model: { name: config.model, present: false }, log: logPath, disabled: undefined, detail: `Ollama parado · ${how}` };
  }

  async function status(): Promise<RuntimeState> {
    const gate = await disabledReason();
    if (gate.reason !== undefined) {
      return { runner: 'none', managed: false, running: false, model: { name: gate.model, present: false }, log: logPath, disabled: gate.reason, detail: gate.reason };
    }
    return describe(gate.config, await system.health(gate.config), await managed());
  }

  async function waitFor(condition: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
    for (let waited = 0; waited <= timeoutMs; waited += RUNTIME_LIMITS.pollMs) {
      if (await condition()) {
        return true;
      }
      await system.sleep(RUNTIME_LIMITS.pollMs);
    }
    return false;
  }

  async function start(config: LlmConfig, runner: RuntimeRunner, say: (line: string) => void): Promise<string | undefined> {
    const { host, port } = endpointOf(config.baseUrl);
    if (runner === 'native') {
      const spawned = await system.spawnDetached(ollama(), ['serve'], { env: { ...stringEnv(system.env), OLLAMA_HOST: `${host}:${port}` }, logPath });
      if (!spawned.ok) {
        return `no se pudo arrancar «${ollama()} serve»: ${spawned.message}`;
      }
      await system.files.write(pidPath, `${spawned.pid}\n`);
      say(`Ollama arrancado (native) · registro en ${logPath}`);
      const ready = await waitFor(async () => (await system.health(config)).ok, RUNTIME_LIMITS.startTimeoutMs);
      if (!ready) {
        system.terminate(spawned.pid);
        await system.files.remove(pidPath);
        return `Ollama no respondió en ${config.baseUrl} tras ${RUNTIME_LIMITS.startTimeoutMs / 1000} s; revisa ${logPath}`;
      }
      return undefined;
    }
    const exists = await system.exec(docker(), ['inspect', '-f', '{{.State.Running}}', OLLAMA_CONTAINER], quick);
    const started = exists.ok
      ? await system.exec(docker(), ['start', OLLAMA_CONTAINER], quick)
      : await system.exec(docker(), ['run', '-d', '--name', OLLAMA_CONTAINER, '-p', `127.0.0.1:${port}:11434`, '-v', `${OLLAMA_VOLUME}:/root/.ollama`, image()], { timeoutMs: RUNTIME_LIMITS.pullTimeoutMs });
    if (!started.ok) {
      return `no se pudo arrancar el contenedor ${OLLAMA_CONTAINER}: ${started.stderr.trim() || started.message}`;
    }
    say(exists.ok ? `contenedor ${OLLAMA_CONTAINER} reanudado (docker)` : `contenedor ${OLLAMA_CONTAINER} creado (docker, imagen ${image()})`);
    const ready = await waitFor(async () => (await system.health(config)).ok, RUNTIME_LIMITS.startTimeoutMs);
    return ready ? undefined : `el contenedor ${OLLAMA_CONTAINER} no responde en ${config.baseUrl} tras ${RUNTIME_LIMITS.startTimeoutMs / 1000} s; revisa «docker logs ${OLLAMA_CONTAINER}»`;
  }

  /**
   * Descarga del modelo (T-8.8) con la reserva de T-8.13: si el registro de Ollama falla y el catálogo tiene espejo en
   * Hugging Face, se descarga el espejo y se crea el alias corto (`ollama cp`) para que el nombre configurado funcione.
   */
  async function pull(config: LlmConfig, current: Managed | undefined, options: RuntimeUpOptions, say: (line: string) => void): Promise<string | undefined> {
    const { host, port } = endpointOf(config.baseUrl);
    const runner = current?.runner ?? ((await nativeAvailable()) ? 'native' : (await dockerAvailable()) ? 'docker' : 'none');
    if (runner === 'none') {
      return `no hay «${ollama()}» ni Docker para descargar «${config.model}»`;
    }
    const run = (args: readonly string[], timeoutMs: number): Promise<ExecResult> => {
      const exec = { timeoutMs, onLine: say, signal: options.signal } as const;
      return runner === 'native'
        ? system.exec(ollama(), args, { ...exec, env: { OLLAMA_HOST: `${host}:${port}` } })
        : system.exec(docker(), ['exec', OLLAMA_CONTAINER, 'ollama', ...args], exec);
    };
    const failure = (result: ExecResult): string => result.stderr.trim() || result.message || `código ${result.code ?? '?'}`;
    const mirror = localModel(config.model)?.mirror;
    const source = options.source ?? 'ollama';
    if (source === 'huggingface' && mirror === undefined) {
      return `«${config.model}» no tiene espejo en Hugging Face en el catálogo (cv llm models); descárgalo del registro de Ollama`;
    }
    if (source === 'ollama') {
      say(`descargando el modelo «${config.model}» (${runner}, registro de Ollama)…`);
      const result = await run(['pull', config.model], RUNTIME_LIMITS.pullTimeoutMs);
      if (result.ok) {
        return undefined;
      }
      if (mirror === undefined) {
        return `la descarga de «${config.model}» falló: ${failure(result)}`;
      }
      say(`el registro de Ollama falló (${failure(result)}); se intenta el espejo «${mirror}» en ${HUGGINGFACE_HOST}`);
    } else {
      say(`descargando «${mirror}» desde ${HUGGINGFACE_HOST} (${runner})…`);
    }
    const pulled = await run(['pull', mirror as string], RUNTIME_LIMITS.pullTimeoutMs);
    if (!pulled.ok) {
      return `la descarga de «${mirror}» falló: ${failure(pulled)}`;
    }
    const aliased = await run(['cp', mirror as string, config.model], RUNTIME_LIMITS.execTimeoutMs);
    if (!aliased.ok) {
      return `no se pudo crear el alias «${config.model}» de «${mirror}»: ${failure(aliased)}`;
    }
    say(`alias «${config.model}» creado a partir de «${mirror}»`);
    return undefined;
  }

  async function models(): Promise<LocalModelsState> {
    const gate = await disabledReason();
    if (gate.reason !== undefined) {
      return { catalogue: LOCAL_MODELS.map((entry) => ({ ...entry, present: false, sizeBytes: undefined, configured: entry.id === gate.model })), others: [], running: false, disabled: gate.reason };
    }
    const health = await system.health(gate.config);
    const names = health.ok ? health.models : [];
    const sizes = health.ok ? (health.sizes ?? {}) : {};
    const sizeOf = (name: string): number | undefined => sizes[name] ?? sizes[`${name}:latest`];
    const catalogue = LOCAL_MODELS.map((entry) => ({ ...entry, present: modelListed(entry.id, names), sizeBytes: sizeOf(entry.id), configured: modelListed(entry.id, [gate.config.model]) }));
    const others = names.filter((name) => localModel(name) === undefined).map((name) => ({ name, sizeBytes: sizeOf(name) }));
    return { catalogue, others, running: health.ok, disabled: undefined };
  }

  async function up(options: RuntimeUpOptions = {}): Promise<RuntimeResult> {
    const lines: string[] = [];
    const say = (line: string): void => {
      lines.push(line);
      options.progress?.(line);
    };
    const gate = await disabledReason();
    if (gate.reason !== undefined) {
      return { ok: false, code: 'disabled', message: gate.reason, lines };
    }
    const model = options.model?.trim() ?? gate.config.model;
    if (!isValidModelName(model)) {
      return { ok: false, code: 'invalid-model', message: `nombre de modelo inválido «${model}»: minúsculas, dígitos, «.», «_», «-», un «/» y una etiqueta «:tag» (máx. ${MODEL_NAME_MAX})`, lines };
    }
    const config: LlmConfig = { ...gate.config, model };
    let health = await system.health(config);
    let current = await managed();
    if (!health.ok) {
      const detected = await detect(forcedRunner(options.runner));
      if (detected.runner === 'none') {
        return { ok: false, code: 'no-runner', message: detected.reason, lines };
      }
      const failure = await start(config, detected.runner, say);
      if (failure !== undefined) {
        return { ok: false, code: 'start-failed', message: failure, lines };
      }
      current = await managed();
      health = await system.health(config);
      say(`Ollama responde en ${config.baseUrl}`);
    } else {
      say(current === undefined ? 'Ollama ya está en marcha (no lo arrancó cv): no se toca' : `Ollama ya está en marcha (${current.runner}, lo arrancó cv)`);
    }
    if (!(health.ok && health.modelAvailable)) {
      if (options.pull === false) {
        say(`el modelo «${model}» no está descargado (--no-pull)`);
      } else {
        const failure = await pull(config, current, options, say);
        if (failure !== undefined) {
          return { ok: false, code: 'pull-failed', message: failure, lines };
        }
        health = await system.health(config);
        say(health.ok && health.modelAvailable ? `modelo «${model}» disponible` : `Ollama no lista «${model}» tras la descarga`);
      }
    } else {
      say(`modelo «${model}» disponible`);
    }
    return { ok: true, state: await describe(config, health, current), lines };
  }

  async function down(): Promise<RuntimeResult> {
    const lines: string[] = [];
    const gate = await disabledReason();
    if (gate.reason !== undefined) {
      return { ok: false, code: 'disabled', message: gate.reason, lines };
    }
    const current = await managed();
    if (current === undefined) {
      const health = await system.health(gate.config);
      if (health.ok) {
        return { ok: false, code: 'not-managed', message: 'Ollama está en marcha pero no lo arrancó cv: páralo donde lo arrancaste', lines };
      }
      lines.push('Ollama no está en marcha');
      return { ok: true, state: await describe(gate.config, health, undefined), lines };
    }
    if (current.runner === 'native' && current.pid !== undefined) {
      system.terminate(current.pid);
      const gone = await waitFor(async () => !system.processAlive(current.pid as number), RUNTIME_LIMITS.stopTimeoutMs);
      if (!gone) {
        return { ok: false, code: 'stop-failed', message: `el proceso ${current.pid} de Ollama no terminó en ${RUNTIME_LIMITS.stopTimeoutMs / 1000} s`, lines };
      }
      await system.files.remove(pidPath);
      lines.push('Ollama detenido (native)');
    } else {
      const stopped = await system.exec(docker(), ['stop', OLLAMA_CONTAINER], { timeoutMs: RUNTIME_LIMITS.stopTimeoutMs + RUNTIME_LIMITS.execTimeoutMs });
      if (!stopped.ok) {
        return { ok: false, code: 'stop-failed', message: `no se pudo parar el contenedor ${OLLAMA_CONTAINER}: ${stopped.stderr.trim() || stopped.message}`, lines };
      }
      lines.push(`Ollama detenido (docker; el contenedor ${OLLAMA_CONTAINER} y sus modelos se conservan)`);
    }
    return { ok: true, state: await describe(gate.config, await system.health(gate.config), undefined), lines };
  }

  return { status, up, down, models };
}

/** Una línea para `cv llm status` y la GUI. */
export function formatRuntimeState(state: RuntimeState): string {
  return state.disabled === undefined ? `runtime: ${state.detail}` : `runtime: no disponible · ${state.disabled}`;
}

function gibibytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

/** `cv llm models`: el catálogo con lo descargado, una línea por modelo, y los modelos presentes fuera del catálogo. */
export function formatLocalModels(state: LocalModelsState): string[] {
  const lines: string[] = [];
  if (state.disabled !== undefined) {
    lines.push(`Ollama no disponible (${state.disabled}); se muestra el catálogo sin comprobar lo descargado`);
  } else if (!state.running) {
    lines.push('Ollama parado: no se puede comprobar qué modelos están descargados (cv llm up)');
  }
  const width = state.catalogue.reduce((max, entry) => Math.max(max, entry.id.length), 0);
  for (const entry of state.catalogue) {
    const presence = state.running ? (entry.present ? `descargado${entry.sizeBytes === undefined ? '' : ` (${gibibytes(entry.sizeBytes)})`}` : 'no descargado') : 'sin comprobar';
    const thinking = entry.thinking === 'none' ? 'sin razonamiento' : entry.thinking === 'switchable' ? 'razonamiento conmutable' : 'razona siempre';
    const notes = [entry.configured ? 'configurado' : '', entry.mirror === undefined ? 'sin espejo' : ''].filter((note) => note !== '');
    lines.push(
      `${entry.id.padEnd(width)}  ${presence.padEnd(21)}  ${thinking.padEnd(23)}  ${entry.downloadGiB} GiB · RAM ≥ ${entry.minRamGiB} GiB · ${entry.license} · ${entry.recommendedFor.length === 0 ? 'sin tareas recomendadas' : entry.recommendedFor.join(', ')}${notes.length === 0 ? '' : ` · ${notes.join(' · ')}`}`,
    );
  }
  if (state.others.length > 0) {
    lines.push(`Otros modelos presentes: ${state.others.map((other) => `${other.name}${other.sizeBytes === undefined ? '' : ` (${gibibytes(other.sizeBytes)})`}`).join(', ')}`);
  }
  return lines;
}
