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
    llmProvider: () => Promise.resolve({ ok: false as const, message: 'sin proveedor en las pruebas' }),
    llmCache: new MemoryLlmCache(),
  };
  return { context, stdout: () => out.join('') };
}

const CONFIG = { provider: 'ollama' as const, baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b-instruct', sources: { provider: 'default' as const, baseUrl: 'default' as const, model: 'default' as const } };

describe('cv llm status', () => {
  it('imprime el estado y sale con 0 si el proveedor local es utilizable, con 2 si no', async () => {
    const usable = harness({ config: CONFIG, configError: undefined, health: { ok: true, version: '0.33.1', models: ['qwen2.5:7b-instruct'], modelAvailable: true }, keys: { openai: 'none', anthropic: 'none' }, keysFile: '/h/.config/chameleon-cv/keys.json', allowedHosts: ['api.openai.com', 'api.anthropic.com'], remote: undefined, usable: true });
    expect(await runCli(['llm', 'status'], usable.context)).toBe(EXIT_OK);
    expect(usable.stdout()).toContain('Estado: alcanzable · versión 0.33.1 · 1 modelo (qwen2.5:7b-instruct) · el modelo configurado está disponible\n');

    const down = harness({ config: CONFIG, configError: undefined, health: { ok: false, code: 'unreachable', message: 'ECONNREFUSED' }, keys: { openai: 'none', anthropic: 'none' }, keysFile: '/h/.config/chameleon-cv/keys.json', allowedHosts: ['api.openai.com', 'api.anthropic.com'], remote: undefined, usable: false });
    expect(await runCli(['llm', 'status'], down.context)).toBe(EXIT_FAILURE);
    expect(down.stdout()).toContain('Estado: no disponible · ECONNREFUSED');
  });

  it('la ayuda del grupo llm deja claro que nunca envía datos sin una orden explícita', async () => {
    const h = harness({ config: CONFIG, configError: undefined, health: undefined, keys: { openai: 'none', anthropic: 'none' }, keysFile: '/h/.config/chameleon-cv/keys.json', allowedHosts: ['api.openai.com', 'api.anthropic.com'], remote: undefined, usable: false });
    await runCli(['llm', '--help'], h.context);
    expect(h.stdout().replace(/\s+/g, ' ')).toContain('nunca envía datos sin una orden explícita');
  });
});

describe('cv llm status --provider <remoto>', () => {
  const base = { config: CONFIG, configError: undefined, health: { ok: true as const, version: undefined, models: ['qwen2.5:7b-instruct'], modelAvailable: true }, keys: { openai: 'env' as const, anthropic: 'none' as const }, keysFile: '/h/.config/chameleon-cv/keys.json', allowedHosts: ['api.openai.com', 'api.anthropic.com'], usable: true };

  it('comprueba el remoto pedido y sale con 0 si responde con el modelo, con 2 si no', async () => {
    const ok = harness({ ...base, remote: { id: 'openai', baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini', keySource: 'env', health: { ok: true, version: undefined, models: ['gpt-4o-mini', 'gpt-4o'], modelAvailable: true } } });
    expect(await runCli(['llm', 'status', '--provider', 'openai'], ok.context)).toBe(EXIT_OK);
    expect(ok.stdout()).toContain('Proveedores remotos (solo con --provider explícito): openai → clave definida en CHAMELEON_OPENAI_API_KEY · anthropic → clave ninguna · fichero de claves: /h/.config/chameleon-cv/keys.json\n');
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
