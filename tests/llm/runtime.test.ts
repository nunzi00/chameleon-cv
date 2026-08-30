import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { LlmConfig } from '../../src/llm/config';
import type { LlmHealth } from '../../src/llm/provider';
import {
  OLLAMA_CONTAINER,
  OLLAMA_IMAGE,
  RUNTIME_ENV,
  type ExecResult,
  type RuntimeConfiguration,
  type RuntimeRunner,
  type RuntimeSystem,
  createLlmRuntime,
  endpointOf,
  formatLocalModels,
  formatRuntimeState,
  isModelSource,
  isRuntimeRunner,
  isValidModelName,
  runtimeConfiguration,
  runtimeDirectory,
} from '../../src/llm/runtime';

const CONFIG: LlmConfig = { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b', sources: { provider: 'default', baseUrl: 'default', model: 'default' } };
const OK: ExecResult = { ok: true, code: 0, stdout: '', stderr: '', message: undefined };
const MISSING: ExecResult = { ok: false, code: null, stdout: '', stderr: '', message: 'spawn ENOENT' };
const HOME = '/home/ana';
const PID_PATH = join(runtimeDirectory({}, 'linux', HOME), 'ollama.pid');
const LOG_PATH = join(runtimeDirectory({}, 'linux', HOME), 'serve.log');

interface World {
  /** Ollama responde en la baseUrl. */
  up: boolean;
  /** Modelos que Ollama lista. */
  models: string[];
  /** Procesos vivos. */
  alive: Set<number>;
  /** Contenedor propio: ausente, parado o en marcha. */
  container: 'none' | 'stopped' | 'running';
  ollamaBinary: boolean;
  dockerBinary: boolean;
  /** Al arrancar (spawn o docker), ¿llega a responder? */
  startsResponding: boolean;
  pullFails: boolean;
  spawnFails: boolean;
  /** El registro de Ollama falla (los espejos `hf.co/…` siguen bajando). */
  registryDown: boolean;
  cpFails: boolean;
  /** Tamaños que Ollama informa en /api/tags. */
  sizes: Record<string, number>;
}

function world(overrides: Partial<World> = {}): World {
  return { up: false, models: [], alive: new Set(), container: 'none', ollamaBinary: true, dockerBinary: false, startsResponding: true, pullFails: false, spawnFails: false, registryDown: false, cpFails: false, sizes: {}, ...overrides };
}

function fakeSystem(w: World, env: NodeJS.ProcessEnv = {}, files: Map<string, string> = new Map(), config: LlmConfig = CONFIG) {
  const calls: string[] = [];
  let nextPid = 4242;
  const health = async (config: LlmConfig): Promise<LlmHealth> =>
    w.up
      ? { ok: true, version: '0.33.2', models: [...w.models], modelAvailable: w.models.includes(config.model), ...(Object.keys(w.sizes).length === 0 ? {} : { sizes: { ...w.sizes } }) }
      : { ok: false, code: 'unreachable', message: `Ollama no responde en ${config.baseUrl}` };
  /** `pull`/`cp` como los ejecuta Ollama (native: args desde 0; docker exec: desde 3). */
  const model = (args: readonly string[], offset: number): ExecResult | undefined => {
    const [command, first, second] = [args[offset], args[offset + 1] ?? '', args[offset + 2] ?? ''];
    if (command === 'pull') {
      if (w.registryDown && !first.startsWith('hf.co/')) {
        return { ...OK, ok: false, code: 1, stderr: 'Error: max retries exceeded' };
      }
      if (w.pullFails) {
        // PULL_SILENT: fallo sin stderr ni mensaje (solo el código, o ni eso).
        if (env['PULL_SILENT'] === '1') {
          return { ...OK, ok: false, code: 1, stderr: '', message: undefined };
        }
        if (env['PULL_SILENT'] === '2') {
          return { ...OK, ok: false, code: null, stderr: '', message: undefined };
        }
        return offset === 0 ? { ...OK, ok: false, code: 1, stderr: 'Error: model not found' } : { ...OK, ok: false, code: 1, stderr: '', message: 'exit 1' };
      }
      w.models.push(first);
      return OK;
    }
    if (command === 'cp') {
      if (w.cpFails) {
        return { ...OK, ok: false, code: 1, stderr: 'cannot copy' };
      }
      w.models.push(second);
      return OK;
    }
    return undefined;
  };
  const system: RuntimeSystem = {
    exec: async (command, args, options) => {
      calls.push(`${command} ${args.join(' ')}`);
      const isDocker = command.endsWith('docker');
      const isOllama = command.endsWith('ollama');
      if (isOllama && !w.ollamaBinary) {
        return MISSING;
      }
      if (isDocker && !w.dockerBinary) {
        return MISSING;
      }
      if (isOllama && (args[0] === 'pull' || args[0] === 'cp')) {
        options.onLine?.('pulling manifest');
        return model(args, 0) ?? OK;
      }
      if (isDocker && args[0] === 'exec') {
        return model(args, 3) ?? OK;
      }
      if (isDocker && args[0] === 'inspect') {
        return w.container === 'none' ? { ...OK, ok: false, code: 1, stderr: 'No such object' } : { ...OK, stdout: `${w.container === 'running'}\n` };
      }
      if (isDocker && (args[0] === 'run' || args[0] === 'start')) {
        if (!w.startsResponding) {
          if (args[0] === 'run' && env['DOCKER_FAILS'] === '1') {
            return { ...OK, ok: false, code: 125, stderr: 'docker: port is already allocated' };
          }
          return args[0] === 'run' && env['DOCKER_FAILS'] === '2' ? { ...OK, ok: false, code: 125, message: 'exit 125' } : OK;
        }
        w.container = 'running';
        w.up = true;
        return OK;
      }
      if (isDocker && args[0] === 'stop') {
        if (env['DOCKER_STOP_FAILS'] === '1') {
          return { ...OK, ok: false, code: 1, stderr: 'cannot stop' };
        }
        if (env['DOCKER_STOP_FAILS'] === '2') {
          return { ...OK, ok: false, code: 1, message: 'exit 1' };
        }
        w.container = 'stopped';
        w.up = false;
        return OK;
      }
      return OK;
    },
    spawnDetached: async (command, args, options) => {
      calls.push(`spawn ${command} ${args.join(' ')} OLLAMA_HOST=${options.env['OLLAMA_HOST']}`);
      if (w.spawnFails) {
        return { ok: false, message: 'spawn ENOENT' };
      }
      const pid = nextPid++;
      w.alive.add(pid);
      if (w.startsResponding) {
        w.up = true;
      }
      return { ok: true, pid };
    },
    files: {
      read: async (path) => files.get(path),
      write: async (path, content) => {
        files.set(path, content);
      },
      remove: async (path) => {
        files.delete(path);
      },
    },
    health,
    processAlive: (pid) => w.alive.has(pid),
    terminate: (pid) => {
      if (!w.alive.has(pid)) {
        return false;
      }
      if (env['STUBBORN'] !== '1') {
        w.alive.delete(pid);
        w.up = false;
      }
      return true;
    },
    sleep: async () => undefined,
    env,
    platform: 'linux',
    home: HOME,
    cwd: '/work',
  };
  const preferences = { runner: undefined as RuntimeRunner | undefined, image: undefined as string | undefined };
  const configure = async (): Promise<RuntimeConfiguration> => ({ result: { ok: true, config }, runner: preferences.runner, image: preferences.image });
  return { system, calls, files, preferences, runtime: createLlmRuntime(configure, system) };
}

describe('utilidades del runtime', () => {
  it('valida nombres de modelo de Ollama', () => {
    expect(isValidModelName('qwen2.5:7b-instruct')).toBe(true);
    expect(isValidModelName('library/llama3')).toBe(true);
    expect(isValidModelName('Qwen2.5')).toBe(false);
    expect(isValidModelName('')).toBe(false);
    expect(isValidModelName('a/b/c')).toBe(false);
    expect(isValidModelName('x'.repeat(129))).toBe(false);
  });

  it('endpointOf saca host y puerto (por defecto 11434); isRuntimeRunner y runtimeDirectory', () => {
    expect(endpointOf('http://127.0.0.1:11434')).toEqual({ host: '127.0.0.1', port: 11434 });
    expect(endpointOf('http://localhost')).toEqual({ host: 'localhost', port: 11434 });
    expect(endpointOf('http://127.0.0.1:43117/')).toEqual({ host: '127.0.0.1', port: 43117 });
    expect(isRuntimeRunner('docker')).toBe(true);
    expect(isRuntimeRunner('podman')).toBe(false);
    expect(runtimeDirectory({}, 'linux', HOME)).toBe(join(HOME, '.cache', 'chameleon-cv', 'ollama'));
  });

  it('la imagen fijada coincide con compose.ai.yml', () => {
    const compose = readFileSync(join(__dirname, '..', '..', 'compose.ai.yml'), 'utf8');
    expect(compose).toContain(`image: ${OLLAMA_IMAGE}`);
  });

  it('runtimeConfiguration: un cv.toml inválido invalida la configuración; si no, la resuelve del entorno y los ajustes y lee [llm.runtime]', () => {
    expect(runtimeConfiguration({}, { settingsError: 'cv.toml: [llm] provider inválido' })).toEqual({ result: { ok: false, message: 'cv.toml: [llm] provider inválido' }, runner: undefined, image: undefined });
    const resolved = runtimeConfiguration({}, { settings: { provider: 'ollama', model: 'llama3:8b', runtime: { runner: 'docker', image: 'ollama/ollama:latest' } } });
    expect(resolved.result.ok && resolved.result.config).toMatchObject({ provider: 'ollama', model: 'llama3:8b' });
    expect(resolved).toMatchObject({ runner: 'docker', image: 'ollama/ollama:latest' });
    expect(runtimeConfiguration({ CHAMELEON_LLM_BASE_URL: 'http://ejemplo.com' }, {}).result.ok).toBe(false);
    expect(runtimeConfiguration({}, {}).runner).toBeUndefined();
  });

  it('las preferencias de [llm.runtime] fuerzan el runner y la imagen, y el entorno manda sobre ellas', async () => {
    const prefer = fakeSystem(world({ ollamaBinary: true, dockerBinary: true }));
    prefer.preferences.runner = 'docker';
    prefer.preferences.image = 'ollama/ollama:pref';
    expect((await prefer.runtime.up({ pull: false })).ok).toBe(true);
    expect(prefer.calls).toContain(`docker run -d --name ${OLLAMA_CONTAINER} -p 127.0.0.1:11434:11434 -v chameleon-ollama:/root/.ollama ollama/ollama:pref`);
    const env = fakeSystem(world({ ollamaBinary: true, dockerBinary: true }), { [RUNTIME_ENV.runner]: 'native', [RUNTIME_ENV.image]: 'ollama/ollama:env' });
    env.preferences.runner = 'docker';
    env.preferences.image = 'ollama/ollama:pref';
    expect((await env.runtime.up({ pull: false })).ok).toBe(true);
    expect(env.calls).toContain('spawn ollama serve OLLAMA_HOST=127.0.0.1:11434');
  });

  it('formatRuntimeState distingue disponible y deshabilitado', () => {
    const base = { runner: 'none' as const, managed: false, running: false, model: { name: 'm', present: false }, log: '', detail: 'Ollama parado · x' };
    expect(formatRuntimeState({ ...base, disabled: undefined })).toBe('runtime: Ollama parado · x');
    expect(formatRuntimeState({ ...base, disabled: 'motivo' })).toBe('runtime: no disponible · motivo');
  });
});

describe('runtime deshabilitado', () => {
  it('dentro del contenedor, con configuración inválida o con un proveedor que no es Ollama', async () => {
    const container = fakeSystem(world(), { [RUNTIME_ENV.container]: '1' });
    expect((await container.runtime.status()).disabled).toContain('docker compose');
    expect(await container.runtime.up()).toMatchObject({ ok: false, code: 'disabled' });
    expect(await container.runtime.down()).toMatchObject({ ok: false, code: 'disabled' });

    const invalid = createLlmRuntime(async () => ({ result: { ok: false, message: 'base_url no es loopback' }, runner: undefined, image: undefined }), fakeSystem(world()).system);
    expect((await invalid.status()).disabled).toBe('configuración del co-piloto inválida: base_url no es loopback');

    const other = createLlmRuntime(async () => ({ result: { ok: true, config: { ...CONFIG, provider: 'openai-compatible' } }, runner: undefined, image: undefined }), fakeSystem(world()).system);
    const state = await other.status();
    expect(state.disabled).toContain('«openai-compatible»');
    expect(state.model.name).toBe('qwen2.5:7b');
    expect(state.runner).toBe('none');
  });
});

describe('status', () => {
  it('parado: informa del runner disponible (native, docker o ninguno)', async () => {
    expect(await fakeSystem(world({ ollamaBinary: true })).runtime.status()).toMatchObject({ runner: 'native', running: false, managed: false, detail: 'Ollama parado · runner native disponible' });
    expect(await fakeSystem(world({ ollamaBinary: false, dockerBinary: true })).runtime.status()).toMatchObject({ runner: 'docker', detail: 'Ollama parado · runner docker disponible' });
    const none = await fakeSystem(world({ ollamaBinary: false, dockerBinary: false })).runtime.status();
    expect(none.runner).toBe('none');
    expect(none.detail).toContain('instala Ollama o Docker');
    expect(none.log).toBe(LOG_PATH);
  });

  it('en marcha sin que lo arrancara cv, y en marcha gestionado (pid propio vivo o contenedor propio)', async () => {
    const foreign = await fakeSystem(world({ up: true, models: ['qwen2.5:7b'] })).runtime.status();
    expect(foreign).toMatchObject({ running: true, managed: false, runner: 'none', model: { name: 'qwen2.5:7b', present: true } });
    expect(foreign.detail).toBe('Ollama en marcha (no lo arrancó cv) · modelo «qwen2.5:7b» presente');

    const files = new Map([[PID_PATH, '77\n']]);
    const native = await fakeSystem(world({ up: true, alive: new Set([77]) }), {}, files).runtime.status();
    expect(native).toMatchObject({ running: true, managed: true, runner: 'native', model: { present: false } });
    expect(native.detail).toBe('Ollama en marcha (native, lo arrancó cv) · modelo «qwen2.5:7b» no descargado');

    const docker = await fakeSystem(world({ up: true, dockerBinary: true, container: 'running' })).runtime.status();
    expect(docker).toMatchObject({ managed: true, runner: 'docker' });
  });

  it('un pid guardado que ya no vive se olvida', async () => {
    const files = new Map([[PID_PATH, '77\n']]);
    const w = world({ up: true });
    const state = await fakeSystem(w, {}, files).runtime.status();
    expect(state.managed).toBe(false);
    expect(files.has(PID_PATH)).toBe(false);
  });
});

describe('up', () => {
  it('rechaza un modelo inválido y avisa si no hay runner (detectado o forzado por opción o entorno)', async () => {
    expect(await fakeSystem(world()).runtime.up({ model: 'Mayúsculas' })).toMatchObject({ ok: false, code: 'invalid-model' });
    const none = await fakeSystem(world({ ollamaBinary: false })).runtime.up();
    expect(none).toMatchObject({ ok: false, code: 'no-runner' });
    expect(none.ok || none.message).toContain('ni Docker');
    expect(await fakeSystem(world({ ollamaBinary: false, dockerBinary: true })).runtime.up({ runner: 'native' })).toMatchObject({ ok: false, code: 'no-runner', message: 'no se encontró el binario «ollama»' });
    expect(await fakeSystem(world({ ollamaBinary: true })).runtime.up({ runner: 'docker' })).toMatchObject({ ok: false, code: 'no-runner', message: 'Docker no responde (docker)' });
    expect(await fakeSystem(world({ ollamaBinary: true }), { [RUNTIME_ENV.runner]: 'docker' }).runtime.up()).toMatchObject({ ok: false, code: 'no-runner' });
    // Un valor desconocido en el entorno se ignora: se detecta.
    expect((await fakeSystem(world({ ollamaBinary: true }), { [RUNTIME_ENV.runner]: 'podman' }).runtime.up()).ok).toBe(true);
    // Forzado y disponible: se usa el pedido aunque el otro también esté.
    const both = fakeSystem(world({ ollamaBinary: true, dockerBinary: true }));
    expect((await both.runtime.up({ runner: 'docker', pull: false })).ok).toBe(true);
    expect(both.calls).toContain(`docker run -d --name ${OLLAMA_CONTAINER} -p 127.0.0.1:11434:11434 -v chameleon-ollama:/root/.ollama ${OLLAMA_IMAGE}`);
    const nativeForced = fakeSystem(world({ ollamaBinary: true, dockerBinary: true }));
    expect((await nativeForced.runtime.up({ runner: 'native', pull: false })).ok).toBe(true);
    expect(nativeForced.calls).toContain('spawn ollama serve OLLAMA_HOST=127.0.0.1:11434');
  });

  it('native: arranca ollama serve con OLLAMA_HOST de la baseUrl, guarda el pid, descarga el modelo y lo deja listo', async () => {
    const progress: string[] = [];
    const w = world();
    const { runtime, calls, files } = fakeSystem(w);
    const result = await runtime.up({ progress: (line) => progress.push(line) });
    expect(result.ok).toBe(true);
    expect(result.ok && result.state).toMatchObject({ running: true, managed: true, runner: 'native', model: { name: 'qwen2.5:7b', present: true } });
    expect(files.get(PID_PATH)).toBe('4242\n');
    expect(calls).toContain('spawn ollama serve OLLAMA_HOST=127.0.0.1:11434');
    expect(calls).toContain('ollama pull qwen2.5:7b');
    expect(progress).toEqual([
      `Ollama arrancado (native) · registro en ${LOG_PATH}`,
      'Ollama responde en http://127.0.0.1:11434',
      'descargando el modelo «qwen2.5:7b» (native, registro de Ollama)…',
      'pulling manifest',
      'modelo «qwen2.5:7b» disponible',
    ]);
  });

  it('native: si el proceso no arranca o no responde a tiempo, lo dice (y limpia el pid)', async () => {
    expect(await fakeSystem(world({ spawnFails: true })).runtime.up()).toMatchObject({ ok: false, code: 'start-failed', message: 'no se pudo arrancar «ollama serve»: spawn ENOENT' });
    const w = world({ startsResponding: false });
    const { runtime, files } = fakeSystem(w);
    const result = await runtime.up();
    expect(result).toMatchObject({ ok: false, code: 'start-failed' });
    expect(result.ok || result.message).toContain('no respondió');
    expect(files.has(PID_PATH)).toBe(false);
    expect(w.alive.size).toBe(0);
  });

  it('docker: crea el contenedor con la imagen fijada (o la del entorno) o lo reanuda si existe; descarga con docker exec', async () => {
    const created = fakeSystem(world({ ollamaBinary: false, dockerBinary: true }));
    const result = await created.runtime.up({ model: 'llama3:8b' });
    expect(result.ok && result.state).toMatchObject({ runner: 'docker', managed: true, model: { name: 'llama3:8b', present: true } });
    expect(created.calls).toContain(`docker run -d --name ${OLLAMA_CONTAINER} -p 127.0.0.1:11434:11434 -v chameleon-ollama:/root/.ollama ${OLLAMA_IMAGE}`);
    expect(created.calls).toContain(`docker exec ${OLLAMA_CONTAINER} ollama pull llama3:8b`);
    expect(result.ok && result.lines[0]).toBe(`contenedor ${OLLAMA_CONTAINER} creado (docker, imagen ${OLLAMA_IMAGE})`);

    const resumed = fakeSystem(world({ ollamaBinary: false, dockerBinary: true, container: 'stopped' }), { [RUNTIME_ENV.image]: 'ollama/ollama:latest' });
    const again = await resumed.runtime.up({ pull: false });
    expect(resumed.calls).toContain(`docker start ${OLLAMA_CONTAINER}`);
    expect(again.ok && again.lines).toEqual([`contenedor ${OLLAMA_CONTAINER} reanudado (docker)`, 'Ollama responde en http://127.0.0.1:11434', 'el modelo «qwen2.5:7b» no está descargado (--no-pull)']);
  });

  it('docker: fallo al crear el contenedor y contenedor que no responde', async () => {
    const failing = fakeSystem(world({ ollamaBinary: false, dockerBinary: true, startsResponding: false }), { DOCKER_FAILS: '1' });
    expect(await failing.runtime.up()).toMatchObject({ ok: false, code: 'start-failed', message: `no se pudo arrancar el contenedor ${OLLAMA_CONTAINER}: docker: port is already allocated` });
    const quiet = fakeSystem(world({ ollamaBinary: false, dockerBinary: true, startsResponding: false }), { DOCKER_FAILS: '2' });
    expect(await quiet.runtime.up()).toMatchObject({ ok: false, code: 'start-failed', message: `no se pudo arrancar el contenedor ${OLLAMA_CONTAINER}: exit 125` });
    const silent = fakeSystem(world({ ollamaBinary: false, dockerBinary: true, container: 'stopped', startsResponding: false }));
    const result = await silent.runtime.up();
    expect(result).toMatchObject({ ok: false, code: 'start-failed' });
    expect(result.ok || result.message).toContain('docker logs');
  });

  it('ya en marcha: no lo toca; descarga el modelo con el binario disponible o avisa de que no hay con qué', async () => {
    const foreign = fakeSystem(world({ up: true }));
    const result = await foreign.runtime.up();
    expect(result.ok && result.lines).toEqual(['Ollama ya está en marcha (no lo arrancó cv): no se toca', 'descargando el modelo «qwen2.5:7b» (native, registro de Ollama)…', 'pulling manifest', 'modelo «qwen2.5:7b» disponible']);
    expect(foreign.calls).not.toContain('spawn ollama serve OLLAMA_HOST=127.0.0.1:11434');

    const managed = fakeSystem(world({ up: true, alive: new Set([9]), models: ['qwen2.5:7b'] }), {}, new Map([[PID_PATH, '9']]));
    const ready = await managed.runtime.up();
    expect(ready.ok && ready.lines).toEqual(['Ollama ya está en marcha (native, lo arrancó cv)', 'modelo «qwen2.5:7b» disponible']);

    const nothing = fakeSystem(world({ up: true, ollamaBinary: false }));
    expect(await nothing.runtime.up()).toMatchObject({ ok: false, code: 'pull-failed', message: 'no hay «ollama» ni Docker para descargar «qwen2.5:7b»' });

    const viaDocker = fakeSystem(world({ up: true, ollamaBinary: false, dockerBinary: true }));
    const pulled = await viaDocker.runtime.up();
    expect(pulled.ok).toBe(true);
    expect(viaDocker.calls).toContain(`docker exec ${OLLAMA_CONTAINER} ollama pull qwen2.5:7b`);
  });

  it('descarga fallida (native y docker) y modelo que sigue sin aparecer', async () => {
    const native = await fakeSystem(world({ up: true, pullFails: true })).runtime.up();
    expect(native).toMatchObject({ ok: false, code: 'pull-failed', message: 'la descarga de «qwen2.5:7b» falló: Error: model not found' });
    const docker = await fakeSystem(world({ up: true, ollamaBinary: false, dockerBinary: true, pullFails: true })).runtime.up();
    expect(docker).toMatchObject({ ok: false, code: 'pull-failed', message: 'la descarga de «qwen2.5:7b» falló: exit 1' });
    // La descarga «termina» pero Ollama no lista el modelo (nombre que el registro normaliza de otra forma).
    const w = world({ up: true });
    const { system, runtime } = fakeSystem(w);
    const original = system.exec;
    (system as { exec: RuntimeSystem['exec'] }).exec = async (command, args, options) => {
      const result = await original(command, args, options);
      if (args[0] === 'pull') {
        w.models.length = 0;
      }
      return result;
    };
    const result = await runtime.up();
    expect(result.ok && result.lines.at(-1)).toBe('Ollama no lista «qwen2.5:7b» tras la descarga');
  });

  it('rutas de binarios: relativas al directorio de trabajo, absolutas o nombres del PATH', async () => {
    const relative = fakeSystem(world(), { [RUNTIME_ENV.ollama]: 'tools/ollama' });
    await relative.runtime.up({ pull: false });
    expect(relative.calls).toContain('/work/tools/ollama --version');
    const absolute = fakeSystem(world({ ollamaBinary: false, dockerBinary: true }), { [RUNTIME_ENV.docker]: '/usr/local/bin/docker', [RUNTIME_ENV.ollama]: ' ' });
    await absolute.runtime.up({ pull: false });
    expect(absolute.calls).toContain('/usr/local/bin/docker version --format {{.Server.Version}}');
    expect(absolute.calls).toContain('ollama --version');
    const bare = fakeSystem(world(), { [RUNTIME_ENV.ollama]: 'ollama-custom' });
    await bare.runtime.up({ pull: false });
    expect(bare.calls).toContain('ollama-custom --version');
    const windows = fakeSystem(world({ ollamaBinary: false, dockerBinary: true }), { [RUNTIME_ENV.docker]: 'tools\\docker.exe' });
    await windows.runtime.up({ pull: false });
    expect(windows.calls).toContain('/work/tools\\docker.exe version --format {{.Server.Version}}');
  });
});

describe('down', () => {
  it('sin nada en marcha informa; en marcha sin que lo arrancara cv se niega', async () => {
    const idle = await fakeSystem(world()).runtime.down();
    expect(idle.ok && idle.lines).toEqual(['Ollama no está en marcha']);
    expect(await fakeSystem(world({ up: true })).runtime.down()).toMatchObject({ ok: false, code: 'not-managed' });
  });

  it('native: termina el proceso propio y borra el pid; si no muere, lo dice', async () => {
    const files = new Map([[PID_PATH, '55\n']]);
    const w = world({ up: true, alive: new Set([55]) });
    const result = await fakeSystem(w, {}, files).runtime.down();
    expect(result.ok && result.lines).toEqual(['Ollama detenido (native)']);
    expect(result.ok && result.state.running).toBe(false);
    expect(files.has(PID_PATH)).toBe(false);
    const stubborn = await fakeSystem(world({ up: true, alive: new Set([56]) }), { STUBBORN: '1' }, new Map([[PID_PATH, '56']])).runtime.down();
    expect(stubborn).toMatchObject({ ok: false, code: 'stop-failed', message: 'el proceso 56 de Ollama no terminó en 15 s' });
  });

  it('docker: para el contenedor propio conservándolo; si no se puede, lo dice', async () => {
    const w = world({ up: true, dockerBinary: true, container: 'running' });
    const { runtime, calls } = fakeSystem(w);
    const result = await runtime.down();
    expect(result.ok && result.lines).toEqual([`Ollama detenido (docker; el contenedor ${OLLAMA_CONTAINER} y sus modelos se conservan)`]);
    expect(calls).toContain(`docker stop ${OLLAMA_CONTAINER}`);
    expect(w.container).toBe('stopped');
    const failing = await fakeSystem(world({ up: true, dockerBinary: true, container: 'running' }), { DOCKER_STOP_FAILS: '1' }).runtime.down();
    expect(failing).toMatchObject({ ok: false, code: 'stop-failed', message: `no se pudo parar el contenedor ${OLLAMA_CONTAINER}: cannot stop` });
    const quiet = await fakeSystem(world({ up: true, dockerBinary: true, container: 'running' }), { DOCKER_STOP_FAILS: '2' }).runtime.down();
    expect(quiet).toMatchObject({ ok: false, code: 'stop-failed', message: `no se pudo parar el contenedor ${OLLAMA_CONTAINER}: exit 1` });
  });
});

describe('espejo de Hugging Face y catálogo (T-8.13)', () => {
  const MIRROR = 'hf.co/unsloth/Qwen3-8B-GGUF:Q4_K_M';

  it('si el registro falla y el catálogo tiene espejo, descarga el espejo y crea el alias (native y docker)', async () => {
    const native = fakeSystem(world({ up: true, registryDown: true }));
    const result = await native.runtime.up({ model: 'qwen3:8b' });
    expect(result.ok).toBe(true);
    expect(result.lines).toEqual([
      'Ollama ya está en marcha (no lo arrancó cv): no se toca',
      'descargando el modelo «qwen3:8b» (native, registro de Ollama)…',
      'pulling manifest',
      `el registro de Ollama falló (Error: max retries exceeded); se intenta el espejo «${MIRROR}» en huggingface.co`,
      'pulling manifest',
      'pulling manifest',
      `alias «qwen3:8b» creado a partir de «${MIRROR}»`,
      'modelo «qwen3:8b» disponible',
    ]);
    expect(native.calls.filter((call) => call.includes(' pull ') || call.includes(' cp '))).toEqual(['ollama pull qwen3:8b', `ollama pull ${MIRROR}`, `ollama cp ${MIRROR} qwen3:8b`]);
    const docker = fakeSystem(world({ up: true, container: 'running', ollamaBinary: false, dockerBinary: true, registryDown: true }));
    const viaDocker = await docker.runtime.up({ model: 'qwen3:8b' });
    expect(viaDocker.ok).toBe(true);
    expect(docker.calls.filter((call) => call.includes('ollama pull') || call.includes('ollama cp'))).toEqual([
      `docker exec ${OLLAMA_CONTAINER} ollama pull qwen3:8b`,
      `docker exec ${OLLAMA_CONTAINER} ollama pull ${MIRROR}`,
      `docker exec ${OLLAMA_CONTAINER} ollama cp ${MIRROR} qwen3:8b`,
    ]);
  });

  it('--source huggingface va directo al espejo; sin espejo en el catálogo o fuera de él, lo explica sin tocar el registro', async () => {
    const direct = fakeSystem(world({ up: true }));
    const result = await direct.runtime.up({ model: 'qwen3:8b', source: 'huggingface' });
    expect(result.ok).toBe(true);
    expect(result.lines).toContain(`descargando «${MIRROR}» desde huggingface.co (native)…`);
    expect(direct.calls.some((call) => call === 'ollama pull qwen3:8b')).toBe(false);
    const noMirror = await fakeSystem(world({ up: true })).runtime.up({ model: 'gpt-oss:20b', source: 'huggingface' });
    expect(noMirror).toMatchObject({ ok: false, code: 'pull-failed', message: '«gpt-oss:20b» no tiene espejo en Hugging Face en el catálogo (cv llm models); descárgalo del registro de Ollama' });
    const unknown = await fakeSystem(world({ up: true, registryDown: true })).runtime.up({ model: 'llama3:8b' });
    expect(unknown).toMatchObject({ ok: false, code: 'pull-failed', message: 'la descarga de «llama3:8b» falló: Error: max retries exceeded' });
  });

  it('el espejo que falla o el alias que no se puede crear se explican', async () => {
    const mirrorFails = await fakeSystem(world({ up: true, registryDown: true, pullFails: true })).runtime.up({ model: 'qwen3:8b' });
    expect(mirrorFails).toMatchObject({ ok: false, code: 'pull-failed', message: `la descarga de «${MIRROR}» falló: Error: model not found` });
    const aliasFails = await fakeSystem(world({ up: true, registryDown: true, cpFails: true })).runtime.up({ model: 'qwen3:8b' });
    expect(aliasFails).toMatchObject({ ok: false, code: 'pull-failed', message: `no se pudo crear el alias «qwen3:8b» de «${MIRROR}»: cannot copy` });
    const silent = await fakeSystem(world({ up: true, container: 'running', ollamaBinary: false, dockerBinary: true, registryDown: true, pullFails: true })).runtime.up({ model: 'qwen3:8b' });
    expect(silent).toMatchObject({ ok: false, message: `la descarga de «${MIRROR}» falló: exit 1` });
    const onlyCode = await fakeSystem(world({ up: true, registryDown: true, pullFails: true }), { PULL_SILENT: '1' }).runtime.up({ model: 'qwen3:8b' });
    expect(onlyCode).toMatchObject({ ok: false, message: `la descarga de «${MIRROR}» falló: código 1` });
    const nothing = await fakeSystem(world({ up: true, registryDown: true, pullFails: true }), { PULL_SILENT: '2' }).runtime.up({ model: 'qwen3:8b' });
    expect(nothing).toMatchObject({ ok: false, message: `la descarga de «${MIRROR}» falló: código ?` });
  });

  it('models(): el catálogo con lo descargado (tamaños, configurado, otros modelos) o sin comprobar si Ollama no responde; deshabilitado con el motivo', async () => {
    const running = fakeSystem(world({ up: true, models: ['qwen3:8b:latest', MIRROR], sizes: { 'qwen3:8b:latest': 5_000_000_000, [MIRROR]: 5_000_000_000 } }), {}, new Map(), { ...CONFIG, model: 'qwen3:8b' });
    const state = await running.runtime.models();
    expect(state.running).toBe(true);
    expect(state.disabled).toBeUndefined();
    expect(state.catalogue.map((entry) => [entry.id, entry.present, entry.sizeBytes, entry.configured])).toEqual([
      ['qwen3:8b', true, 5_000_000_000, true],
      ['qwen2.5:7b-instruct', false, undefined, false],
      ['deepseek-r1:8b', false, undefined, false],
      ['gpt-oss:20b', false, undefined, false],
      ['qwen3:4b', false, undefined, false],
    ]);
    expect(state.others).toEqual([{ name: MIRROR, sizeBytes: 5_000_000_000 }]);
    const stopped = await fakeSystem(world()).runtime.models();
    expect(stopped).toMatchObject({ running: false, disabled: undefined, others: [] });
    expect(stopped.catalogue.every((entry) => !entry.present && entry.sizeBytes === undefined)).toBe(true);
    const disabled = await fakeSystem(world(), { [RUNTIME_ENV.container]: '1' }).runtime.models();
    expect(disabled).toMatchObject({ running: false, disabled: expect.stringContaining('Compose') as string, others: [] });
    expect(disabled.catalogue.map((entry) => entry.configured)).toEqual([false, false, false, false, false]);
  });

  it('formatLocalModels: una línea por modelo con lo descargado, razonamiento, tamaño, RAM, licencia y tareas; otros modelos y avisos', async () => {
    const running = fakeSystem(world({ up: true, models: ['qwen3:8b', 'llama3:8b'], sizes: { 'qwen3:8b': 5_368_709_120 } }), {}, new Map(), { ...CONFIG, model: 'qwen3:8b' });
    const lines = formatLocalModels(await running.runtime.models());
    expect(lines[0]).toBe('qwen3:8b             descargado (5.0 GiB)   razonamiento conmutable  5.2 GiB · RAM ≥ 8 GiB · Apache-2.0 · improve, summarize, suggest-tags · configurado');
    expect(lines[1]).toBe('qwen2.5:7b-instruct  no descargado          sin razonamiento         4.7 GiB · RAM ≥ 8 GiB · Apache-2.0 · improve, summarize, suggest-tags');
    expect(lines[2]).toBe('deepseek-r1:8b       no descargado          razona siempre           5.2 GiB · RAM ≥ 8 GiB · MIT · sin tareas recomendadas');
    expect(lines[3]).toContain('gpt-oss:20b          no descargado          razonamiento conmutable  14 GiB · RAM ≥ 16 GiB · Apache-2.0 · improve, summarize, suggest-tags · sin espejo');
    expect(lines[5]).toBe('Otros modelos presentes: llama3:8b');
    // Ollama sin tamaños en /api/tags: «descargado» a secas.
    const noSizes = formatLocalModels(await fakeSystem(world({ up: true, models: ['qwen3:8b'] })).runtime.models());
    expect(noSizes[0]).toBe('qwen3:8b             descargado             razonamiento conmutable  5.2 GiB · RAM ≥ 8 GiB · Apache-2.0 · improve, summarize, suggest-tags');
    const stopped = formatLocalModels(await fakeSystem(world()).runtime.models());
    expect(stopped[0]).toBe('Ollama parado: no se puede comprobar qué modelos están descargados (cv llm up)');
    expect(stopped[1]).toContain('qwen3:8b             sin comprobar');
    const disabled = formatLocalModels(await fakeSystem(world(), { [RUNTIME_ENV.container]: '1' }).runtime.models());
    expect(disabled[0]).toMatch(/^Ollama no disponible \(dentro del contenedor de Compose/);
    expect(isModelSource('huggingface')).toBe(true);
    expect(isModelSource('github')).toBe(false);
  });
});
