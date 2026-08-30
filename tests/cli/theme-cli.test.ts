import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultAssets } from '../../src/shared/assets';
import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK, THEME_FILE_MODE, runCli, type CliContext } from '../../src/cli';
import { MemoryLlmCache } from '../../src/llm';
import { defaultSourceParsers } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import { BUILTIN_THEMES_DIRECTORY, builtinThemeRoot, loadTheme, themeRoots } from '../../src/themes';
import { installTypst, typstStatus } from '../../src/typst';
import { defaultThemeConfig, themeToml } from '../fixtures/theme';
import { MemoryFileSystem, type MemoryEntry } from '../helpers/memory-file-system';

interface Harness {
  readonly context: CliContext;
  readonly fs: MemoryFileSystem;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

function harness(tree: Record<string, string | MemoryEntry> = {}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const fs = new MemoryFileSystem(tree);
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
    typstRenderer: () => Promise.reject(new Error('no usado')),
    typstInstall: (options, report) => installTypst(options, report),
    typstStatus: (options) => typstStatus(options),
    llmStatus: () => Promise.reject(new Error('no usado')),
    llmProvider: () => Promise.resolve({ ok: false as const, message: 'sin proveedor en las pruebas' }),
    llmCache: new MemoryLlmCache(),
    assets: defaultAssets(),
  };
  return { context, fs, stdout: () => out.join(''), stderr: () => err.join('') };
}

const PROJECT: Record<string, string | MemoryEntry> = {
  '/work/themes/mio/theme.toml': themeToml('mio'),
  '/work/themes/mio/template.typ': '#let cv(d, theme) = d.fullName',
  '/work/themes/default/theme.toml': themeToml('default'),
  '/work/themes/default/template.typ': '',
  '/work/themes/feo/theme.toml': themeToml('feo').replace('primary = "#222222"', 'primary = "verde"'),
  '/work/themes/feo/template.typ': '',
  '/work/themes/sin-config/template.typ': '',
};

describe('cv theme list (T-5.3)', () => {
  it('inventaría los temas distribuidos con su descripción y marca el tema por defecto', async () => {
    const h = harness();
    expect(await runCli(['theme', 'list'], h.context)).toBe(EXIT_OK);
    const describe = async (name: string): Promise<string> => {
      const loaded = await loadTheme(name, [builtinThemeRoot()]);
      return loaded.ok ? loaded.theme.config.theme.description ?? '' : '';
    };
    // Orden alfabético, nombre alineado al más largo; los temas de T-8.3 llevan autor y licencia.
    const credit = ' · autor: Chameleon CV · licencia: MIT';
    expect(h.stdout()).toBe(
      [
        `academic   distribuido   ${await describe('academic')}${credit}`,
        `awesome    distribuido   ${await describe('awesome')}${credit}`,
        `classic    distribuido   ${await describe('classic')}`,
        `default    distribuido   ${defaultThemeConfig().theme.description} · por defecto`,
        `executive  distribuido   ${await describe('executive')}${credit}`,
        `minimal    distribuido   ${await describe('minimal')}${credit}`,
        `modern     distribuido   ${await describe('modern')}${credit}`,
        `tech       distribuido   ${await describe('tech')}${credit}`,
        `timeline   distribuido   ${await describe('timeline')}${credit}`,
        '',
      ].join('\n'),
    );
    expect(h.stderr()).toBe(`9 temas en /work/themes y ${BUILTIN_THEMES_DIRECTORY}; elige uno con --theme <nombre> o con [theme] name en cv.toml\n`);
  });

  it('los temas del proyecto van primero, con su validez, si ocultan a un distribuido y el tema por defecto de cv.toml', async () => {
    const h = harness({ ...PROJECT, '/work/cv.toml': '[theme]\nname = "mio"\n' });
    expect(await runCli(['theme', 'list'], h.context)).toBe(EXIT_OK);
    expect(h.stdout().split('\n')).toEqual([
      'default    del proyecto  sin descripción · oculta al distribuido del mismo nombre',
      'feo        del proyecto  inválido: Tema «feo» inválido (/work/themes/feo/theme.toml): colors.primary: Color inválido: usa #rrggbb (p. ej. "#1f4e79")',
      'mio        del proyecto  sin descripción · por defecto',
      expect.stringMatching(/^academic   distribuido   Serif de una columna/),
      expect.stringMatching(/^awesome    distribuido   Estilo Awesome-CV/),
      expect.stringMatching(/^classic    distribuido   Serif tradicional/),
      expect.stringMatching(/^executive  distribuido   Ejecutivo tipo banking/),
      expect.stringMatching(/^minimal    distribuido   Monocromo/),
      expect.stringMatching(/^modern     distribuido   Contemporáneo/),
      expect.stringMatching(/^tech       distribuido   Skills-first/),
      expect.stringMatching(/^timeline   distribuido   Línea de tiempo/),
      '',
    ]);
    expect(h.stderr()).toContain('11 temas en /work/themes y ');
    const broken = harness({ '/work/cv.toml': '[theme\n' });
    expect(await runCli(['theme', 'list'], broken.context)).toBe(EXIT_OK);
    expect(broken.stderr()).toMatch(/^Aviso: Configuración inválida \(\/work\/cv\.toml\):\n  - línea 1: /);
    expect(broken.stdout()).toContain('default    distribuido   ');
    expect(broken.stdout()).toContain(' · por defecto\n');
  });
});

describe('cv theme path <nombre>', () => {
  it('imprime la ruta del tema (distribuido o del proyecto); si existe pero no es utilizable, la imprime con un aviso', async () => {
    const h = harness(PROJECT);
    expect(await runCli(['theme', 'path', 'classic'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe(`${join(BUILTIN_THEMES_DIRECTORY, 'classic')}\n`);
    const project = harness(PROJECT);
    expect(await runCli(['theme', 'path', 'mio'], project.context)).toBe(EXIT_OK);
    expect(project.stdout()).toBe('/work/themes/mio\n');
    expect(project.stderr()).toBe('');
    const invalid = harness(PROJECT);
    expect(await runCli(['theme', 'path', 'feo'], invalid.context)).toBe(EXIT_OK);
    expect(invalid.stdout()).toBe('/work/themes/feo\n');
    expect(invalid.stderr()).toContain('Aviso: Tema «feo» inválido (/work/themes/feo/theme.toml):\n  - colors.primary: ');
    const incomplete = harness(PROJECT);
    expect(await runCli(['theme', 'path', 'sin-config'], incomplete.context)).toBe(EXIT_OK);
    expect(incomplete.stdout()).toBe('/work/themes/sin-config\n');
    expect(incomplete.stderr()).toBe('Aviso: El tema «sin-config» (/work/themes/sin-config) no tiene theme.toml\n');
  });

  it('explica el tema inexistente y el nombre inválido', async () => {
    const missing = harness();
    expect(await runCli(['theme', 'path', 'nada'], missing.context)).toBe(EXIT_DATA_ERROR);
    expect(missing.stderr()).toBe(`No existe el tema «nada» (buscado en /work/themes, ${BUILTIN_THEMES_DIRECTORY}); disponibles: academic, awesome, classic, default, executive, minimal, modern, tech, timeline\n`);
    expect(missing.stdout()).toBe('');
    const bad = harness();
    expect(await runCli(['theme', 'path', '../default'], bad.context)).toBe(EXIT_DATA_ERROR);
    expect(bad.stderr()).toBe('Nombre de tema inválido «../default»: minúsculas, dígitos y guiones (p. ej. «mio»)\n');
  });
});

describe('cv theme create <nombre>', () => {
  it('levanta themes/<nombre>/ a partir de default con el nombre cambiado, listo para --theme', async () => {
    const h = harness();
    expect(await runCli(['theme', 'create', 'mio'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe(
      `Tema «mio» creado en /work/themes/mio a partir de «default»: theme.toml, template.typ\nEdita theme.toml (colores, fuentes, tamaños, espaciados, página) o template.typ (maquetación) y genera con: cv generate-cv --format pdf --engine typst --theme mio\n`,
    );
    expect(h.stderr()).toBe('');
    const config = h.fs.file('/work/themes/mio/theme.toml');
    expect(config?.mode).toBe(THEME_FILE_MODE);
    expect(config?.content).toContain('name = "mio"\n');
    expect(config?.content).not.toContain('name = "default"');
    expect(config?.content).toContain(`description = "${defaultThemeConfig().theme.description}"`);
    expect(h.fs.file('/work/themes/mio/template.typ')?.content).toBe(readFileSync(join(BUILTIN_THEMES_DIRECTORY, 'default', 'template.typ'), 'utf8'));
    const loaded = await loadTheme('mio', themeRoots('/work', h.fs));
    expect(loaded).toMatchObject({ ok: true, theme: { name: 'mio', builtin: false, config: { theme: { name: 'mio' }, colors: defaultThemeConfig().colors } } });

    expect(await runCli(['theme', 'create', 'mio'], h.context)).toBe(EXIT_DATA_ERROR);
    expect(h.stderr()).toBe('Ya existe /work/themes/mio: elige otro nombre o bórralo antes (nunca se sobrescribe un tema)\n');
  });

  it('--from copia otro tema (incluidas sus fuentes) y avisa cuando el nuevo tema oculta a uno distribuido', async () => {
    const h = harness({
      '/work/themes/conf/theme.toml': themeToml('conf'),
      '/work/themes/conf/template.typ': '#let cv(d, theme) = [conf]',
      '/work/themes/conf/fonts/A.ttf': 'AAA',
      '/work/themes/conf/fonts/sub': { kind: 'directory' },
      '/work/themes/vacio/theme.toml': themeToml('vacio'),
      '/work/themes/vacio/template.typ': '',
      '/work/themes/vacio/fonts': { kind: 'directory' },
    });
    expect(await runCli(['theme', 'create', 'copia', '--from', 'conf'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('Tema «copia» creado en /work/themes/copia a partir de «conf»: theme.toml, template.typ, fonts/ (1 fichero)\n');
    expect(h.fs.file('/work/themes/copia/fonts/A.ttf')?.bytes).toEqual(Buffer.from('AAA'));
    expect(h.fs.file('/work/themes/copia/theme.toml')?.content).toContain('name = "copia"');
    expect(h.fs.file('/work/themes/copia/template.typ')?.content).toBe('#let cv(d, theme) = [conf]');
    expect(await runCli(['theme', 'create', 'sin-fuentes', '--from', 'vacio'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('a partir de «vacio»: theme.toml, template.typ\n');
    expect(h.fs.file('/work/themes/sin-fuentes/fonts/A.ttf')).toBeUndefined();

    const classic = harness();
    expect(await runCli(['theme', 'create', 'serio', '--from', 'classic'], classic.context)).toBe(EXIT_OK);
    expect(classic.fs.file('/work/themes/serio/template.typ')?.content).toContain('Tema «classic»');
    expect(classic.fs.file('/work/themes/serio/theme.toml')?.content).toContain('name = "serio"');

    const shadow = harness();
    expect(await runCli(['theme', 'create', 'default'], shadow.context)).toBe(EXIT_OK);
    expect(shadow.stderr()).toBe('Aviso: «default» también es un tema distribuido; el del proyecto prevalecerá\n');
    expect(await loadTheme('default', themeRoots('/work', shadow.fs))).toMatchObject({ ok: true, theme: { builtin: false, directory: '/work/themes/default' } });
  });

  it('explica el nombre inválido, el origen inexistente y los fallos de escritura', async () => {
    const bad = harness();
    expect(await runCli(['theme', 'create', 'Mal'], bad.context)).toBe(EXIT_DATA_ERROR);
    expect(bad.stderr()).toBe('Nombre de tema inválido «Mal»: minúsculas, dígitos y guiones (p. ej. «mio»)\n');
    const missing = harness();
    expect(await runCli(['theme', 'create', 'x', '--from', 'nada'], missing.context)).toBe(EXIT_DATA_ERROR);
    expect(missing.stderr()).toMatch(/^No se puede partir del tema «nada»: No existe el tema «nada» /);
    expect(missing.fs.file('/work/themes/x/theme.toml')).toBeUndefined();
    const failing = harness();
    failing.fs.failures.add('writeFile');
    expect(await runCli(['theme', 'create', 'x'], failing.context)).toBe(EXIT_FAILURE);
    expect(failing.stderr()).toBe('No se pudo crear el tema en /work/themes/x: fallo simulado en writeFile\n');
  });
});
