import { describe, expect, it } from 'vitest';

import { defaultAssets } from '../../src/shared/assets';
import { EXIT_FAILURE, EXIT_OK, runCli, type CliContext } from '../../src/cli';
import { MemoryLlmCache, type LlmStatus } from '../../src/llm';
import { defaultSourceParsers } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import { renderTypstCv } from '../../src/renderers/typst';
import { installTypst, typstStatus } from '../../src/typst';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const NO_SETTINGS = { path: undefined, present: false, configured: false, error: undefined } as const;

function harness(status: LlmStatus): { context: CliContext; stdout: () => string } {
  const out: string[] = [];
  const fs = new MemoryFileSystem();
  const context: CliContext = {
    cwd: '/work',
    stdout: (text) => {
      out.push(text);
    },
    stderr: () => undefined,
    stdin: () => Promise.resolve(''),
    datasetFileSystem: fs,
    artifactFileSystem: fs,
    parsers: defaultSourceParsers(),
    pdfExtractor: (bytes) => extractPdfText(bytes),
    typstRenderer: (profile, options) => renderTypstCv(profile, options),
    typstInstall: (options, report) => installTypst(options, report),
    typstStatus: (options) => typstStatus(options),
    llmStatus: () => Promise.resolve(status),
    llmProvider: () => Promise.resolve({ ok: false as const, message: 'sin proveedor en las pruebas' }),
    llmCache: new MemoryLlmCache(),
    assets: defaultAssets(),
  };
  return { context, stdout: () => out.join('') };
}

const CONFIG = { provider: 'ollama' as const, baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b-instruct', sources: { provider: 'default' as const, baseUrl: 'default' as const, model: 'default' as const } };

describe('cv llm status', () => {
  it('imprime el estado y sale con 0 si el proveedor local es utilizable, con 2 si no', async () => {
    const usable = harness({ config: CONFIG, configError: undefined, health: { ok: true, version: '0.33.1', models: ['qwen2.5:7b-instruct'], modelAvailable: true }, keys: { openai: 'none', anthropic: 'none', groq: 'none' }, keysFile: '/h/.config/chameleon-cv/keys.json', settings: NO_SETTINGS, providers: [], allowedHosts: ['api.openai.com', 'api.anthropic.com'], remote: undefined, usable: true });
    expect(await runCli(['llm', 'status'], usable.context)).toBe(EXIT_OK);
    expect(usable.stdout()).toContain('Estado: alcanzable · versión 0.33.1 · 1 modelo (qwen2.5:7b-instruct) · el modelo configurado está disponible\n');

    const down = harness({ config: CONFIG, configError: undefined, health: { ok: false, code: 'unreachable', message: 'ECONNREFUSED' }, keys: { openai: 'none', anthropic: 'none', groq: 'none' }, keysFile: '/h/.config/chameleon-cv/keys.json', settings: NO_SETTINGS, providers: [], allowedHosts: ['api.openai.com', 'api.anthropic.com'], remote: undefined, usable: false });
    expect(await runCli(['llm', 'status'], down.context)).toBe(EXIT_FAILURE);
    expect(down.stdout()).toContain('Estado: no disponible · ECONNREFUSED');
  });

  it('la ayuda del grupo llm deja claro que nunca envía datos sin una orden explícita', async () => {
    const h = harness({ config: CONFIG, configError: undefined, health: undefined, keys: { openai: 'none', anthropic: 'none', groq: 'none' }, keysFile: '/h/.config/chameleon-cv/keys.json', settings: NO_SETTINGS, providers: [], allowedHosts: ['api.openai.com', 'api.anthropic.com'], remote: undefined, usable: false });
    await runCli(['llm', '--help'], h.context);
    expect(h.stdout().replace(/\s+/g, ' ')).toContain('nunca envía datos sin una orden explícita');
  });
});

describe('cv llm status --provider <remoto>', () => {
  const base = { config: CONFIG, configError: undefined, health: { ok: true as const, version: undefined, models: ['qwen2.5:7b-instruct'], modelAvailable: true }, keys: { openai: 'env' as const, anthropic: 'none' as const, groq: 'none' as const }, keysFile: '/h/.config/chameleon-cv/keys.json', settings: NO_SETTINGS, providers: [], allowedHosts: ['api.openai.com', 'api.anthropic.com'], usable: true };

  it('comprueba el remoto pedido y sale con 0 si responde con el modelo, con 2 si no', async () => {
    const ok = harness({ ...base, remote: { id: 'openai', baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini', keySource: 'env', health: { ok: true, version: undefined, models: ['gpt-4o-mini', 'gpt-4o'], modelAvailable: true } } });
    expect(await runCli(['llm', 'status', '--provider', 'openai'], ok.context)).toBe(EXIT_OK);
    expect(ok.stdout()).toContain('Proveedores remotos (solo con --provider explícito):\nFichero de claves: /h/.config/chameleon-cv/keys.json\n');
    expect(ok.stdout()).toContain('Lista blanca de hosts: api.openai.com, api.anthropic.com\n');
    expect(ok.stdout()).toContain('Remoto openai (https://api.openai.com; modelo gpt-4o-mini; clave del entorno): alcanzable · 2 modelos (gpt-4o-mini, gpt-4o) · el modelo configurado está disponible\n');

    const missing = harness({ ...base, remote: { id: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'x', keySource: 'file', health: { ok: true, version: undefined, models: ['claude'], modelAvailable: false } } });
    expect(await runCli(['llm', 'status', '--provider', 'anthropic', '--model', 'x'], missing.context)).toBe(EXIT_FAILURE);
    expect(missing.stdout()).toContain('clave del fichero): alcanzable · 1 modelo (claude) · el modelo configurado «x» no está disponible\n');

    const error = harness({ ...base, usable: false, remote: { error: 'No hay clave para «openai»' } });
    expect(await runCli(['llm', 'status', '--provider', 'openai'], error.context)).toBe(EXIT_FAILURE);
    expect(error.stdout()).toContain('Remoto: No hay clave para «openai»\n');
  });
});

/* ─────────────────────────── cv llm up / down (T-8.8) ─────────────────────────── */

import { LOCAL_MODELS, type LlmRuntime, type LocalModelsState, type RuntimeResult, type RuntimeState, type RuntimeUpOptions } from '../../src/llm';

const RUNNING: RuntimeState = {
  runner: 'native',
  candidates: { native: { available: true, reason: 'binario «ollama» (0.33.2)' }, docker: { available: false, reason: 'Docker no responde («docker»)' } }, plan: { runner: 'native' as const, note: 'binario «ollama» (0.33.2)' },
  managed: true,
  running: true,
  model: { name: 'qwen2.5:7b-instruct', present: true },
  log: '/h/.cache/chameleon-cv/ollama/serve.log',
  disabled: undefined,
  detail: 'Ollama en marcha (native, lo arrancó cv) · modelo «qwen2.5:7b-instruct» presente',
};
const STOPPED: RuntimeState = { ...RUNNING, managed: false, running: false, model: { name: 'qwen2.5:7b-instruct', present: false }, detail: 'Ollama parado · runner native disponible' };

function fakeRuntime(up: RuntimeResult, down: RuntimeResult): LlmRuntime & { readonly ups: RuntimeUpOptions[]; downs: number } {
  const ups: RuntimeUpOptions[] = [];
  const runtime = {
    ups,
    downs: 0,
    status: async () => RUNNING,
    up: async (options: RuntimeUpOptions = {}) => {
      ups.push(options);
      if (up.ok) {
        for (const line of up.lines) {
          options.progress?.(line);
        }
      }
      return up;
    },
    down: async () => {
      runtime.downs += 1;
      return down;
    },
    models: async () => MODELS,
  };
  return runtime;
}

/** Catálogo con lo descargado (T-8.13): el modelo por defecto presente y configurado; el resto, no. */
const MODELS: LocalModelsState = {
  catalogue: LOCAL_MODELS.map((entry) => ({ ...entry, present: entry.id === 'qwen2.5:7b-instruct', sizeBytes: entry.id === 'qwen2.5:7b-instruct' ? 4_683_087_332 : undefined, configured: entry.id === 'qwen2.5:7b-instruct' })),
  others: [{ name: 'hf.co/unsloth/Qwen3-8B-GGUF:Q4_K_M', sizeBytes: 5_027_000_000 }],
  running: true,
  disabled: undefined,
};

const RUNTIME_STATUS: LlmStatus = {
  config: CONFIG,
  configError: undefined,
  health: { ok: true, version: '0.33.2', models: ['qwen2.5:7b-instruct'], modelAvailable: true },
  keys: { openai: 'none', anthropic: 'none', groq: 'none' },
  keysFile: '/h/.config/chameleon-cv/keys.json',
  allowedHosts: [],
  remote: undefined,
  usable: true,
  settings: NO_SETTINGS,
  providers: [],
};

function runtimeHarness(runtime: LlmRuntime | undefined): { context: CliContext; stdout: () => string; stderr: () => string } {
  const base = harness(RUNTIME_STATUS);
  const err: string[] = [];
  const context: CliContext = { ...base.context, stderr: (text) => void err.push(text), ...(runtime === undefined ? {} : { llmRuntime: runtime }) };
  return { context, stdout: base.stdout, stderr: () => err.join('') };
}

const UP_OK: RuntimeResult = { ok: true, state: RUNNING, lines: ['Ollama arrancado (native) · registro en /h/.cache/chameleon-cv/ollama/serve.log', 'modelo «qwen2.5:7b-instruct» disponible'] };
const DOWN_OK: RuntimeResult = { ok: true, state: STOPPED, lines: ['Ollama detenido (native)'] };

describe('cv llm up / down', () => {
  it('llm status añade la línea del runtime cuando el contexto lo tiene', async () => {
    const h = runtimeHarness(fakeRuntime(UP_OK, DOWN_OK));
    expect(await runCli(['llm', 'status'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('runtime: Ollama en marcha (native, lo arrancó cv) · modelo «qwen2.5:7b-instruct» presente');
  });

  it('up: pasa modelo, runner y --no-pull, imprime el progreso y el estado final', async () => {
    const runtime = fakeRuntime(UP_OK, DOWN_OK);
    const h = runtimeHarness(runtime);
    expect(await runCli(['llm', 'up', '--model', 'llama3:8b', '--runner', 'Docker', '--no-pull'], h.context)).toBe(EXIT_OK);
    expect(runtime.ups[0]).toMatchObject({ model: 'llama3:8b', runner: 'docker', pull: false });
    expect(h.stdout()).toBe(
      'Ollama arrancado (native) · registro en /h/.cache/chameleon-cv/ollama/serve.log\nmodelo «qwen2.5:7b-instruct» disponible\nruntime: Ollama en marcha (native, lo arrancó cv) · modelo «qwen2.5:7b-instruct» presente\n',
    );
  });

  it('up --json: el resultado íntegro y ningún progreso suelto; sin opciones, todo por defecto', async () => {
    const runtime = fakeRuntime(UP_OK, DOWN_OK);
    const h = runtimeHarness(runtime);
    expect(await runCli(['llm', 'up', '--json'], h.context)).toBe(EXIT_OK);
    expect(JSON.parse(h.stdout())).toEqual(UP_OK);
    expect(runtime.ups[0]).toMatchObject({ model: undefined, runner: undefined, pull: true });
    expect(runtime.ups[0]?.progress).toBeUndefined();
  });

  it('up: los fallos van a stderr con salida 2 (o 1 si el modelo es inválido); --runner desconocido es un error de uso', async () => {
    const failing = runtimeHarness(fakeRuntime({ ok: false, code: 'no-runner', message: 'no hay «ollama» ni Docker', lines: [] }, DOWN_OK));
    expect(await runCli(['llm', 'up'], failing.context)).toBe(EXIT_FAILURE);
    expect(failing.stderr()).toBe('no hay «ollama» ni Docker\n');
    const invalid = runtimeHarness(fakeRuntime({ ok: false, code: 'invalid-model', message: 'nombre de modelo inválido', lines: [] }, DOWN_OK));
    expect(await runCli(['llm', 'up', '--json'], invalid.context)).toBe(1);
    expect(JSON.parse(invalid.stdout())).toMatchObject({ ok: false, code: 'invalid-model' });
    const runner = runtimeHarness(fakeRuntime(UP_OK, DOWN_OK));
    expect(await runCli(['llm', 'up', '--runner', 'podman'], runner.context)).toBe(1);
    expect(runner.stderr()).toBe('--runner debe ser native o docker (no «podman»)\n');
  });

  it('down: imprime lo hecho y el estado; --json devuelve el resultado; un Ollama ajeno no se para', async () => {
    const runtime = fakeRuntime(UP_OK, DOWN_OK);
    const h = runtimeHarness(runtime);
    expect(await runCli(['llm', 'down'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe('Ollama detenido (native)\nruntime: Ollama parado · runner native disponible\n');
    expect(runtime.downs).toBe(1);
    const json = runtimeHarness(fakeRuntime(UP_OK, DOWN_OK));
    expect(await runCli(['llm', 'down', '--json'], json.context)).toBe(EXIT_OK);
    expect(JSON.parse(json.stdout())).toEqual(DOWN_OK);
    const foreign = runtimeHarness(fakeRuntime(UP_OK, { ok: false, code: 'not-managed', message: 'Ollama está en marcha pero no lo arrancó cv', lines: [] }));
    expect(await runCli(['llm', 'down'], foreign.context)).toBe(EXIT_FAILURE);
    expect(foreign.stderr()).toBe('Ollama está en marcha pero no lo arrancó cv\n');
  });

  it('sin runtime en el contexto, up, down y models lo dicen y fallan', async () => {
    const h = runtimeHarness(undefined);
    expect(await runCli(['llm', 'up'], h.context)).toBe(EXIT_FAILURE);
    expect(await runCli(['llm', 'down'], h.context)).toBe(EXIT_FAILURE);
    expect(await runCli(['llm', 'models'], h.context)).toBe(EXIT_FAILURE);
    expect(h.stderr()).toBe('El runtime de Ollama no está disponible en este contexto\n'.repeat(3));
  });

  it('up --source pasa el origen al runtime (ollama o huggingface) y rechaza otro valor como error de uso (T-8.13)', async () => {
    const runtime = fakeRuntime(UP_OK, DOWN_OK);
    const h = runtimeHarness(runtime);
    expect(await runCli(['llm', 'up', '--model', 'qwen3:8b', '--source', 'HuggingFace', '--json'], h.context)).toBe(EXIT_OK);
    expect(runtime.ups[0]).toMatchObject({ model: 'qwen3:8b', source: 'huggingface' });
    expect(await runCli(['llm', 'up', '--source', 'github'], h.context)).toBe(1);
    expect(h.stderr()).toBe('--source debe ser ollama o huggingface (no «github»)\n');
    expect(runtime.ups).toHaveLength(1);
  });

  it('models: el catálogo con lo descargado, una línea por modelo y la pista en stderr; --json devuelve el estado íntegro (T-8.13)', async () => {
    const h = runtimeHarness(fakeRuntime(UP_OK, DOWN_OK));
    expect(await runCli(['llm', 'models'], h.context)).toBe(EXIT_OK);
    const lines = h.stdout().split('\n');
    expect(lines[0]).toBe('qwen3:8b             no descargado          razonamiento conmutable  5.2 GiB · RAM ≥ 8 GiB · Apache-2.0 · improve, summarize, suggest-tags');
    expect(lines[1]).toBe('qwen2.5:7b-instruct  descargado (4.4 GiB)   sin razonamiento         4.7 GiB · RAM ≥ 8 GiB · Apache-2.0 · improve, summarize, suggest-tags · configurado');
    expect(lines[5]).toBe('Otros modelos presentes: hf.co/unsloth/Qwen3-8B-GGUF:Q4_K_M (4.7 GiB)');
    expect(h.stderr()).toBe('Descarga uno con «cv llm up --model <id>» (registro de Ollama; si falla, el espejo de Hugging Face del catálogo) o fíjalo con [llm] model en cv.toml\n');
    const json = runtimeHarness(fakeRuntime(UP_OK, DOWN_OK));
    expect(await runCli(['llm', 'models', '--json'], json.context)).toBe(EXIT_OK);
    expect(JSON.parse(json.stdout())).toEqual(MODELS);
    expect(json.stderr()).toBe('');
  });
});
