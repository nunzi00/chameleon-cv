import { describe, expect, it } from 'vitest';

import { loadLlmSettings, loadServeSettings, projectConfigPath, readConfigFile, renderLlmSettings, renderServeSettings, writeLlmSettings, writeServeSettings } from '../../src/app/settings';
import { appContext } from '../helpers/app-context';
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

describe('[serve] de cv.toml (T-8.17)', () => {
  it('carga la tabla, ignora su ausencia y explica un fichero inválido', async () => {
    expect(await loadServeSettings('/work', new MemoryFileSystem())).toEqual({ path: '/work/cv.toml', settings: undefined, present: false, error: undefined });
    expect(await loadServeSettings('/work', new MemoryFileSystem({ '/work/cv.toml': '[llm]\nmodel = "qwen"\n' }))).toMatchObject({ settings: undefined, present: true });
    expect(await loadServeSettings('/work', new MemoryFileSystem({ '/work/cv.toml': '[serve]\nallow_remote = true\n' }))).toMatchObject({ settings: { allow_remote: true }, present: true });
    const broken = await loadServeSettings('/work', new MemoryFileSystem({ '/work/cv.toml': '[serve]\nallow_remote = "sí"\n' }));
    expect(broken.settings).toBeUndefined();
    expect(broken.error).toBeDefined();
  });

  it('renderiza la tabla y rechaza un resultado que no volvería a validar', () => {
    expect(renderServeSettings(undefined, { allow_remote: true })).toEqual({ ok: true, text: '[serve]\nallow_remote = true\n' });
    const dotted = renderServeSettings('serve.allow_remote = true\n', { allow_remote: false });
    expect(dotted.ok).toBe(false);
    expect(!dotted.ok && dotted.message).toMatch(/^El cv\.toml resultante no sería válido; no se escribe nada:\n  - /);
  });

  it('escribe con huella y permisos 0600, y conserva el resto del fichero', async () => {
    const fs = new MemoryFileSystem({ '/work/cv.toml': '[llm]\nmodel = "qwen"\n' });
    const context = appContext(fs);
    const current = await readConfigFile(context);
    expect('error' in current).toBe(false);
    const sha = 'error' in current ? '' : (current.sha256 ?? '*');
    const written = await writeServeSettings(context, { settings: { allow_remote: true }, expectedSha256: sha });
    expect(written).toMatchObject({ ok: true, path: '/work/cv.toml', settings: { allow_remote: true } });
    expect(fs.file('/work/cv.toml')).toMatchObject({ mode: 0o600, content: '[llm]\nmodel = "qwen"\n\n[serve]\nallow_remote = true\n' });
    const stale = await writeServeSettings(context, { settings: { allow_remote: false }, expectedSha256: 'viejo' });
    expect(stale.ok).toBe(false);
  });
});

describe('readConfigFile / writeLlmSettings', () => {
  it('crea cv.toml con «*», exige la huella cuando existe, detecta conflictos y no escribe un resultado inválido', async () => {
    const fs = new MemoryFileSystem();
    const context = appContext(fs);
    expect(await readConfigFile(context)).toEqual({ path: '/work/cv.toml', present: false, sha256: undefined, text: undefined });
    const conflict = await writeLlmSettings(context, { settings: { provider: 'ollama' }, expectedSha256: 'abc' });
    expect(!conflict.ok && conflict.error.message).toBe('No existe /work/cv.toml: envía «*» como huella para crearlo');
    const created = await writeLlmSettings(context, { settings: { provider: 'ollama', model: 'qwen' }, expectedSha256: '*' });
    expect(created.ok && created.path).toBe('/work/cv.toml');
    expect(fs.file('/work/cv.toml')).toMatchObject({ mode: 0o600, content: '[llm]\nprovider = "ollama"\nmodel = "qwen"\n' });
    const current = await readConfigFile(context);
    expect('sha256' in current && current.sha256).toBe(created.ok ? created.sha256 : '');
    const star = await writeLlmSettings(context, { settings: {}, expectedSha256: '*' });
    expect(!star.ok && star.error.message).toBe('Ya existe /work/cv.toml: envía su huella actual (If-Match) para modificarlo');
    const stale = await writeLlmSettings(context, { settings: {}, expectedSha256: 'otra' });
    expect(!stale.ok && stale.error.message).toMatch(/^\/work\/cv\.toml cambió desde que se leyó/);
    await fs.writeFile('/work/cv.toml', 'llm.provider = "ollama"\n', 0o600);
    const dotted = await readConfigFile(context);
    const invalid = await writeLlmSettings(context, { settings: { model: 'x' }, expectedSha256: 'sha256' in dotted ? (dotted.sha256 ?? '') : '' });
    expect(!invalid.ok && invalid.error.code).toBe('invalid-data');
    await fs.writeFile('/work/cv.toml', '[theme]\nname = "classic"\n', 0o600);
    const fresh = await readConfigFile(context);
    fs.failures.add('writeFile');
    const failed = await writeLlmSettings(context, { settings: { model: 'x' }, expectedSha256: 'sha256' in fresh ? (fresh.sha256 ?? '') : '' });
    expect(!failed.ok && failed.error.message).toMatch(/^No se pudo escribir \/work\/cv\.toml: /);
    fs.failures.delete('writeFile');
    const asDirectory = appContext(new MemoryFileSystem({ '/work/cv.toml': { kind: 'directory' } }));
    const unreadable = await readConfigFile(asDirectory);
    expect('error' in unreadable && unreadable.error.message).toMatch(/^No se pudo leer \/work\/cv\.toml: /);
    const unreadableWrite = await writeLlmSettings(asDirectory, { settings: {}, expectedSha256: '*' });
    expect(!unreadableWrite.ok && unreadableWrite.error.code).toBe('environment');
  });
});
