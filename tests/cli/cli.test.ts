import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { NodeWritableFileSystem, serializeProfile } from '../../src/artifact';
import {
  EXIT_DATA_ERROR,
  EXIT_FAILURE,
  EXIT_OK,
  OUTPUT_MODE,
  checkArtifactFreshness,
  createNodeContext,
  defaultOutputPath,
  formatDatasetError,
  formatSelectionReport,
  packageVersion,
  pluralize,
  readVersion,
  runCli,
  slugify,
  type CliContext,
} from '../../src/cli';
import { parseMasterProfile } from '../../src/core/schema';
import { selectForSpecialty } from '../../src/core/selection';
import { NodeFileSystem, defaultSourceParsers } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import { describeError } from '../../src/shared/errors';
import { MemoryFileSystem, datasetTree, type MemoryEntry } from '../helpers/memory-file-system';
import { selectionProfile } from '../fixtures/selection';

interface Harness {
  readonly context: CliContext;
  readonly fs: MemoryFileSystem;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

function harness(tree: Record<string, string | MemoryEntry> = datasetTree(), overrides: Partial<CliContext> = {}): Harness {
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
    ...overrides,
  };
  return { context, fs, stdout: () => out.join(''), stderr: () => err.join('') };
}

const GOLDEN = readFileSync(join(__dirname, '../fixtures/golden/cv-backend.md'), 'utf8');
const VALID = datasetTree({ '/work/data/sources/profile.md': '---\nfullName: Ada\n---\n', '/work/data/sources/skills.csv': 'name\nPHP\n' });

/** Fuentes válidas (más antiguas que el artefacto) y el artefacto del perfil de selección ya compilado. */
function compiled(): Harness {
  return harness({
    '/work/data/sources/profile.md': { kind: 'file', content: '---\nfullName: Ada\n---\n', mtimeMs: 100 },
    '/work/data/dist/profile.json': { kind: 'file', content: serializeProfile(selectionProfile()), mode: 0o600, mtimeMs: 500 },
  });
}

describe('cv build-profile', () => {
  it('escribe el artefacto en silencio cuando las fuentes son válidas', async () => {
    const h = harness(VALID);
    expect(await runCli(['build-profile'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe('');
    expect(h.stderr()).toBe('');
    const artifact = h.fs.file('/work/data/dist/profile.json');
    expect(artifact?.mode).toBe(0o600);
    const written: unknown = JSON.parse(artifact?.content ?? '{}');
    expect(written).toMatchObject({ personal: { fullName: 'Ada' }, skills: [{ id: 'skill-1', name: 'PHP' }] });
  });

  it('admite rutas propias y un resumen con --verbose', async () => {
    const h = harness(datasetTree({ '/work/fuentes/profile.md': '---\nfullName: Ada\n---\n' }));
    expect(await runCli(['build-profile', '--data', 'fuentes', '--out', 'build/perfil.json', '-v'], h.context)).toBe(EXIT_OK);
    expect(h.fs.file('/work/build/perfil.json')).toBeDefined();
    expect(h.stdout()).toBe(
      'Artefacto escrito en /work/build/perfil.json (1 fichero: 0 especialidades, 0 experiencias, 0 proyectos, 0 formaciones, 0 skills, 0 certificaciones, 0 logros transversales, 0 idiomas)\n',
    );
  });

  it('con fuentes inválidas imprime todos los problemas con fichero:línea, no escribe nada y sale con 1', async () => {
    const h = harness(
      datasetTree({
        '/work/data/sources/profile.md': '---\nfullName: Ada\nemail: nope\n---\n',
        '/work/data/sources/experience/acme.md': '---\ncompany: ACME\nrole: Dev\nstart: 2020-13\n---\n',
        '/work/data/sources/notas.md': '',
      }),
    );
    expect(await runCli(['build-profile'], h.context)).toBe(EXIT_DATA_ERROR);
    expect(h.stdout()).toBe('');
    expect(h.stderr()).toBe(
      'notas.md: Fichero no reconocido en la raíz del dataset (admitidos: profile.md, achievements.md, skills.csv, certifications.csv)\n1 problema en /work/data/sources\n',
    );
    expect(h.fs.file('/work/data/dist/profile.json')).toBeUndefined();
  });

  it('cuando no puede escribir el artefacto lo explica y sale con 2', async () => {
    const h = harness(VALID);
    h.fs.failures.add('mkdir');
    expect(await runCli(['build-profile'], h.context)).toBe(EXIT_FAILURE);
    expect(h.stderr()).toBe('No se pudo escribir el artefacto «/work/data/dist/profile.json»: fallo simulado en mkdir\n');
  });
});

describe('cv validate', () => {
  it('confirma un dataset válido con un resumen', async () => {
    const h = harness(VALID);
    expect(await runCli(['validate'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe(
      'Dataset válido: 2 ficheros en /work/data/sources (0 especialidades, 0 experiencias, 0 proyectos, 0 formaciones, 1 skill, 0 certificaciones, 0 logros transversales, 0 idiomas)\n',
    );
    expect(h.fs.file('/work/data/dist/profile.json')).toBeUndefined();
  });

  it('reporta los problemas semánticos de varios ficheros y sale con 1', async () => {
    const h = harness(
      datasetTree({
        '/work/data/sources/profile.md': '---\nfullName: Ada\nemail: nope\n---\n',
        '/work/data/sources/experience/acme.md': '---\ncompany: ACME\nrole: Dev\nstart: 2020-13\n---\n',
      }),
    );
    expect(await runCli(['validate', '-d', 'data/sources'], h.context)).toBe(EXIT_DATA_ERROR);
    expect(h.stderr().split('\n')).toEqual([
      expect.stringMatching(/^experience\/acme\.md:4: start: Fecha inválida/),
      'profile.md:3: email: Email inválido',
      '2 problemas en /work/data/sources',
      '',
    ]);
  });
});

describe('cv generate-cv', () => {
  it('genera el CV completo en output/cv-<nombre>.md y lo anuncia', async () => {
    const h = compiled();
    expect(await runCli(['generate-cv'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe('CV escrito en /work/output/cv-ada-ejemplo.md\n');
    expect(h.stderr()).toBe('');
    const written = h.fs.file('/work/output/cv-ada-ejemplo.md');
    expect(written?.mode).toBe(OUTPUT_MODE);
    expect(written?.content).toContain('**Ingeniera de software**');
    expect(written?.content).toContain('### Tech Lead · Startup Ejemplo');
  });

  it('con --specialty reproduce el golden y explica la selección con --explain', async () => {
    const h = compiled();
    expect(await runCli(['generate-cv', '--specialty', 'backend', '--explain'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe('CV escrito en /work/output/cv-ada-ejemplo-backend.md\n');
    expect(h.fs.file('/work/output/cv-ada-ejemplo-backend.md')?.content).toBe(GOLDEN);
    const explain = h.stderr().split('\n');
    expect(explain[0]).toBe('Especialidad «backend» (vocabulario: backend, php, symfony, kubernetes): 9 de 15 ítems incluidos');
    expect(explain).toContain('+ experience exp-acme: universal');
    expect(explain).toContain('    + exp-acme-1: matched (php)');
    expect(explain).toContain('    - exp-acme-3: no-match');
    expect(explain).toContain('- experience exp-startup: no-match');
  });

  it('con --stdout imprime el CV y no escribe ficheros; sin especialidad --explain lo indica', async () => {
    const h = compiled();
    expect(await runCli(['generate-cv', '--stdout', '--explain', '-l', 'en'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('## Experience');
    expect(h.stderr()).toBe('Sin especialidad: se genera el CV completo, sin selección\n');
    expect(h.fs.file('/work/output/cv-ada-ejemplo.md')).toBeUndefined();
  });

  it('admite --output, --template y --profile propios', async () => {
    const h = compiled();
    h.fs.touch('/work/data/dist/profile.json', 900);
    await h.fs.writeFile('/work/plantilla.hbs', '{{fullName}} / {{labels.skills}}', 0o644);
    expect(await runCli(['generate-cv', '-s', 'backend', '-o', 'salida/cv.md', '-t', 'plantilla.hbs', '-p', 'data/dist/profile.json'], h.context)).toBe(EXIT_OK);
    expect(h.fs.file('/work/salida/cv.md')?.content).toBe('Ada Ejemplo / Habilidades\n');
  });

  it('avisa cuando alguna fuente es más reciente que el artefacto, y cuando no puede comprobarlo', async () => {
    const stale = compiled();
    stale.fs.touch('/work/data/sources/profile.md', 900);
    expect(await runCli(['generate-cv', '--stdout'], stale.context)).toBe(EXIT_OK);
    expect(stale.stderr()).toBe('Aviso: profile.md es más reciente que el artefacto; ejecuta «cv build-profile» para regenerarlo\n');

    const broken = compiled();
    await broken.fs.writeFile('/work/data/sources/notas.md', '', 0o644);
    expect(await runCli(['generate-cv', '--stdout'], broken.context)).toBe(EXIT_OK);
    expect(broken.stderr()).toBe(
      'Aviso: no se pudo comprobar si el artefacto está al día (las fuentes en /work/data/sources tienen 1 problema(s); ejecuta «cv validate»)\n',
    );
  });

  it('sin artefacto, con artefacto inválido o con especialidad desconocida sale con 1', async () => {
    const missing = harness(VALID);
    expect(await runCli(['generate-cv'], missing.context)).toBe(EXIT_DATA_ERROR);
    expect(missing.stderr()).toBe('No existe el artefacto «/work/data/dist/profile.json»: ejecuta «cv build-profile» para generarlo\n');

    const invalid = harness({ '/work/data/dist/profile.json': '{"personal":{}}' });
    expect(await runCli(['generate-cv'], invalid.context)).toBe(EXIT_DATA_ERROR);
    expect(invalid.stderr()).toMatch(/^\/work\/data\/dist\/profile\.json: personal\.fullName: /);

    const unknown = compiled();
    expect(await runCli(['generate-cv', '-s', 'devops'], unknown.context)).toBe(EXIT_DATA_ERROR);
    expect(unknown.stderr()).toBe('Especialidad desconocida: «devops» (disponibles: backend, engineering-manager)\n');
  });

  it('con una plantilla ilegible o un destino no escribible sale con 2', async () => {
    const template = compiled();
    expect(await runCli(['generate-cv', '-t', 'no-existe.hbs'], template.context)).toBe(EXIT_FAILURE);
    expect(template.stderr()).toMatch(/^No se pudo leer la plantilla «\/work\/no-existe\.hbs»: ENOENT/);

    const output = compiled();
    output.fs.failures.add('writeFile');
    expect(await runCli(['generate-cv'], output.context)).toBe(EXIT_FAILURE);
    expect(output.stderr()).toBe('No se pudo escribir el CV en «/work/output/cv-ada-ejemplo.md»: fallo simulado en writeFile\n');
  });
});

describe('cv (programa)', () => {
  it('muestra la ayuda y la versión sin ejecutar nada', async () => {
    const help = harness();
    expect(await runCli(['--help'], help.context)).toBe(EXIT_OK);
    expect(help.stdout()).toContain('Usage: cv [options] [command]');
    expect(help.stdout()).toContain('generate-cv');
    const version = harness();
    expect(await runCli(['--version'], version.context)).toBe(EXIT_OK);
    expect(version.stdout()).toBe(`${packageVersion()}\n`);
  });

  it('un comando o una opción desconocidos salen con 2 tras explicar el error', async () => {
    const unknown = harness();
    expect(await runCli(['frobnicate'], unknown.context)).toBe(EXIT_FAILURE);
    expect(unknown.stderr()).toContain("error: unknown command 'frobnicate'");
    const option = harness();
    expect(await runCli(['validate', '--nope'], option.context)).toBe(EXIT_FAILURE);
    expect(option.stderr()).toContain("error: unknown option '--nope'");
  });

  it('propaga los fallos inesperados del entorno', async () => {
    const h = harness(VALID, {
      datasetFileSystem: {
        readDirectory: () => Promise.reject(new Error('EACCES')),
        stat: () => Promise.resolve({ kind: 'directory', size: 0, mtimeMs: 0 }),
        realPath: (path) => Promise.resolve(path),
        readTextFile: () => Promise.resolve(''),
        readBinaryFile: () => Promise.resolve(new Uint8Array()),
      },
    });
    await expect(runCli(['validate'], h.context)).rejects.toThrow('EACCES');
  });
});

describe('utilidades', () => {
  it('formatDatasetError omite la línea cuando no se conoce', () => {
    expect(formatDatasetError({ file: 'a.md', line: 3, message: 'x' })).toBe('a.md:3: x');
    expect(formatDatasetError({ file: 'a.md', message: 'x' })).toBe('a.md: x');
  });

  it('pluralize elige singular o plural', () => {
    expect(pluralize(1, 'fichero', 'ficheros')).toBe('1 fichero');
    expect(pluralize(2, 'fichero', 'ficheros')).toBe('2 ficheros');
  });

  it('readVersion devuelve la versión del package.json o 0.0.0', () => {
    expect(readVersion('{"version":"1.2.3"}')).toBe('1.2.3');
    expect(readVersion('{"version":3}')).toBe('0.0.0');
    expect(readVersion('[]')).toBe('0.0.0');
    expect(packageVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('serializeProfile termina en salto de línea', () => {
    expect(serializeProfile(JSON.parse('{"a":1}') as never)).toBe('{\n  "a": 1\n}\n');
  });

  it('slugify y defaultOutputPath componen nombres seguros', () => {
    expect(slugify('Ada Ñúñez-García')).toBe('ada-nunez-garcia');
    expect(slugify('  ***  ')).toBe('');
    expect(defaultOutputPath(selectionProfile(), 'backend')).toBe('output/cv-ada-ejemplo-backend.md');
    expect(defaultOutputPath(parseMasterProfile({ personal: { fullName: '***' } }), undefined)).toBe('output/cv-perfil.md');
  });

  it('formatSelectionReport lista cada decisión con su motivo y sus tags', () => {
    const selection = selectForSpecialty(selectionProfile(), 'engineering-manager');
    expect(selection.ok).toBe(true);
    if (!selection.ok) {
      return;
    }
    const lines = formatSelectionReport(selection.selection.report).split('\n');
    expect(lines[0]).toMatch(/^Especialidad «engineering-manager» \(vocabulario: engineering-manager, liderazgo, gestion, agile\): \d+ de \d+ ítems incluidos$/);
    expect(lines).toContain('+ projects proj-platform: via-achievements');
    expect(lines).toContain('    + exp-acme-3: matched (liderazgo, gestion)');
  });

  it('checkArtifactFreshness distingue fresco, obsoleto y desconocido', async () => {
    const fs = new MemoryFileSystem({
      '/d/profile.md': { kind: 'file', content: '---\nfullName: Ada\n---\n', mtimeMs: 100 },
      '/d/achievements.md': { kind: 'file', content: '- Logro antiguo\n', mtimeMs: 50 },
      '/d/skills.csv': { kind: 'file', content: 'name\nPHP\n', mtimeMs: 300 },
      '/artifact.json': { kind: 'file', content: '{}', mtimeMs: 200 },
    });
    expect(await checkArtifactFreshness(fs, '/artifact.json', '/d')).toEqual({ status: 'stale', newestSource: 'skills.csv' });
    fs.touch('/artifact.json', 400);
    expect(await checkArtifactFreshness(fs, '/artifact.json', '/d')).toEqual({ status: 'fresh' });
    expect(await checkArtifactFreshness(fs, '/nope.json', '/d')).toEqual({
      status: 'unknown',
      reason: expect.stringMatching(/^no se pudo leer la fecha del artefacto: ENOENT/),
    });
  });
});

describe('contexto real y errores no estándar', () => {
  it('createNodeContext expone el entorno de Node', () => {
    const context = createNodeContext();
    expect(context.cwd).toBe(process.cwd());
    expect(context.parsers.map((parser) => parser.name)).toEqual(['markdown', 'csv']);
    expect(context.datasetFileSystem).toBeInstanceOf(NodeFileSystem);
    expect(context.artifactFileSystem).toBeInstanceOf(NodeWritableFileSystem);
    context.stdout('');
    context.stderr('');
  });

  it('el extractor de PDF del contexto real contiene la extracción en un worker', async () => {
    expect(await createNodeContext().pdfExtractor(Buffer.from('no soy un pdf', 'utf8'))).toEqual({ ok: false, code: 'invalid', message: 'Invalid PDF structure.' });
  });

  it('describeError da un mensaje legible para cualquier valor lanzado', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('cadena')).toBe('cadena');
    expect(describeError(42)).toBe('42');
  });
});
