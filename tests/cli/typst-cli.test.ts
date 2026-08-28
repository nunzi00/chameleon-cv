import { describe, expect, it } from 'vitest';

import { serializeProfile } from '../../src/artifact';
import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK, formatConflict, runCli, typstExitCode, type CliContext, type TypstRenderer } from '../../src/cli';
import { defaultSourceParsers } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import { type TypstRenderOptions, type TypstRenderResult } from '../../src/renderers/typst';
import { installTypst, typstStatus } from '../../src/typst';
import { MemoryLlmCache, llmStatus } from '../../src/llm';
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
    llmProvider: () => ({ ok: false, message: 'sin proveedor en las pruebas' }),
    llmCache: new MemoryLlmCache(),
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
    expect(h.calls).toEqual([{ locale: undefined, template: undefined, explicitPath: undefined, allowAnyVersion: false }]);

    const custom = harness(OK, { '/work/plantillas/mia.typ': '#let cv(d) = d.fullName' });
    expect(
      await runCli(['generate-cv', '--format', 'pdf', '--engine', 'TYPST', '-t', 'plantillas/mia.typ', '--typst-path', 'bin/typst', '--typst-any-version', '-l', 'en', '-o', 'salida/cv.pdf'], custom.context),
    ).toBe(EXIT_OK);
    expect(custom.calls).toEqual([{ locale: 'en', template: '/work/plantillas/mia.typ', explicitPath: '/work/bin/typst', allowAnyVersion: true }]);
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
    ];
    for (const [args, message] of cases) {
      const h = harness(OK);
      expect(await runCli(['generate-cv', ...args], h.context)).toBe(EXIT_FAILURE);
      expect(h.stderr()).toBe(`${message}\n`);
      expect(h.calls).toEqual([]);
      expect(h.fs.log).toEqual([]);
    }
    expect(formatConflict({ format: 'md', stdout: false, template: 'x.hbs', engine: 'pdfkit', typstPath: undefined, typstAnyVersion: false })).toBeUndefined();
    expect(formatConflict({ format: 'pdf', stdout: false, template: 'x.typ', engine: 'typst', typstPath: undefined, typstAnyVersion: false })).toBeUndefined();

    const unknown = harness(OK);
    expect(await runCli(['generate-cv', '--format', 'pdf', '--engine', 'latex'], unknown.context)).toBe(EXIT_FAILURE);
    expect(unknown.stderr()).toContain("error: option '--engine <engine>' argument 'latex' is invalid. motores admitidos: pdfkit, typst");
  });
});
