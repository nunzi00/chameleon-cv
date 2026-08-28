import { describe, expect, it } from 'vitest';

import type { FileSystem } from '../../src/parsers';
import { PROJECT_CONFIG_FILE, applyThemeOverrides, builtinThemeRoot, loadProjectConfig, loadTheme, overriddenKeys, parseProjectConfig } from '../../src/themes';
import { MemoryFileSystem } from '../helpers/memory-file-system';

describe('cv.toml (T-5.2): anulaciones con el vocabulario de theme.toml', () => {
  it('parsea la sección [theme] (todo opcional) y rechaza claves desconocidas y valores inválidos con su ruta', () => {
    expect(parseProjectConfig('')).toEqual({ ok: true, config: {} });
    expect(parseProjectConfig('[theme]\nname = "classic"\n[theme.colors]\nprimary = "#FF0000"\n[theme.page.margins]\ntop = 30\n')).toEqual({
      ok: true,
      config: { theme: { name: 'classic', colors: { primary: '#ff0000' }, page: { margins: { top: 30 } } } },
    });
    expect(parseProjectConfig('[theme]\nprimary_color = "#ff0000"\n')).toMatchObject({ ok: false, errors: [expect.stringMatching(/^theme: .*primary_color/)] });
    expect(parseProjectConfig('[theme.colors]\nprimary = "rojo"\n[theme.sizes]\nbody = 100\n[theme.page]\npaper = "folio"\n')).toEqual({
      ok: false,
      errors: ['theme.colors.primary: Color inválido: usa #rrggbb (p. ej. "#1f4e79")', 'theme.sizes.body: Tamaño demasiado grande (máximo 72 pt)', expect.stringMatching(/^theme\.page\.paper: /)],
    });
    expect(parseProjectConfig('[theme]\nname = "Mal Nombre"\n')).toEqual({ ok: false, errors: ['theme.name: Nombre de tema inválido: minúsculas, dígitos y guiones'] });
    expect(parseProjectConfig('[otra]\nx = 1\n')).toMatchObject({ ok: false, errors: [expect.stringMatching(/^<raíz>: .*otra/)] });
    expect(parseProjectConfig('[theme\n')).toMatchObject({ ok: false, errors: [expect.stringMatching(/^línea 1: /)] });
  });

  it('fusiona en cascada sobre el tema cargado sin tocar sus metadatos ni el tema original', async () => {
    const loaded = await loadTheme('default', [builtinThemeRoot()]);
    if (!loaded.ok) throw new Error(loaded.message);
    const merged = applyThemeOverrides(loaded.theme, { colors: { primary: '#ff0000' }, fonts: { body: 'Libertinus Serif' }, page: { paper: 'us-letter', margins: { top: 30 } } });
    expect(merged.config.colors).toEqual({ ...loaded.theme.config.colors, primary: '#ff0000' });
    expect(merged.config.fonts).toEqual({ ...loaded.theme.config.fonts, body: 'Libertinus Serif' });
    expect(merged.config.page).toEqual({ paper: 'us-letter', margins: { ...loaded.theme.config.page.margins, top: 30 } });
    expect(merged.config.theme).toEqual(loaded.theme.config.theme);
    expect(merged.config.sizes).toEqual(loaded.theme.config.sizes);
    expect(merged.config.spacing).toEqual(loaded.theme.config.spacing);
    expect(merged).toMatchObject({ name: 'default', templatePath: loaded.theme.templatePath, builtin: true });
    expect(loaded.theme.config.colors.primary).toBe('#1b1b1b');
    expect(applyThemeOverrides(loaded.theme, undefined)).toBe(loaded.theme);
    expect(applyThemeOverrides(loaded.theme, { name: 'classic' })).toBe(loaded.theme);
    expect(applyThemeOverrides(loaded.theme, { sizes: { body: 11 }, spacing: { list: 0.3 } }).config).toMatchObject({ sizes: { body: 11, name: 24 }, spacing: { list: 0.3, leading: 0.55 }, page: loaded.theme.config.page });
    expect(overriddenKeys({ colors: { primary: '#ff0000', accent: '#00ff00' }, sizes: { body: 11 }, spacing: { list: 0.3 }, page: { paper: 'a5', margins: { left: 10 } } })).toEqual(['colors.primary', 'colors.accent', 'sizes.body', 'spacing.list', 'page.paper', 'page.margins.left']);
    expect(overriddenKeys(undefined)).toEqual([]);
    expect(overriddenKeys({ name: 'x', page: {} })).toEqual([]);
  });

  it('lee <cwd>/cv.toml si existe; su ausencia no es un error; explica lo que no es un fichero, lo ilegible y lo inválido', async () => {
    expect(await loadProjectConfig('/work', new MemoryFileSystem({}))).toEqual({ ok: true, path: '/work/cv.toml', config: undefined });
    expect(await loadProjectConfig('/work', new MemoryFileSystem({ '/work/cv.toml': '[theme.colors]\nprimary = "#ff0000"\n' }))).toEqual({ ok: true, path: '/work/cv.toml', config: { theme: { colors: { primary: '#ff0000' } } } });
    expect(await loadProjectConfig('/work', new MemoryFileSystem({ '/work/cv.toml/dentro.txt': '' }))).toEqual({ ok: false, path: '/work/cv.toml', message: '/work/cv.toml no es un fichero' });
    expect(await loadProjectConfig('/work', new MemoryFileSystem({ '/work/cv.toml': '[theme.colors]\nprimary = "rojo"\n' }))).toEqual({
      ok: false,
      path: '/work/cv.toml',
      message: 'Configuración inválida (/work/cv.toml):\n  - theme.colors.primary: Color inválido: usa #rrggbb (p. ej. "#1f4e79")',
    });
    const base = new MemoryFileSystem({ '/work/cv.toml': '' });
    const failing: FileSystem = { readDirectory: (path) => base.readDirectory(path), stat: (path) => base.stat(path), realPath: (path) => base.realPath(path), readBinaryFile: (path) => base.readBinaryFile(path), readTextFile: () => Promise.reject(new Error('EIO')) };
    expect(await loadProjectConfig('/work', failing)).toEqual({ ok: false, path: '/work/cv.toml', message: 'No se pudo leer /work/cv.toml: EIO' });
    expect(PROJECT_CONFIG_FILE).toBe('cv.toml');
  });
});
