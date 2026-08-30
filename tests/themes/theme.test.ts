import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { FileSystem } from '../../src/parsers';
import { BUILTIN_THEMES_DIRECTORY, DEFAULT_THEME, PAPER_SIZES, builtinThemeRoot, inventoryThemes, listThemes, loadTheme, locateTheme, parseThemeConfig, themeRoots, tomlErrorMessage, type ThemeRoot } from '../../src/themes';
import { defaultThemeConfig, defaultThemeToml, themeToml } from '../fixtures/theme';
import { MemoryFileSystem, type MemoryEntry } from '../helpers/memory-file-system';

describe('theme.toml (T-5.1): lectura y validación estricta', () => {
  it('el tema distribuido es válido y reproduce el diseño de referencia (T-3.4)', () => {
    const config = defaultThemeConfig();
    expect(config).toEqual({
      theme: { name: 'default', description: 'Diseño tipográfico de referencia: jerarquía sobria, versalitas en las secciones y fechas alineadas a la derecha', version: 1, kind: 'style' },
      colors: { text: '#1b1b1b', primary: '#1b1b1b', secondary: '#5c5c5c', accent: '#1f4e79', rule: '#c9c9c9' },
      fonts: { body: 'Source Sans 3', heading: 'Source Sans 3', mono: 'DejaVu Sans Mono' },
      sizes: { name: 24, headline: 11.5, contact: 9.3, section: 9.4, title: 10.8, meta: 9.3, body: 10, footer: 8.5, code: 9.2 },
      spacing: { leading: 0.55, paragraph: 0.7, list: 0.45 },
      page: { paper: 'a4', margins: { top: 17, right: 19, bottom: 16, left: 19 } },
    });
    expect(PAPER_SIZES).toContain('a4');
  });

  it('normaliza colores, admite un tema sin nombre ni descripción y rechaza claves desconocidas, colores, rangos y papel', () => {
    const upper = parseThemeConfig(defaultThemeToml().replace('accent = "#1f4e79"', 'accent = "#1F4E79"').replace('name = "default"\n', '').replace(/description = .*\n/, ''));
    expect(upper).toMatchObject({ ok: true, config: { colors: { accent: '#1f4e79' }, theme: { version: 1 } } });
    expect(upper.ok && upper.config.theme.name).toBeUndefined();
    const broken = `${themeToml('x').replace('primary = "#222222"', 'primary = "rojo"').replace('name = 20', 'name = 100').replace('paper = "us-letter"', 'paper = "folio"').replace('top = 20', 'top = -1').replace(/\[spacing\][^[]*/, '')}[extra]\na = 1\n`;
    const invalid = parseThemeConfig(broken);
    expect(invalid.ok).toBe(false);
    const errors = invalid.ok ? [] : invalid.errors;
    expect(errors).toHaveLength(6);
    expect(errors).toEqual(
      expect.arrayContaining([
        'colors.primary: Color inválido: usa #rrggbb (p. ej. "#1f4e79")',
        'sizes.name: Tamaño demasiado grande (máximo 72 pt)',
        expect.stringMatching(/^spacing: /),
        expect.stringMatching(/^page\.paper: /),
        'page.margins.top: Margen negativo',
        expect.stringMatching(/^<raíz>: .*extra/),
      ]),
    );
    expect(parseThemeConfig('version = 1\n')).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.stringContaining('theme: ')]) });
    expect(parseThemeConfig(themeToml('MAL'))).toMatchObject({ ok: false, errors: ['theme.name: Nombre de tema inválido: minúsculas, dígitos y guiones'] });
  });

  it('explica los errores de sintaxis TOML con su línea', () => {
    expect(parseThemeConfig('[theme]\nname = "x"\nversion = 1\n[colors]\ntext = [1,\n')).toEqual({ ok: false, errors: [expect.stringMatching(/^línea \d+: Invalid TOML document/)] });
    expect(tomlErrorMessage(new Error('otra cosa\nsegunda línea'))).toBe('otra cosa');
  });

  it('admite los metadatos de autoría (T-8.3) y rechaza autor vacío o largo, licencia larga y homepage que no sea https', () => {
    const withMeta = (extra: string): string => themeToml('x').replace('name = "x"', `name = "x"\n${extra}`);
    const valid = parseThemeConfig(withMeta('author = "Ana"\nlicense = "CC-BY-4.0"\nhomepage = "https://ejemplo.org/tema"'));
    expect(valid).toMatchObject({ ok: true, config: { theme: { name: 'x', author: 'Ana', license: 'CC-BY-4.0', homepage: 'https://ejemplo.org/tema' } } });
    expect(parseThemeConfig(themeToml('x'))).toMatchObject({ ok: true, config: { theme: { name: 'x', version: 1 } } });
    expect(parseThemeConfig(withMeta('author = ""'))).toEqual({ ok: false, errors: ['theme.author: Demasiado pequeño: se esperaba que texto tuviera >=1 caracteres'] });
    expect(parseThemeConfig(withMeta(`author = "${'a'.repeat(121)}"`))).toEqual({ ok: false, errors: ['theme.author: Demasiado grande: se esperaba que texto tuviera <=120 caracteres'] });
    expect(parseThemeConfig(withMeta(`license = "${'l'.repeat(61)}"`))).toEqual({ ok: false, errors: ['theme.license: Demasiado grande: se esperaba que texto tuviera <=60 caracteres'] });
    expect(parseThemeConfig(withMeta('homepage = "http://ejemplo.org"'))).toEqual({ ok: false, errors: ['theme.homepage: homepage debe ser una URL https'] });
    expect(parseThemeConfig(withMeta('homepage = "nada"'))).toEqual({ ok: false, errors: ['theme.homepage: homepage debe ser una URL https'] });
  });
});

describe('cargador de temas: themes/ del proyecto y después los distribuidos', () => {
  function memoryRoot(tree: Record<string, string | MemoryEntry>, directory = '/work/themes'): ThemeRoot {
    return { directory, fileSystem: new MemoryFileSystem(tree), builtin: false };
  }

  it('carga el tema distribuido default y lo describe', async () => {
    const roots = themeRoots('/work', new MemoryFileSystem({}));
    expect(roots).toHaveLength(2);
    expect(roots[0]).toMatchObject({ directory: '/work/themes', builtin: false });
    expect(roots[1]).toMatchObject({ directory: BUILTIN_THEMES_DIRECTORY, builtin: true });
    const loaded = await loadTheme(DEFAULT_THEME, roots);
    expect(loaded).toMatchObject({
      ok: true,
      theme: { name: 'default', directory: join(BUILTIN_THEMES_DIRECTORY, 'default'), templatePath: join(BUILTIN_THEMES_DIRECTORY, 'default', 'template.typ'), configPath: join(BUILTIN_THEMES_DIRECTORY, 'default', 'theme.toml'), fontsDirectory: undefined, builtin: true, config: defaultThemeConfig() },
    });
    // Si el proyecto es el propio repositorio, no se busca dos veces en el mismo directorio.
    expect(themeRoots(join(BUILTIN_THEMES_DIRECTORY, '..'), new MemoryFileSystem({}))).toHaveLength(1);
    expect(await listThemes([builtinThemeRoot()])).toEqual(['academic', 'awesome', 'bold', 'chronological', 'classic', 'compact-grid', 'default', 'elegant', 'europass-like', 'executive', 'functional', 'hybrid', 'minimal', 'modern', 'monochrome', 'one-page', 'project-portfolio', 'skills-first', 'tech', 'timeline', 'warm']);
    const classic = await loadTheme('classic', [builtinThemeRoot()]);
    expect(classic).toMatchObject({ ok: true, theme: { name: 'classic', builtin: true, config: { theme: { name: 'classic', version: 1 }, fonts: { body: 'Libertinus Serif' }, page: { paper: 'a4' } } } });
  });

  it('el tema del proyecto prevalece, puede traer fonts/ y se lista antes que los distribuidos', async () => {
    const project = memoryRoot({
      '/work/themes/mio/theme.toml': themeToml('mio'),
      '/work/themes/mio/template.typ': '#let cv(d, theme) = d.fullName',
      '/work/themes/mio/fonts/Fuente.ttf': 'x',
      '/work/themes/default/theme.toml': themeToml('default'),
      '/work/themes/default/template.typ': '#let cv(d, theme) = [propio]',
      '/work/themes/sin-config/template.typ': '',
      '/work/themes/MAL/theme.toml': themeToml('mal'),
      '/work/themes/suelto.txt': '',
    });
    const roots = [project, builtinThemeRoot()];
    expect(await listThemes(roots)).toEqual(['default', 'mio', 'academic', 'awesome', 'bold', 'chronological', 'classic', 'compact-grid', 'elegant', 'europass-like', 'executive', 'functional', 'hybrid', 'minimal', 'modern', 'monochrome', 'one-page', 'project-portfolio', 'skills-first', 'tech', 'timeline', 'warm']);
    const mio = await loadTheme('mio', roots);
    expect(mio).toMatchObject({ ok: true, theme: { name: 'mio', directory: '/work/themes/mio', fontsDirectory: '/work/themes/mio/fonts', builtin: false, config: { page: { paper: 'us-letter' } } } });
    const shadowed = await loadTheme('default', roots);
    expect(shadowed).toMatchObject({ ok: true, theme: { directory: '/work/themes/default', builtin: false } });
    expect(await listThemes([memoryRoot({}, '/no/existe'), memoryRoot({ '/work/themes/a/theme.toml': 'x' })])).toEqual(['a']);
  });

  it('explica el nombre inválido, el tema inexistente, los ficheros que faltan, el TOML inválido, el nombre discordante y la lectura fallida', async () => {
    const project = memoryRoot({
      '/work/themes/sin-config/template.typ': '',
      '/work/themes/sin-plantilla/theme.toml': themeToml('sin-plantilla'),
      '/work/themes/roto/theme.toml': '[theme\n',
      '/work/themes/roto/template.typ': '',
      '/work/themes/otro/theme.toml': themeToml('nombre-distinto'),
      '/work/themes/otro/template.typ': '',
      '/work/themes/feo/theme.toml': themeToml('feo').replace('primary = "#222222"', 'primary = "verde"'),
      '/work/themes/feo/template.typ': '',
    });
    const roots = [project, builtinThemeRoot()];
    expect(await loadTheme('../default', roots)).toEqual({ ok: false, message: 'Nombre de tema inválido «../default»: minúsculas, dígitos y guiones (p. ej. «default»)' });
    expect(await loadTheme('nada', roots)).toEqual({ ok: false, message: `No existe el tema «nada» (buscado en /work/themes, ${BUILTIN_THEMES_DIRECTORY}); disponibles: feo, otro, roto, sin-plantilla, academic, awesome, bold, chronological, classic, compact-grid, default, elegant, europass-like, executive, functional, hybrid, minimal, modern, monochrome, one-page, project-portfolio, skills-first, tech, timeline, warm` });
    expect(await loadTheme('nada', [memoryRoot({})])).toEqual({ ok: false, message: 'No existe el tema «nada» (buscado en /work/themes); disponibles: ninguno' });
    expect(await loadTheme('sin-config', roots)).toEqual({ ok: false, message: 'El tema «sin-config» (/work/themes/sin-config) no tiene theme.toml' });
    expect(await loadTheme('sin-plantilla', roots)).toEqual({ ok: false, message: 'El tema «sin-plantilla» (/work/themes/sin-plantilla) no tiene template.typ' });
    expect(await loadTheme('roto', roots)).toMatchObject({ ok: false, message: expect.stringMatching(/^Tema «roto» inválido \(\/work\/themes\/roto\/theme\.toml\):\n  - línea 1: Invalid TOML document/) });
    expect(await loadTheme('feo', roots)).toEqual({ ok: false, message: 'Tema «feo» inválido (/work/themes/feo/theme.toml):\n  - colors.primary: Color inválido: usa #rrggbb (p. ej. "#1f4e79")' });
    expect(await loadTheme('otro', roots)).toEqual({ ok: false, message: '/work/themes/otro/theme.toml: theme.name «nombre-distinto» no coincide con el directorio «otro»' });
    const base = new MemoryFileSystem({ '/work/themes/x/theme.toml': themeToml('x'), '/work/themes/x/template.typ': '' });
    const failing: FileSystem = { ...base, readDirectory: (path) => base.readDirectory(path), stat: (path) => base.stat(path), realPath: (path) => base.realPath(path), readBinaryFile: (path) => base.readBinaryFile(path), readTextFile: () => Promise.reject(new Error('EIO')) };
    expect(await loadTheme('x', [{ directory: '/work/themes', fileSystem: failing, builtin: false }])).toEqual({ ok: false, message: 'No se pudo leer /work/themes/x/theme.toml: EIO' });
  });
});

describe('localización e inventario (T-5.3)', () => {
  it('locateTheme encuentra el directorio sin validar; inventoryThemes describe origen, validez y ocultación', async () => {
    const project: ThemeRoot = { directory: '/work/themes', fileSystem: new MemoryFileSystem({ '/work/themes/mio/theme.toml': themeToml('mio'), '/work/themes/mio/template.typ': '', '/work/themes/default/theme.toml': '[theme\n', '/work/themes/default/template.typ': '', '/work/themes/vacio/template.typ': '' }), builtin: false };
    const roots = [project, builtinThemeRoot()];
    expect(await locateTheme('vacio', roots)).toEqual({ name: 'vacio', directory: '/work/themes/vacio', root: project });
    expect(await locateTheme('classic', roots)).toMatchObject({ name: 'classic', directory: join(BUILTIN_THEMES_DIRECTORY, 'classic'), root: { builtin: true } });
    expect(await locateTheme('nada', roots)).toBeUndefined();
    const inventory = await inventoryThemes(roots);
    expect(inventory.map((entry) => [entry.name, entry.builtin, entry.shadows, entry.error === undefined])).toEqual([
      ['default', false, true, false],
      ['mio', false, false, true],
      ['academic', true, false, true],
      ['awesome', true, false, true],
      ['bold', true, false, true],
      ['chronological', true, false, true],
      ['classic', true, false, true],
      ['compact-grid', true, false, true],
      ['elegant', true, false, true],
      ['europass-like', true, false, true],
      ['executive', true, false, true],
      ['functional', true, false, true],
      ['hybrid', true, false, true],
      ['minimal', true, false, true],
      ['modern', true, false, true],
      ['monochrome', true, false, true],
      ['one-page', true, false, true],
      ['project-portfolio', true, false, true],
      ['skills-first', true, false, true],
      ['tech', true, false, true],
      ['timeline', true, false, true],
      ['warm', true, false, true],
    ]);
    expect(inventory[0]?.error).toMatch(/^Tema «default» inválido/);
    expect(inventory[5]?.description).toContain('Cronológica inversa');
    expect(inventory.map((entry) => entry.kind)).toEqual([undefined, undefined, 'style', 'style', 'style', 'organization', 'style', 'style', 'style', 'style', 'style', 'organization', 'organization', 'style', 'style', 'style', 'organization', 'organization', 'organization', 'style', 'style', 'style']);
    // Metadatos de autoría (T-8.3): los temas nuevos los declaran; los anteriores no los necesitan.
    expect(inventory[2]).toMatchObject({ author: 'Chameleon CV', license: 'MIT', homepage: 'https://nunzi00.github.io/chameleon-cv/guide/theme-gallery' });
    expect([inventory[6]?.name, inventory[6]?.author, inventory[6]?.license, inventory[6]?.homepage, inventory[1]?.author]).toEqual(['classic', undefined, undefined, undefined, undefined]);
    expect((await loadTheme('mio', roots)).ok && (await loadTheme('mio', roots))).toMatchObject({ theme: { root: project } });
  });
});
