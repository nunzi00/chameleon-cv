import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { PassThrough } from 'node:stream';

import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK, askSecretInTerminal, createNodeContext, runCli, type CliContext } from '../../src/cli';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

interface Harness {
  readonly context: CliContext;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

function harness(stdin = '', readSecret?: (question: string) => Promise<string>): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const context: CliContext = {
    ...appContext(new MemoryFileSystem()),
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
    stdin: () => Promise.resolve(stdin),
    ...(readSecret === undefined ? {} : { readSecret }),
  };
  return { context, stdout: () => out.join(''), stderr: () => err.join('') };
}

let configHome: string;

beforeAll(async () => {
  configHome = await mkdtemp(join(tmpdir(), 'cv-key-cli-'));
  vi.stubEnv('XDG_CONFIG_HOME', configHome);
  vi.stubEnv('CHAMELEON_OPENAI_API_KEY', '');
  vi.stubEnv('CHAMELEON_ANTHROPIC_API_KEY', '');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(configHome, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cv llm key', () => {
  const keysFile = (): string => join(configHome, 'chameleon-cv', 'keys.json');

  it('set lee la clave de la entrada estándar sin terminal, o la pregunta sin eco con ella; list y remove informan sin mostrar valores', async () => {
    const fromStdin = harness('sk-por-stdin\n');
    expect(await runCli(['llm', 'key', 'set', 'OpenAI'], fromStdin.context)).toBe(EXIT_OK);
    expect(fromStdin.stdout()).toBe(`Clave de «openai» guardada en ${keysFile()} (permisos 0600)\n`);
    expect(fromStdin.stdout()).not.toContain('sk-por-stdin');
    expect(JSON.parse(await readFile(keysFile(), 'utf8'))).toEqual({ openai: 'sk-por-stdin' });

    const asked: string[] = [];
    const interactive = harness('ignorada', (question) => {
      asked.push(question);
      return Promise.resolve('sk-preguntada');
    });
    expect(await runCli(['llm', 'key', 'set', 'anthropic'], interactive.context)).toBe(EXIT_OK);
    expect(asked).toEqual(['Clave de anthropic (no se mostrará): ']);
    expect(JSON.parse(await readFile(keysFile(), 'utf8'))).toEqual({ openai: 'sk-por-stdin', anthropic: 'sk-preguntada' });

    const list = harness();
    expect(await runCli(['llm', 'key', 'list'], list.context)).toBe(EXIT_OK);
    expect(list.stdout()).toBe(`Fichero de claves: ${keysFile()}\nopenai: fichero de claves\nanthropic: fichero de claves\ngroq: ninguna\ngemini: ninguna\n`);

    const remove = harness();
    expect(await runCli(['llm', 'key', 'remove', 'openai'], remove.context)).toBe(EXIT_OK);
    expect(remove.stdout()).toBe(`Clave de «openai» eliminada de ${keysFile()}\n`);
    const again = harness();
    expect(await runCli(['llm', 'key', 'remove', 'openai'], again.context)).toBe(EXIT_OK);
    expect(again.stdout()).toBe(`No había clave de «openai» en ${keysFile()}\n`);
  });

  it('errores: proveedor desconocido (1), clave vacía (2), fichero inseguro (2) y list con permisos abiertos', async () => {
    const unknown = harness('sk');
    expect(await runCli(['llm', 'key', 'set', 'grok'], unknown.context)).toBe(EXIT_DATA_ERROR);
    expect(unknown.stderr()).toBe('«grok» no es un proveedor remoto conocido (openai, anthropic, groq, gemini)\n');
    expect(await runCli(['llm', 'key', 'remove', 'grok'], unknown.context)).toBe(EXIT_DATA_ERROR);
    const empty = harness('   \n');
    expect(await runCli(['llm', 'key', 'set', 'openai'], empty.context)).toBe(EXIT_FAILURE);
    expect(empty.stderr()).toBe('La clave está vacía\n');
    await chmod(keysFile(), 0o644);
    const insecure = harness('sk');
    expect(await runCli(['llm', 'key', 'set', 'openai'], insecure.context)).toBe(EXIT_FAILURE);
    expect(insecure.stderr()).toMatch(/legible por otros usuarios/);
    const removeInsecure = harness();
    expect(await runCli(['llm', 'key', 'remove', 'anthropic'], removeInsecure.context)).toBe(EXIT_FAILURE);
    const list = harness();
    expect(await runCli(['llm', 'key', 'list'], list.context)).toBe(EXIT_OK);
    expect(list.stdout()).toContain('anthropic: fichero de claves con permisos abiertos (chmod 600)');
    await chmod(keysFile(), 0o600);
  });

  it('el contexto de Node lee cv.toml para el co-piloto y solo instala readSecret con terminal', async () => {
    expect(createNodeContext({ interactive: false }).readSecret).toBeUndefined();
    expect(typeof createNodeContext({ interactive: true }).readSecret).toBe('function');
    const selection = await createNodeContext({ interactive: false }).llmProvider({ provider: 'gemini' });
    expect(selection).toMatchObject({ ok: false, message: expect.stringContaining('pendiente de la verificación al alta') as string });
    const status = await createNodeContext({ interactive: false }).llmStatus({ env: { CHAMELEON_LLM_BASE_URL: 'http://127.0.0.1:9' } });
    expect(status.settings.path).toBe(join(process.cwd(), 'cv.toml'));
  });

  it('askSecretInTerminal muestra la pregunta pero no lo tecleado; Retroceso borra; Ctrl-C cancela; con TTY usa el modo raw', async () => {
    const output = new PassThrough();
    const input = new PassThrough();
    const pending = askSecretInTerminal('Clave: ', input, output);
    input.write('sk-sup');
    input.write('er-secretx\u007f' + 'a\r');
    expect(await pending).toBe('sk-super-secreta');
    let shown = '';
    for (let chunk = output.read(); chunk !== null; chunk = output.read()) {
      shown += String(chunk);
    }
    expect(shown).toBe('Clave: \n');
    const cancelled = new PassThrough();
    const pendingCancel = askSecretInTerminal('Clave: ', cancelled, new PassThrough());
    cancelled.write('abc\u0003');
    expect(await pendingCancel).toBe('');
    const modes: boolean[] = [];
    const tty = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (mode: boolean) => modes.push(mode) });
    const pendingTty = askSecretInTerminal('Clave: ', tty, new PassThrough());
    tty.write('  con-espacios  \n');
    expect(await pendingTty).toBe('con-espacios');
    expect(modes).toEqual([true, false]);
  });
});
