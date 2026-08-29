import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultAssets } from '../../src/shared/assets';
import { serializeProfile } from '../../src/artifact';
import { PassThrough } from 'node:stream';

import { EXIT_FAILURE, EXIT_OK, REMOTE_CANCELLED, askInTerminal, consentToRemote, runCli, type CliContext } from '../../src/cli';
import { MemoryLlmCache, type LlmProvider, type LlmRequest, type ProviderSelection } from '../../src/llm';
import { NodeFileSystem, defaultSourceParsers, loadDataset } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import { renderTypstCv } from '../../src/renderers/typst';
import { installTypst, typstStatus } from '../../src/typst';
import { MemoryFileSystem } from '../helpers/memory-file-system';

interface Harness {
  readonly context: CliContext;
  readonly fs: MemoryFileSystem;
  readonly calls: LlmRequest[];
  readonly selections: ProviderSelection[];
  readonly stdout: () => string;
  readonly stderr: () => string;
}

let artifact = '';
async function loadArtifact(): Promise<string> {
  if (artifact === '') {
    const dataset = await loadDataset(join(__dirname, '../fixtures/dataset'), { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
    if (!dataset.ok) {
      throw new Error('dataset');
    }
    artifact = serializeProfile(dataset.profile);
  }
  return artifact;
}

function remoteProvider(calls: LlmRequest[]): LlmProvider {
  return {
    id: 'openai',
    kind: 'remote',
    baseUrl: 'https://api.openai.com',
    model: 'gpt-4o-mini',
    complete: (request) => {
      calls.push(request);
      const input = JSON.parse(request.messages[1]?.content ?? '{}') as { text?: string };
      const text = input.text === undefined ? 'Senior Backend Engineer con 3 años de experiencia en PHP, Symfony y Kubernetes; reduje la latencia p95 un 40 %.' : `Logré: ${input.text.replace(/\*\*/g, '')}`;
      const json = { proposals: [{ text, rationale: 'r' }] };
      return Promise.resolve({ ok: true, json, raw: JSON.stringify(json), model: 'gpt-4o-mini', usage: { promptTokens: 300, completionTokens: 60 }, elapsedMs: 800 });
    },
    health: () => Promise.reject(new Error('health no debe llamarse en remotos')),
  };
}

async function harness(confirm: ((question: string) => Promise<boolean>) | undefined): Promise<Harness> {
  const out: string[] = [];
  const err: string[] = [];
  const calls: LlmRequest[] = [];
  const selections: ProviderSelection[] = [];
  const fs = new MemoryFileSystem({
    '/work/data/sources/profile.md': { kind: 'file', content: '---\nfullName: Ada\n---\n', mtimeMs: 100 },
    '/work/data/dist/profile.json': { kind: 'file', content: await loadArtifact(), mode: 0o600, mtimeMs: 500 },
  });
  const context: CliContext = {
    cwd: '/work',
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
    stdin: () => Promise.resolve(''),
    datasetFileSystem: fs,
    artifactFileSystem: fs,
    parsers: defaultSourceParsers(),
    pdfExtractor: (bytes) => extractPdfText(bytes),
    typstRenderer: (profile, options) => renderTypstCv(profile, options),
    typstInstall: (options, report) => installTypst(options, report),
    typstStatus: (options) => typstStatus(options),
    llmStatus: () => Promise.reject(new Error('no usado')),
    llmProvider: (selection) => {
      selections.push(selection);
      return Promise.resolve(selection.provider === 'openai' ? { ok: true as const, provider: remoteProvider(calls) } : { ok: false as const, message: `sin proveedor «${selection.provider ?? ''}» en las pruebas` });
    },
    llmCache: new MemoryLlmCache(),
    assets: defaultAssets(),
    now: () => new Date('2026-08-28T20:00:00.000Z'),
    ...(confirm === undefined ? {} : { confirm }),
  };
  return { context, fs, calls, selections, stdout: () => out.join(''), stderr: () => err.join('') };
}

describe('proveedores remotos: consentimiento explícito y conciencia de coste (T-4.5)', () => {
  it('improve --provider openai pide confirmación con el coste estimado y solo envía si se acepta', async () => {
    const questions: string[] = [];
    const accepted = await harness((question) => {
      questions.push(question);
      return Promise.resolve(true);
    });
    expect(await runCli(['improve', '--only', 'exp-acme-1', '--provider', 'openai', '--model', 'gpt-4o-mini'], accepted.context)).toBe(EXIT_OK);
    expect(accepted.selections).toEqual([{ provider: 'openai', model: 'gpt-4o-mini' }]);
    expect(accepted.stderr()).toContain('hacia openai (https://api.openai.com, remote; modelo gpt-4o-mini)\n');
    expect(accepted.stderr()).toMatch(/Aviso de coste: 1 petición a openai \(https:\/\/api\.openai\.com; modelo gpt-4o-mini\) con ≈\d+ tokens de entrada \(estimación: 4 caracteres ≈ 1 token\) y hasta 600 de salida\.\nLa operación puede incurrir en costes según tu tarifa con el proveedor\.\n/);
    expect(questions).toEqual(['¿Continuar y enviar al proveedor remoto? [s/N] ']);
    expect(accepted.calls).toHaveLength(1);
    expect(accepted.stdout()).toContain('Revisión escrita en /work/output/revision-improve-2026-08-28.md: 1 logro · 1 propuesta · 1 aceptadas');

    const declined = await harness(() => Promise.resolve(false));
    expect(await runCli(['improve', '--only', 'exp-acme-1', '--provider', 'openai'], declined.context)).toBe(EXIT_FAILURE);
    expect(declined.stderr()).toContain(`${REMOTE_CANCELLED}\n`);
    expect(declined.calls).toHaveLength(0);
    expect(declined.fs.file('/work/output/revision-improve-2026-08-28.md')).toBeUndefined();
  });

  it('sin terminal interactiva se aborta salvo --yes, que confirma por adelantado', async () => {
    const headless = await harness(undefined);
    expect(await runCli(['improve', '--only', 'exp-acme-1', '--provider', 'openai'], headless.context)).toBe(EXIT_FAILURE);
    expect(headless.stderr()).toContain(`${REMOTE_CANCELLED}: sin terminal interactiva, confirma con --yes\n`);
    expect(headless.calls).toHaveLength(0);

    const yes = await harness(undefined);
    expect(await runCli(['improve', '--only', 'exp-acme-1', '--provider', 'openai', '--yes'], yes.context)).toBe(EXIT_OK);
    expect(yes.stderr()).toContain('Confirmado con --yes\n');
    expect(yes.calls).toHaveLength(1);
  });

  it('summarize --provider openai sigue el mismo puente; --dry-run nunca llega a la confirmación', async () => {
    const questions: string[] = [];
    const h = await harness((question) => {
      questions.push(question);
      return Promise.resolve(true);
    });
    expect(await runCli(['summarize', '-s', 'backend', '--provider', 'openai', '--yes'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain('Aviso de coste: 1 petición a openai');
    expect(h.calls).toHaveLength(1);
    expect(questions).toEqual([]);
    const dry = await harness(undefined);
    expect(await runCli(['summarize', '-s', 'backend', '--provider', 'openai', '--dry-run'], dry.context)).toBe(EXIT_OK);
    expect(dry.stderr()).not.toContain('Aviso de coste');
    expect(dry.calls).toHaveLength(0);
    const unknown = await harness(undefined);
    expect(await runCli(['summarize', '--provider', 'gemini'], unknown.context)).toBe(EXIT_FAILURE);
    expect(unknown.stderr()).toContain('sin proveedor «gemini» en las pruebas\n');
  });

  it('consentToRemote deja pasar a los locales sin preguntar', async () => {
    const h = await harness(() => Promise.reject(new Error('no debe preguntar')));
    const local: LlmProvider = { ...remoteProvider([]), id: 'ollama', kind: 'local', baseUrl: 'http://127.0.0.1:11434' };
    expect(await consentToRemote(h.context, local, { requests: 1, inputTokens: 1, maxOutputTokens: 1 }, false)).toBe(true);
    expect(h.stderr()).toBe('');
  });
});

describe('detalles del puente remoto', () => {
  it('summarize rechazado en la confirmación no envía nada y sale con 2', async () => {
    const declined = await harness(() => Promise.resolve(false));
    expect(await runCli(['summarize', '-s', 'backend', '--provider', 'openai'], declined.context)).toBe(EXIT_FAILURE);
    expect(declined.stderr()).toContain(`${REMOTE_CANCELLED}\n`);
    expect(declined.calls).toHaveLength(0);
  });

  it('askInTerminal acepta s/si/sí/y/yes y rechaza lo demás (incluida la respuesta vacía)', async () => {
    const output = new PassThrough();
    for (const [answer, expected] of [['SÍ\n', true], ['si\n', true], ['s\n', true], ['yes\n', true], ['y\n', true], ['\n', false], ['no\n', false]] as const) {
      const input = new PassThrough();
      const pending = askInTerminal('¿ok? ', input, output);
      input.write(answer);
      expect(await pending).toBe(expected);
    }
    expect(output.read()?.toString()).toContain('¿ok? ');
  });
});
