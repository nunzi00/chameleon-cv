import { describe, expect, it } from 'vitest';

import { loadLlmSettings, projectConfigPath, renderLlmSettings } from '../../src/app/settings';
import { MemoryFileSystem } from '../helpers/memory-file-system';

describe('loadLlmSettings', () => {
  it('sin cv.toml, con cv.toml sin [llm], con [llm], y con un cv.toml inválido', async () => {
    expect(await loadLlmSettings('/work', new MemoryFileSystem())).toEqual({ path: '/work/cv.toml', settings: undefined, present: false, error: undefined });
    expect(await loadLlmSettings('/work', new MemoryFileSystem({ '/work/cv.toml': '[theme]\nname = "classic"\n' }))).toEqual({ path: '/work/cv.toml', settings: undefined, present: true, error: undefined });
    expect(await loadLlmSettings('/work', new MemoryFileSystem({ '/work/cv.toml': '[llm]\nprovider = "openai-compatible"\nmodel = "qwen"\n[llm.models]\nopenai = "gpt-4o-mini"\n' }))).toEqual({
      path: '/work/cv.toml',
      settings: { provider: 'openai-compatible', model: 'qwen', models: { openai: 'gpt-4o-mini' } },
      present: true,
      error: undefined,
    });
    const invalid = await loadLlmSettings('/work', new MemoryFileSystem({ '/work/cv.toml': '[llm]\nprovider = "openai"\n' }));
    expect(invalid).toMatchObject({ path: '/work/cv.toml', settings: undefined, present: true });
    expect(invalid.error).toMatch(/^Configuración inválida \(\/work\/cv\.toml\):\n  - llm\.provider: /);
    expect(projectConfigPath('/w')).toBe('/w/cv.toml');
  });
});

describe('renderLlmSettings', () => {
  it('compone el fichero con la tabla sustituida y lo comprueba; si el resultado no valida, no lo devuelve', () => {
    expect(renderLlmSettings(undefined, { provider: 'ollama' })).toEqual({ ok: true, text: '[llm]\nprovider = "ollama"\n' });
    expect(renderLlmSettings('[theme]\nname = "classic"\n', { model: 'm' })).toEqual({ ok: true, text: '[theme]\nname = "classic"\n\n[llm]\nmodel = "m"\n' });
    const dotted = renderLlmSettings('llm.provider = "ollama"\n', { provider: 'ollama' });
    expect(dotted.ok).toBe(false);
    expect(!dotted.ok && dotted.message).toMatch(/^El cv\.toml resultante no sería válido; no se escribe nada:\n  - /);
  });
});
