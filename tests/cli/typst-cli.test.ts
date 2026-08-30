import { describe, expect, it } from 'vitest';

import { defaultAssets } from '../../src/shared/assets';
import { FONTS_DIRECTORY } from '../../src/renderers/pdf';
import { serializeProfile } from '../../src/artifact';
import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK, formatConflict, runCli, typstExitCode, type CliContext, type TypstRenderer } from '../../src/cli';
import { defaultSourceParsers } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import { type TypstRenderOptions, type TypstRenderResult } from '../../src/renderers/typst';
import { installTypst, typstStatus } from '../../src/typst';
import { MemoryLlmCache, llmStatus } from '../../src/llm';
import { themeToml } from '../fixtures/theme';
import { MemoryFileSystem, type MemoryEntry } from '../helpers/memory-file-system';
import { selectionProfile } from '../fixtures/selection';

interface Harness {
  readonly context: CliContext;
  readonly fs: MemoryFileSystem;
  readonly calls: TypstRenderOptions[];
  readonly stdout: () => string;
  readonly stderr: () => string;
}

const PDF = Buffer.from('%PDF-1.7 typst falso', 'latin1');

function harness(result: TypstRenderResult, tree: Record<string, string | MemoryEntry> = {}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const calls: TypstRenderOptions[] = [];
  const fs = new MemoryFileSystem({
    '/work/data/sources/profile.md': { kind: 'file', content: '---\nfullName: Ada\n---\n', mtimeMs: 100 },
    '/work/data/dist/profile.json': { kind: 'file', content: serializeProfile(selectionProfile()), mode: 0o600, mtimeMs: 500 },
    ...tree,
  });
  const typstRenderer: TypstRenderer = (_profile, options) => {
    calls.push(options);
    return Promise.resolve(result);
  };
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
    typstRenderer,
    typstInstall: (options, report) => installTypst(options, report),
    typstStatus: (options) => typstStatus(options),
    llmStatus: (options) => llmStatus(options),
    llmProvider: () => Promise.resolve({ ok: false as const, message: 'sin proveedor en las pruebas' }),
    llmCache: new MemoryLlmCache(),
    assets: defaultAssets(),
  };
  return { context, fs, calls, stdout: () => out.join(''), stderr: () => err.join('') };
}

const OK: TypstRenderResult = { ok: true, pdf: PDF, binary: { path: '/opt/typst', source: 'option' }, version: '0.15.1' };
const failure = (code: Parameters<typeof typstExitCode>[0], message: string): TypstRenderResult => ({ ok: false, error: { code, message } });

describe('cv generate-cv --format pdf --engine typst (T-3.2)', () => {
  it('escribe el PDF de Typst con permisos 0600 y pasa idioma, plantilla, binario y versión resueltos', async () => {
    const h = harness(OK, { '/work/plantillas/mia.typ': '#let cv(d) = d.fullName' });
    expect(await runCli(['generate-cv', '-s', 'backend', '--format', 'pdf', '--engine', 'typst'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe('CV escrito en /work/output/cv-ada-ejemplo-backend.pdf\n');
    expect(h.stderr()).toBe('');
    expect(h.fs.file('/work/output/cv-ada-ejemplo-backend.pdf')).toMatchObject({ mode: 0o600, bytes: PDF });
    expect(h.calls).toEqual([{ locale: undefined, template: undefined, explicitPath: undefined, allowAnyVersion: false, theme: expect.objectContaining({ name: 'default', builtin: true }), fontsDirectory: FONTS_DIRECTORY }]);

    const custom = harness(OK, { '/work/plantillas/mia.typ': '#let cv(d) = d.fullName' });
    expect(
      await runCli(['generate-cv', '--format', 'pdf', '--engine', 'TYPST', '-t', 'plantillas/mia.typ', '--typst-path', 'bin/typst', '--typst-any-version', '-l', 'en', '-o', 'salida/cv.pdf'], custom.context),
    ).toBe(EXIT_OK);
    expect(custom.calls).toEqual([{ locale: 'en', template: '/work/plantillas/mia.typ', explicitPath: '/work/bin/typst', allowAnyVersion: true, theme: expect.objectContaining({ name: 'default' }), fontsDirectory: FONTS_DIRECTORY }]);
    expect(custom.fs.file('/work/salida/cv.pdf')?.mode).toBe(0o600);
  });

  it('traduce los fallos: plantilla que no compila = 1 con el diagnóstico; binario, versión, plantilla ilegible, tiempo o proceso = 2', async () => {
    const compile = harness(failure('compile-error', '<stdin>:2:5: error: unknown variable: cv'));
    expect(await runCli(['generate-cv', '--format', 'pdf', '--engine', 'typst'], compile.context)).toBe(EXIT_DATA_ERROR);
    expect(compile.stderr()).toBe('La plantilla Typst no compiló:\n<stdin>:2:5: error: unknown variable: cv\n');
    expect(compile.fs.file('/work/output/cv-ada-ejemplo.pdf')).toBeUndefined();

    for (const [code, message] of [
      ['not-found', 'No se encontró Typst 0.15.1: …'],
      ['version-mismatch', 'Typst 0.14.0 en «/usr/bin/typst»; se requiere 0.15.1 (…)'],
      ['template-unreadable', 'No se pudo leer la plantilla Typst «/work/x.typ»'],
      ['timeout', 'Typst superó los 20000 ms permitidos y fue terminado'],
      ['failed', 'No se pudo ejecutar Typst: spawn EACCES'],
    ] as const) {
      const h = harness(failure(code, message));
      expect(await runCli(['generate-cv', '--format', 'pdf', '--engine', 'typst'], h.context)).toBe(EXIT_FAILURE);
      expect(h.stderr()).toBe(`${message}\n`);
      expect(typstExitCode(code)).toBe(EXIT_FAILURE);
    }
    expect(typstExitCode('compile-error')).toBe(EXIT_DATA_ERROR);
  });

  it('rechaza las combinaciones sin sentido antes de leer nada y un motor desconocido es un error de uso', async () => {
    const cases: ReadonlyArray<readonly [readonly string[], string]> = [
      [['--engine', 'typst'], '«--engine» solo aplica a «--format pdf»'],
      [['--format', 'pdf', '--engine', 'typst', '--stdout'], '«--stdout» solo admite «--format md»: el PDF es binario y se escribe siempre en un fichero (--output)'],
      [['--format', 'pdf', '-t', 'x.hbs'], '«--template» solo aplica a «--format md» o a «--engine typst»: pdfkit no usa plantilla'],
      [['--typst-path', 'x'], '«--typst-path» y «--typst-any-version» solo aplican a «--engine typst»'],
      [['--format', 'pdf', '--typst-any-version'], '«--typst-path» y «--typst-any-version» solo aplican a «--engine typst»'],
      [['--theme', 'mio'], '«--theme» solo aplica a «--engine typst» (con --format pdf)'],
    ];
    for (const [args, message] of cases) {
      const h = harness(OK);
      expect(await runCli(['generate-cv', ...args], h.context)).toBe(EXIT_FAILURE);
      expect(h.stderr()).toBe(`${message}\n`);
      expect(h.calls).toEqual([]);
      expect(h.fs.log).toEqual([]);
    }
    expect(formatConflict({ format: 'md', stdout: false, template: 'x.hbs', engine: 'pdfkit', typstPath: undefined, typstAnyVersion: false, theme: undefined })).toBeUndefined();
    expect(formatConflict({ format: 'pdf', stdout: false, template: 'x.typ', engine: 'typst', typstPath: undefined, typstAnyVersion: false, theme: undefined })).toBeUndefined();

    const unknown = harness(OK);
    expect(await runCli(['generate-cv', '--format', 'pdf', '--engine', 'latex'], unknown.context)).toBe(EXIT_FAILURE);
    expect(unknown.stderr()).toContain("error: option '--engine <engine>' argument 'latex' is invalid. motores admitidos: pdfkit, typst");
  });
});

describe('cv generate-cv --theme (T-5.1)', () => {
  it('carga un tema del proyecto (themes/<nombre>/) y lo pasa al renderizador; explica los temas inexistentes o inválidos', async () => {
    const h = harness(OK, { '/work/themes/mio/theme.toml': themeToml('mio'), '/work/themes/mio/template.typ': '#let cv(d, theme) = d.fullName' });
    expect(await runCli(['generate-cv', '--format', 'pdf', '--engine', 'typst', '--theme', 'mio'], h.context)).toBe(EXIT_OK);
    expect(h.calls[0]?.theme).toMatchObject({ name: 'mio', directory: '/work/themes/mio', templatePath: '/work/themes/mio/template.typ', builtin: false, config: { colors: { primary: '#222222' } } });

    const unknown = harness(OK);
    expect(await runCli(['generate-cv', '--format', 'pdf', '--engine', 'typst', '--theme', 'nada'], unknown.context)).toBe(EXIT_DATA_ERROR);
    expect(unknown.stderr()).toMatch(/^No existe el tema «nada» \(buscado en \/work\/themes, .*\); disponibles: academic, classic, default, minimal, modern\n$/);
    expect(unknown.calls).toEqual([]);

    const invalid = harness(OK, { '/work/themes/feo/theme.toml': themeToml('feo').replace('body = 10', 'body = 1'), '/work/themes/feo/template.typ': '' });
    expect(await runCli(['generate-cv', '--format', 'pdf', '--engine', 'typst', '--theme', 'feo'], invalid.context)).toBe(EXIT_DATA_ERROR);
    expect(invalid.stderr()).toBe('Tema «feo» inválido (/work/themes/feo/theme.toml):\n  - sizes.body: Tamaño demasiado pequeño (mínimo 4 pt)\n');
    expect(typstExitCode('theme-invalid')).toBe(EXIT_DATA_ERROR);
  });
});

describe('cv.toml (T-5.2): tema por defecto del proyecto y anulaciones', () => {
  it('cv.toml elige el tema y anula valores solo para esa ejecución; --theme prevalece; lo inválido se explica antes de renderizar', async () => {
    const h = harness(OK, { '/work/cv.toml': '[theme]\nname = "classic"\n[theme.colors]\nprimary = "#ff0000"\n[theme.fonts]\nbody = "Source Sans 3"\n' });
    expect(await runCli(['generate-cv', '--format', 'pdf', '--engine', 'typst', '--explain'], h.context)).toBe(EXIT_OK);
    expect(h.calls[0]?.theme).toMatchObject({ name: 'classic', builtin: true, config: { colors: { primary: '#ff0000', accent: '#6b2737' }, fonts: { body: 'Source Sans 3', heading: 'Libertinus Serif' } } });
    expect(h.stderr()).toContain('Tema: classic (distribuido); cv.toml anula colors.primary, fonts.body\n');

    const flag = harness(OK, { '/work/cv.toml': '[theme]\nname = "classic"\n' });
    expect(await runCli(['generate-cv', '--format', 'pdf', '--engine', 'typst', '--theme', 'default', '--explain'], flag.context)).toBe(EXIT_OK);
    expect(flag.calls[0]?.theme).toMatchObject({ name: 'default', config: { colors: { primary: '#1b1b1b' } } });
    expect(flag.stderr()).toContain('Tema: default (distribuido)\n');

    const invalid = harness(OK, { '/work/cv.toml': '[theme]\nprimary_color = "#ff0000"\n' });
    expect(await runCli(['generate-cv', '--format', 'pdf', '--engine', 'typst'], invalid.context)).toBe(EXIT_DATA_ERROR);
    expect(invalid.stderr()).toMatch(/^Configuración inválida \(\/work\/cv\.toml\):\n  - theme: .*primary_color/);
    expect(invalid.calls).toEqual([]);
    const project = harness(OK, { '/work/themes/mio/theme.toml': themeToml('mio'), '/work/themes/mio/template.typ': '', '/work/cv.toml': '[theme.sizes]\nbody = 11\n' });
    expect(await runCli(['generate-cv', '--format', 'pdf', '--engine', 'typst', '--theme', 'mio', '--explain'], project.context)).toBe(EXIT_OK);
    expect(project.stderr()).toContain('Tema: mio (del proyecto); cv.toml anula sizes.body\n');
    expect(project.calls[0]?.theme).toMatchObject({ name: 'mio', config: { sizes: { body: 11, name: 20 } } });
    // Sin Typst, cv.toml no interviene: pdfkit y Markdown lo ignoran.
    const markdown = harness(OK, { '/work/cv.toml': '[theme\n' });
    expect(await runCli(['generate-cv'], markdown.context)).toBe(EXIT_OK);
  });
});
