import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseMasterProfile } from '../../../src/core/schema';
import { selectForSpecialty } from '../../../src/core/selection';
import { extractPdfText } from '../../../src/pdf';
import { FONTS_DIRECTORY } from '../../../src/renderers/pdf';
import { buildStructuredView } from '../../../src/renderers/structured';
import {
  DEFAULT_PREVIEW_PPI,
  DEFAULT_TYPST_TEMPLATE,
  NETWORK_KILL_SWITCH,
  TYPST_VERSION,
  isReadableFile,
  mainDocument,
  notFoundMessage,
  renderTypstCv,
  renderTypstPreview,
  type ProcessOutcome,
  type ProcessRequest,
  type ProcessRunner,
  type TypstRenderOptions,
} from '../../../src/renderers/typst';
import { builtinThemeRoot, loadTheme } from '../../../src/themes';
import { fullProfileInput, minimalProfileInput } from '../../fixtures/master-profile';
import { selectionProfile } from '../../fixtures/selection';
import { defaultThemeConfig, themeToml } from '../../fixtures/theme';
import { MemoryFileSystem } from '../../helpers/memory-file-system';

const PDF = Buffer.from('%PDF-1.7 falso', 'latin1');
const VERSION_OK: ProcessOutcome = { kind: 'exited', status: 0, stdout: Buffer.from(`typst ${TYPST_VERSION} (abc)\n`), stderr: '' };

/** Runner simulado: la primera llamada es `--version`, la segunda la compilación. */
function fakeRunner(version: ProcessOutcome, compile: ProcessOutcome, calls: ProcessRequest[] = []): ProcessRunner {
  return (request) => {
    calls.push(request);
    return Promise.resolve(request.args[0] === '--version' ? version : compile);
  };
}

const FOUND: TypstRenderOptions = { env: {}, platform: 'linux', home: '/h', explicitPath: '/opt/typst', isExecutable: () => Promise.resolve(true) };

function backend() {
  const selection = selectForSpecialty(selectionProfile(), 'backend');
  if (!selection.ok) {
    throw new Error('selección');
  }
  return selection.selection.profile;
}

describe('renderTypstCv (runner simulado)', () => {
  it('sin binario explica dónde ha buscado', async () => {
    const result = await renderTypstCv(backend(), { env: {}, platform: 'linux', home: '/h', isExecutable: () => Promise.resolve(false), runner: fakeRunner(VERSION_OK, VERSION_OK) });
    expect(result).toEqual({ ok: false, error: { code: 'not-found', message: notFoundMessage() } });
    expect(notFoundMessage()).toContain(TYPST_VERSION);
    // Con los valores por defecto (entorno, plataforma y runner reales) el resultado es el mismo si nada es ejecutable.
    expect(await renderTypstCv(backend(), { isExecutable: () => Promise.resolve(false) })).toEqual({ ok: false, error: { code: 'not-found', message: notFoundMessage() } });
  });

  it('exige la versión fijada salvo allowAnyVersion, y explica si --version falla', async () => {
    const old: ProcessOutcome = { kind: 'exited', status: 0, stdout: Buffer.from('typst 0.14.0 (x)\n'), stderr: '' };
    expect(await renderTypstCv(backend(), { ...FOUND, runner: fakeRunner(old, { kind: 'exited', status: 0, stdout: PDF, stderr: '' }) })).toEqual({
      ok: false,
      error: { code: 'version-mismatch', message: `Typst 0.14.0 en «/opt/typst»; se requiere ${TYPST_VERSION} (o usa --typst-any-version bajo tu responsabilidad)` },
    });
    const any = await renderTypstCv(backend(), { ...FOUND, allowAnyVersion: true, runner: fakeRunner(old, { kind: 'exited', status: 0, stdout: PDF, stderr: '' }) });
    expect(any).toMatchObject({ ok: true, version: '0.14.0', binary: { path: '/opt/typst', source: 'option' } });
    expect(await renderTypstCv(backend(), { ...FOUND, runner: fakeRunner({ kind: 'failed', message: 'EACCES' }, VERSION_OK) })).toEqual({
      ok: false,
      error: { code: 'failed', message: 'No se pudo ejecutar Typst en «/opt/typst»: EACCES' },
    });
  });

  it('compila el documento principal con la vista, el root de la plantilla, las fuentes propias y la fecha reproducible', async () => {
    const calls: ProcessRequest[] = [];
    const profile = parseMasterProfile(minimalProfileInput());
    const result = await renderTypstCv(profile, { ...FOUND, runner: fakeRunner(VERSION_OK, { kind: 'exited', status: 0, stdout: PDF, stderr: '' }, calls) });
    expect(result).toEqual({ ok: true, pdf: PDF, binary: { path: '/opt/typst', source: 'option' }, version: TYPST_VERSION });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ file: '/opt/typst', args: ['--version'] });
    const compile = calls[1];
    expect(compile).toMatchObject({ file: '/opt/typst', cwd: dirname(DEFAULT_TYPST_TEMPLATE), input: mainDocument(buildStructuredView(profile, 'es'), '/template.typ', defaultThemeConfig()) });
    expect(compile?.args).toEqual(expect.arrayContaining(['--root', dirname(DEFAULT_TYPST_TEMPLATE), '--font-path', FONTS_DIRECTORY, '--creation-timestamp', '946684800']));
    expect(compile?.env).toMatchObject({ HTTPS_PROXY: NETWORK_KILL_SWITCH });
    expect(compile?.env?.['HOME']).toBeUndefined();

    const dated: ProcessRequest[] = [];
    await renderTypstCv(parseMasterProfile({ ...minimalProfileInput(), meta: { schemaVersion: 1, updatedAt: '2026-08-28' } }), { ...FOUND, locale: 'en', runner: fakeRunner(VERSION_OK, { kind: 'exited', status: 0, stdout: PDF, stderr: '' }, dated) });
    expect(dated[1]?.args).toEqual(expect.arrayContaining(['--creation-timestamp', String(Date.UTC(2026, 7, 28) / 1000)]));
    expect(dated[1]?.input).toContain('Experience');
  });

  it('admite una plantilla propia (root = su directorio) y detecta la ilegible', async () => {
    const calls: ProcessRequest[] = [];
    const result = await renderTypstCv(backend(), { ...FOUND, template: '/plantillas/mia.typ', isReadable: () => Promise.resolve(true), runner: fakeRunner(VERSION_OK, { kind: 'exited', status: 0, stdout: PDF, stderr: '' }, calls) });
    expect(result.ok).toBe(true);
    expect(calls[1]).toMatchObject({ cwd: '/plantillas' });
    expect(calls[1]?.args).toEqual(expect.arrayContaining(['--root', '/plantillas']));
    expect(calls[1]?.input?.startsWith('#import "/mia.typ": cv\n')).toBe(true);
    expect(await renderTypstCv(backend(), { ...FOUND, template: '/no/existe.typ', runner: fakeRunner(VERSION_OK, VERSION_OK) })).toEqual({
      ok: false,
      error: { code: 'template-unreadable', message: 'No se pudo leer la plantilla Typst «/no/existe.typ»' },
    });
    expect(await isReadableFile(DEFAULT_TYPST_TEMPLATE)).toBe(true);
    expect(readFileSync(DEFAULT_TYPST_TEMPLATE, 'utf8')).toContain('#let cv(d, theme)');
  });

  it('traduce los errores de compilación y las excepciones del runner', async () => {
    expect(await renderTypstCv(backend(), { ...FOUND, runner: fakeRunner(VERSION_OK, { kind: 'exited', status: 1, stdout: Buffer.alloc(0), stderr: '<stdin>:1:1: error: x' }) })).toEqual({
      ok: false,
      error: { code: 'compile-error', message: '<stdin>:1:1: error: x' },
    });
    expect(await renderTypstCv(backend(), { ...FOUND, timeoutMs: 100, runner: fakeRunner(VERSION_OK, { kind: 'timeout' }) })).toEqual({
      ok: false,
      error: { code: 'timeout', message: 'Typst superó los 100 ms permitidos y fue terminado' },
    });
    const throwing: ProcessRunner = (request) => (request.args[0] === '--version' ? Promise.resolve(VERSION_OK) : Promise.reject(new Error('se rompió')));
    expect(await renderTypstCv(backend(), { ...FOUND, runner: throwing })).toEqual({ ok: false, error: { code: 'failed', message: 'No se pudo ejecutar Typst: se rompió' } });
  });
});

const GOLDEN_PDFKIT = readFileSync(join(__dirname, '../../fixtures/golden/cv-backend.pdf.txt'), 'utf8');
const GOLDEN_TYPST = readFileSync(join(__dirname, '../../fixtures/golden/cv-backend.typst.txt'), 'utf8');

/** Palabras de un texto extraído, sin viñetas ni separadores de maquetación: lo que no puede perderse. */
function contentWords(text: string): string[] {
  return text
    .split(/\s+/)
    .filter((word) => word !== '' && word !== '•' && word !== '·')
    .sort((a, b) => a.localeCompare(b, 'es'));
}

/** Con el binario real (CHAMELEON_TYPST): aceptación §6.3 y sondas de contención §3.2 de docs/typst-integration.md. */
describe.skipIf(process.env['CHAMELEON_TYPST'] === undefined)('renderTypstCv (binario real)', () => {
  it('round-trip: el texto extraído es el golden de Typst y contiene exactamente las palabras del golden de pdfkit; determinista, etiquetado, sin código', async () => {
    const first = await renderTypstCv(backend());
    const second = await renderTypstCv(backend());
    if (!first.ok || !second.ok) {
      throw new Error(JSON.stringify([first, second]));
    }
    expect(first.version).toBe(TYPST_VERSION);
    expect(first.pdf.equals(second.pdf)).toBe(true);
    const bytes = first.pdf.toString('latin1');
    expect(bytes.startsWith('%PDF-1.7')).toBe(true);
    expect(bytes).toContain('/FontFile2');
    expect(bytes).toContain('/StructTreeRoot');
    for (const forbidden of ['/JavaScript', '/JS', '/Launch', '/OpenAction', '/AA', '/EmbeddedFile']) {
      expect(bytes).not.toContain(forbidden);
    }
    const extracted = await extractPdfText(first.pdf);
    expect(extracted).toEqual({ ok: true, text: GOLDEN_TYPST, pages: 1 });
    // El diseño (T-3.4) reordena líneas —fechas a la derecha, versalitas, tabla de skills—, nunca el contenido.
    expect(contentWords(GOLDEN_TYPST)).toEqual(contentWords(GOLDEN_PDFKIT));
  });

  it('el tema classic (serif, cabecera centrada, mayúsculas) conserva exactamente las palabras del diseño de referencia', async () => {
    const classic = await loadTheme('classic', [builtinThemeRoot()]);
    if (!classic.ok) throw new Error(classic.message);
    const result = await renderTypstCv(backend(), { theme: classic.theme });
    if (!result.ok) throw new Error(result.error.message);
    const extracted = await extractPdfText(result.pdf);
    expect(extracted).toMatchObject({ ok: true, pages: 1 });
    const normalize = (text: string): string[] => contentWords(text.toLowerCase().replace(/[,–]/g, ' '));
    expect(normalize(extracted.ok ? extracted.text : '')).toEqual(normalize(GOLDEN_PDFKIT));
    expect(result.pdf.toString('latin1')).toContain('LibertinusSerif');
  });

  it('pagina los CV largos con pie de página «nombre · n / total» y mantiene los títulos pegados a su contenido', async () => {
    const input = fullProfileInput();
    input.experience![0]!.achievements = Array.from({ length: 45 }, (_, index) => ({ id: `ach-${index}`, text: `Logro número ${index} con **texto** suficiente para ocupar una línea entera del documento y algo más.`, tags: ['php'] }));
    const result = await renderTypstCv(parseMasterProfile(input));
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    const extracted = await extractPdfText(result.pdf);
    expect(extracted).toMatchObject({ ok: true, pages: 2 });
    expect(extracted.ok && extracted.text).toContain('Ada Ejemplo · 1 / 2');
    expect(extracted.ok && extracted.text).toContain('Ada Ejemplo · 2 / 2');
    expect(extracted.ok && extracted.text).toContain('Logro número 44');
  });

  it('contención: una plantilla no puede salir del root, ni descargar paquetes, ni colgar el proceso', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chameleon-typst-sandbox-'));
    try {
      await writeFile(join(directory, 'secreto.txt'), 'no', 'utf8');
      const templates = join(directory, 'tpl');
      await writeFile(join(directory, 'escape.typ'), '#let cv(d, theme) = read("../secreto.txt")\n', 'utf8');
      await writeFile(join(directory, 'absolute.typ'), '#let cv(d, theme) = read("/etc/passwd")\n', 'utf8');
      await writeFile(join(directory, 'package.typ'), '#import "@preview/tablex:0.0.9": tablex\n#let cv(d, theme) = tablex()\n', 'utf8');
      // Typst corta por sí mismo los bucles infinitos («loop seems to be infinite»); un trabajo finito pero
      // enorme (cientos de miles de páginas) es lo que debe matar nuestro límite de tiempo.
      await writeFile(join(directory, 'loop.typ'), '#let cv(d, theme) = { for i in range(300000) { [p#i]; pagebreak() } }\n', 'utf8');
      void templates;

      const escape = await renderTypstCv(backend(), { template: join(directory, 'escape.typ') });
      expect(escape).toMatchObject({ ok: false, error: { code: 'compile-error' } });
      expect(!escape.ok && escape.error.message).toContain('would escape the project root');

      const absolute = await renderTypstCv(backend(), { template: join(directory, 'absolute.typ') });
      expect(absolute).toMatchObject({ ok: false, error: { code: 'compile-error' } });
      expect(!absolute.ok && absolute.error.message).toContain('file not found');

      const started = Date.now();
      const pkg = await renderTypstCv(backend(), { template: join(directory, 'package.typ') });
      expect(pkg).toMatchObject({ ok: false, error: { code: 'compile-error' } });
      expect(!pkg.ok && pkg.error.message).toMatch(/failed to download package|package not found/);
      expect(Date.now() - started).toBeLessThan(5_000);

      const loop = await renderTypstCv(backend(), { template: join(directory, 'loop.typ'), timeoutMs: 1_000 });
      expect(loop).toEqual({ ok: false, error: { code: 'timeout', message: 'Typst superó los 1000 ms permitidos y fue terminado' } });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('renderTypstCv con temas (T-5.1)', () => {
  it('usa la plantilla y las fuentes del tema cargado, y sin tema carga el default distribuido', async () => {
    const calls: ProcessRequest[] = [];
    const fs = new MemoryFileSystem({ '/work/themes/mio/theme.toml': themeToml('mio'), '/work/themes/mio/template.typ': '#let cv(d, theme) = d.fullName', '/work/themes/mio/fonts/x.ttf': '' });
    const loaded = await loadTheme('mio', [{ directory: '/work/themes', fileSystem: fs, builtin: false }]);
    if (!loaded.ok) throw new Error(loaded.message);
    const result = await renderTypstCv(backend(), { ...FOUND, theme: loaded.theme, isReadable: () => Promise.resolve(true), runner: fakeRunner(VERSION_OK, { kind: 'exited', status: 0, stdout: PDF, stderr: '' }, calls) });
    expect(result.ok).toBe(true);
    expect(calls[1]).toMatchObject({ cwd: '/work/themes/mio' });
    expect(calls[1]?.args).toEqual(expect.arrayContaining(['--root', '/work/themes/mio', '--font-path', FONTS_DIRECTORY, '--font-path', '/work/themes/mio/fonts']));
    expect(calls[1]?.input).toContain('\\"paper\\":\\"us-letter\\"');
    expect(calls[1]?.input?.startsWith('#import "/template.typ": cv\n')).toBe(true);
    // Plantilla propia con el tema: el root es el de la plantilla; el tema sigue viajando.
    const custom: ProcessRequest[] = [];
    await renderTypstCv(backend(), { ...FOUND, theme: loaded.theme, template: '/plantillas/mia.typ', isReadable: () => Promise.resolve(true), runner: fakeRunner(VERSION_OK, { kind: 'exited', status: 0, stdout: PDF, stderr: '' }, custom) });
    expect(custom[1]).toMatchObject({ cwd: '/plantillas' });
    expect(custom[1]?.input).toContain('\\"name\\":\\"mio\\"');
    // Sin tema y sin el default distribuido a mano: error explicado.
    const missing = await renderTypstCv(backend(), { ...FOUND, builtinThemes: { directory: '/vacio', fileSystem: new MemoryFileSystem({}), builtin: true }, runner: fakeRunner(VERSION_OK, VERSION_OK) });
    expect(missing).toEqual({ ok: false, error: { code: 'theme-invalid', message: 'No existe el tema «default» (buscado en /vacio); disponibles: ninguno' } });
  });
});

describe('renderTypstPreview (T-8.3): la primera página como PNG', () => {
  const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('png falso', 'latin1')]);
  const PNG_OK: ProcessOutcome = { kind: 'exited', status: 0, stdout: PNG, stderr: '' };

  it('usa el mismo proceso contenido con --format png a 96 ppp por defecto o la resolución pedida; los errores son los del PDF', async () => {
    const calls: ProcessRequest[] = [];
    const result = await renderTypstPreview(backend(), { ...FOUND, runner: fakeRunner(VERSION_OK, PNG_OK, calls) });
    expect(result).toMatchObject({ ok: true, png: PNG, version: TYPST_VERSION });
    expect(calls[1]?.args.slice(-6)).toEqual(['--format', 'png', '--ppi', String(DEFAULT_PREVIEW_PPI), '--pages', '1']);
    expect(calls[1]?.input).toContain('#import "/template.typ": cv');
    const custom: ProcessRequest[] = [];
    await renderTypstPreview(backend(), { ...FOUND, ppi: 150, runner: fakeRunner(VERSION_OK, PNG_OK, custom) });
    expect(custom[1]?.args.slice(-6)).toEqual(['--format', 'png', '--ppi', '150', '--pages', '1']);
    const pdfInstead: ProcessOutcome = { kind: 'exited', status: 0, stdout: PDF, stderr: '' };
    expect(await renderTypstPreview(backend(), { ...FOUND, runner: fakeRunner(VERSION_OK, pdfInstead) })).toEqual({
      ok: false,
      error: { code: 'failed', message: 'La salida de Typst no es un PNG' },
    });
    expect(await renderTypstPreview(backend(), { env: {}, platform: 'linux', home: '/h', isExecutable: () => Promise.resolve(false) })).toEqual({
      ok: false,
      error: { code: 'not-found', message: notFoundMessage() },
    });
  });

  describe.skipIf(process.env['CHAMELEON_TYPST'] === undefined)('binario real', () => {
    it('produce un PNG determinista de la primera página (A4 a 96 ppp: 794 × 1123 px) y la resolución cambia el tamaño', async () => {
      const first = await renderTypstPreview(backend());
      const second = await renderTypstPreview(backend());
      if (!first.ok || !second.ok) {
        throw new Error(JSON.stringify([first, second]));
      }
      expect(first.png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))).toBe(true);
      expect([first.png.readUInt32BE(16), first.png.readUInt32BE(20)]).toEqual([794, 1123]);
      expect(first.png.equals(second.png)).toBe(true);
      const small = await renderTypstPreview(backend(), { ppi: 24 });
      expect(small.ok && small.png.length < first.png.length).toBe(true);
    });
  });
});
