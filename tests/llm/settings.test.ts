import { describe, expect, it } from 'vitest';

import { LlmSettingsSchema, replaceLlmTable, serializeLlmTable } from '../../src/llm/settings';

describe('LlmSettingsSchema', () => {
  it('admite proveedor local, URL loopback, modelo y modelos por defecto de los remotos', () => {
    expect(LlmSettingsSchema.parse({ provider: 'openai-compatible', base_url: ' http://127.0.0.1:8080 ', model: ' qwen ', models: { openai: 'gpt-4o-mini' } })).toEqual({
      provider: 'openai-compatible',
      base_url: 'http://127.0.0.1:8080',
      model: 'qwen',
      models: { openai: 'gpt-4o-mini' },
    });
    expect(LlmSettingsSchema.parse({})).toEqual({});
  });

  it('rechaza remotos como proveedor, URLs que no son locales, claves desconocidas y modelos vacíos', () => {
    const remote = LlmSettingsSchema.safeParse({ provider: 'openai' });
    expect(remote.success).toBe(false);
    expect(!remote.success && remote.error.issues[0]?.message).toMatch(/proveedor local/);
    const url = LlmSettingsSchema.safeParse({ base_url: 'https://api.openai.com' });
    expect(!url.success && url.error.issues[0]?.message).toMatch(/loopback/);
    expect(LlmSettingsSchema.safeParse({ modelo: 'x' }).success).toBe(false);
    expect(LlmSettingsSchema.safeParse({ models: { gemini: 'x' } }).success).toBe(false);
    expect(LlmSettingsSchema.safeParse({ model: '' }).success).toBe(false);
  });
});

describe('serializeLlmTable', () => {
  it('escribe solo las claves presentes, con cadenas TOML básicas y la subtabla de modelos si hay', () => {
    expect(serializeLlmTable({})).toBe('[llm]\n');
    expect(serializeLlmTable({ provider: 'ollama', model: 'qwen2.5:7b-instruct' })).toBe('[llm]\nprovider = "ollama"\nmodel = "qwen2.5:7b-instruct"\n');
    expect(serializeLlmTable({ base_url: 'http://127.0.0.1:8080', model: 'con "comillas" y \\ barra', models: { openai: 'gpt-4o-mini', anthropic: 'claude-sonnet-4-5' } })).toBe(
      '[llm]\nbase_url = "http://127.0.0.1:8080"\nmodel = "con \\"comillas\\" y \\\\ barra"\n\n[llm.models]\nopenai = "gpt-4o-mini"\nanthropic = "claude-sonnet-4-5"\n',
    );
    expect(serializeLlmTable({ models: {} })).toBe('[llm]\n');
  });
});

describe('replaceLlmTable', () => {
  const OTHER = '# Mi proyecto\n[theme]\nname = "classic"   # tema\n\n[theme.colors]\nprimary = "#112233"\n';

  it('añade la tabla al final cuando no existe, separada por una línea en blanco, sin tocar el resto', () => {
    expect(replaceLlmTable('', { provider: 'ollama' })).toBe('[llm]\nprovider = "ollama"\n');
    expect(replaceLlmTable(OTHER, { provider: 'ollama' })).toBe(`${OTHER}\n[llm]\nprovider = "ollama"\n`);
    expect(replaceLlmTable(OTHER.trimEnd(), { provider: 'ollama' })).toBe(`${OTHER.trimEnd()}\n\n[llm]\nprovider = "ollama"\n`);
    expect(replaceLlmTable(`${OTHER}\n`, { provider: 'ollama' })).toBe(`${OTHER}\n[llm]\nprovider = "ollama"\n`);
  });

  it('sustituye la tabla existente y sus subtablas contiguas, conservando lo anterior y lo posterior byte a byte', () => {
    const text = `${OTHER}\n[llm]  # co-piloto\nprovider = "openai-compatible"\nbase_url = "http://127.0.0.1:8080"\n\n[llm.models]\nopenai = "gpt-4o"\n\n\n[otra]\nx = 1\n`;
    expect(replaceLlmTable(text, { provider: 'ollama', model: 'qwen' })).toBe(`${OTHER}\n[llm]\nprovider = "ollama"\nmodel = "qwen"\n\n\n[otra]\nx = 1\n`);
    const atEnd = `${OTHER}\n[llm]\nprovider = "ollama"\n`;
    expect(replaceLlmTable(atEnd, { provider: 'openai-compatible' })).toBe(`${OTHER}\n[llm]\nprovider = "openai-compatible"\n`);
    const first = '[llm]\nprovider = "ollama"\n[theme]\nname = "x"\n';
    expect(replaceLlmTable(first, { model: 'm' })).toBe('[llm]\nmodel = "m"\n[theme]\nname = "x"\n');
    const only = '[ llm ]\nprovider = "ollama"';
    expect(replaceLlmTable(only, {})).toBe('[llm]\n');
  });

  it('es idempotente', () => {
    const once = replaceLlmTable(OTHER, { provider: 'ollama', models: { openai: 'gpt-4o-mini' } });
    expect(replaceLlmTable(once, { provider: 'ollama', models: { openai: 'gpt-4o-mini' } })).toBe(once);
  });
});

describe('[llm.runtime] (T-8.8, S3 del rediseño)', () => {
  it('se admite, se serializa como subtabla y se rechaza un runner desconocido', () => {
    const parsed = LlmSettingsSchema.parse({ provider: 'ollama', runtime: { runner: 'docker', image: ' ollama/ollama:latest ' } });
    expect(parsed.runtime).toEqual({ runner: 'docker', image: 'ollama/ollama:latest' });
    expect(serializeLlmTable(parsed)).toBe('[llm]\nprovider = "ollama"\n\n[llm.runtime]\nrunner = "docker"\nimage = "ollama/ollama:latest"\n');
    expect(serializeLlmTable({ provider: 'ollama', runtime: {} })).toBe('[llm]\nprovider = "ollama"\n');
    expect(LlmSettingsSchema.safeParse({ runtime: { runner: 'podman' } }).success).toBe(false);
    expect(replaceLlmTable('[theme]\nname = "classic"\n\n[llm]\nmodel = "x"\n\n[llm.runtime]\nrunner = "native"\n', { provider: 'ollama' })).toBe('[theme]\nname = "classic"\n\n[llm]\nprovider = "ollama"\n');
  });
});
