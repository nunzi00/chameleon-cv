import { describe, expect, it } from 'vitest';

import { EXIT_FAILURE, EXIT_OK, runCli, type CliContext } from '../../src/cli';
import { MemoryLlmCache, type LlmStatus } from '../../src/llm';
import { defaultSourceParsers } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import { renderTypstCv } from '../../src/renderers/typst';
import { installTypst, typstStatus } from '../../src/typst';
import { MemoryFileSystem } from '../helpers/memory-file-system';

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
    llmProvider: () => ({ ok: false, message: 'sin proveedor en las pruebas' }),
    llmCache: new MemoryLlmCache(),
  };
  return { context, stdout: () => out.join('') };
}

const CONFIG = { provider: 'ollama' as const, baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b-instruct', sources: { provider: 'default' as const, baseUrl: 'default' as const, model: 'default' as const } };

describe('cv llm status', () => {
  it('imprime el estado y sale con 0 si el proveedor local es utilizable, con 2 si no', async () => {
    const usable = harness({ config: CONFIG, configError: undefined, health: { ok: true, version: '0.33.1', models: ['qwen2.5:7b-instruct'], modelAvailable: true }, remoteKeys: [], usable: true });
    expect(await runCli(['llm', 'status'], usable.context)).toBe(EXIT_OK);
    expect(usable.stdout()).toContain('Estado: alcanzable · versión 0.33.1 · 1 modelo (qwen2.5:7b-instruct) · el modelo configurado está disponible\n');

    const down = harness({ config: CONFIG, configError: undefined, health: { ok: false, code: 'unreachable', message: 'ECONNREFUSED' }, remoteKeys: [], usable: false });
    expect(await runCli(['llm', 'status'], down.context)).toBe(EXIT_FAILURE);
    expect(down.stdout()).toContain('Estado: no disponible · ECONNREFUSED');
  });

  it('la ayuda del grupo llm deja claro que nunca envía datos sin una orden explícita', async () => {
    const h = harness({ config: CONFIG, configError: undefined, health: undefined, remoteKeys: [], usable: false });
    await runCli(['llm', '--help'], h.context);
    expect(h.stdout().replace(/\s+/g, ' ')).toContain('nunca envía datos sin una orden explícita');
  });
});
