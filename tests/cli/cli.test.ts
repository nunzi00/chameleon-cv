import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultAssets } from '../../src/shared/assets';
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
import { renderTypstCv } from '../../src/renderers/typst';
import { installTypst, typstStatus } from '../../src/typst';
import { MemoryLlmCache, llmStatus } from '../../src/llm';
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
    typstRenderer: (profile, options) => renderTypstCv(profile, options),
    typstInstall: (options, report) => installTypst(options, report),
    typstStatus: (options) => typstStatus(options),
    llmStatus: (options) => llmStatus(options),
    llmProvider: () => Promise.resolve({ ok: false as const, message: 'sin proveedor en las pruebas' }),
    llmCache: new MemoryLlmCache(),
    assets: defaultAssets(),
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

describe('cv build (alias build-profile)', () => {
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
    expect(await runCli(['build', '--data', 'fuentes', '--out', 'build/perfil.json', '-v'], h.context)).toBe(EXIT_OK);
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

  it('con --skills y --projects solo entran los listados, avisa de los desconocidos y el informe lo refleja', async () => {
    const h = compiled();
    expect(await runCli(['generate-cv', '--skills', 'php,Nadie', '--projects', 'proj-platform,Nadie2', '--explain'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain('Aviso: skills no encontrados en el perfil (se ignoran): Nadie\n');
    expect(h.stderr()).toContain('Aviso: proyectos no encontrados en el perfil (se ignoran): Nadie2\n');
    expect(h.stderr()).toContain('Recortes (--skills php,Nadie, --projects proj-platform,Nadie2)');
    const written = h.fs.file('/work/output/cv-ada-ejemplo.md')?.content ?? '';
    expect(written).toContain('PHP');
    expect(h.stderr()).toContain('skills: skill-kubernetes Kubernetes');
  });

  it('la segunda vez con la misma oferta avisa de cuándo se procesó y con qué CV (historial en output/)', async () => {
    const h = compiled();
    await h.fs.writeFile('/work/oferta.txt', 'Buscamos PHP y Kubernetes', 0o600);
    expect(await runCli(['analyze-offer', 'oferta.txt', '-s', 'backend'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).not.toContain('ya se procesó');
    expect(h.fs.file('/work/output/historial-ofertas.json')?.mode).toBe(0o600);
    expect(await runCli(['generate-cv', '-s', 'backend', '-f', 'oferta.txt'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain('Esta oferta ya se procesó una vez:\n  ');
    expect(h.stderr()).toContain(' · analyze-offer (backend)\n');
    expect(await runCli(['analyze-offer', 'oferta.txt', '--json'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('"history": [');
    expect(h.stdout()).toContain('"path": "output/cv-ada-ejemplo-backend-oferta.md"');
    expect(await runCli(['analyze-offer', 'oferta.txt'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('Esta oferta ya se procesó 3 veces:');
    expect(await runCli(['generate-cv', '-f', 'oferta.txt', '--stdout'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain('Esta oferta ya se procesó 4 veces:');
    expect(await runCli(['generate-cv', '-f', 'oferta.txt', '-o', '/fuera/cv.md'], h.context)).toBe(EXIT_OK);
    expect(h.fs.file('/work/output/historial-ofertas.json')?.content).toContain('"path": "/fuera/cv.md"');
  });

  it('si el historial no se puede escribir, avisa y la orden termina bien', async () => {
    const h = compiled();
    await h.fs.writeFile('/work/oferta.txt', 'Buscamos PHP', 0o600);
    const failing = { ...h.fs, mkdir: h.fs.mkdir.bind(h.fs), readFile: h.fs.readFile.bind(h.fs), writeBinaryFile: h.fs.writeBinaryFile.bind(h.fs), writeFile: (path: string, content: string, mode: number) => (path.endsWith('historial-ofertas.json') ? Promise.reject(new Error('disco lleno')) : h.fs.writeFile(path, content, mode)) };
    const context = { ...h.context, artifactFileSystem: failing as never };
    expect(await runCli(['analyze-offer', 'oferta.txt'], context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain('Aviso: no se pudo anotar la oferta en el historial (output/historial-ofertas.json): disco lleno');
    expect(await runCli(['generate-cv', '-f', 'oferta.txt'], context)).toBe(EXIT_OK);
    expect(h.stderr().match(/no se pudo anotar/g)).toHaveLength(2);
    expect(h.stdout()).toContain('CV escrito en /work/output/cv-ada-ejemplo-oferta.md');
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
    expect(stale.stderr()).toBe('Aviso: profile.md es más reciente que el artefacto; ejecuta «cv build» para regenerarlo\n');

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
    expect(missing.stderr()).toBe('No existe el artefacto «/work/data/dist/profile.json»: ejecuta «cv build» para generarlo\n');

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

  it('el renderer Typst del contexto real busca el binario y explica su ausencia', async () => {
    const result = await createNodeContext().typstRenderer(selectionProfile(), { isExecutable: () => Promise.resolve(false) });
    expect(result).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });

  it('el instalador y el estado de Typst del contexto real están cableados (sin tocar la red)', async () => {
    const context = createNodeContext();
    expect(await context.typstInstall({ platform: 'freebsd', arch: 'x64' }, () => undefined)).toMatchObject({ ok: false, code: 'unsupported-platform' });
    expect(await context.typstStatus({ isExecutable: () => Promise.resolve(false) })).toMatchObject({ usable: false });
  });

  it('el estado del co-piloto del contexto real solo habla con loopback', async () => {
    expect(await createNodeContext().llmStatus({ env: { CHAMELEON_LLM_BASE_URL: 'http://127.0.0.1:9' } })).toMatchObject({ usable: false, health: { ok: false, code: 'unreachable' } });
  });

  it('el proveedor del contexto real sale de las variables CHAMELEON_LLM_* del proceso', async () => {
    const previous = process.env['CHAMELEON_LLM_PROVIDER'];
    try {
      delete process.env['CHAMELEON_LLM_PROVIDER'];
      expect(await createNodeContext().llmProvider({})).toMatchObject({ ok: true, provider: { id: 'ollama', kind: 'local' } });
      expect(createNodeContext({ interactive: true }).confirm).toBeTypeOf('function');
      expect(createNodeContext({ interactive: false }).confirm).toBeUndefined();
      process.env['CHAMELEON_LLM_PROVIDER'] = 'gemini';
      expect(await createNodeContext().llmProvider({})).toMatchObject({ ok: false, message: expect.stringContaining('no es un proveedor conocido') });
    } finally {
      if (previous === undefined) {
        delete process.env['CHAMELEON_LLM_PROVIDER'];
      } else {
        process.env['CHAMELEON_LLM_PROVIDER'] = previous;
      }
    }
  });

  it('describeError da un mensaje legible para cualquier valor lanzado', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('cadena')).toBe('cadena');
    expect(describeError(42)).toBe('42');
  });
});

describe('cv build --check (T-2.7)', () => {
  const SUMMARY = '2 ficheros: 0 especialidades, 0 experiencias, 0 proyectos, 0 formaciones, 1 skill, 0 certificaciones, 0 logros transversales, 0 idiomas';

  it('con el artefacto al día no escribe nada y guarda silencio (resumen con -v)', async () => {
    const h = harness(VALID);
    expect(await runCli(['build'], h.context)).toBe(EXIT_OK);
    const before = h.fs.log.length;
    expect(await runCli(['build', '--check'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe('');
    expect(h.stderr()).toBe('');
    expect(h.fs.log.slice(before).filter((entry) => !entry.startsWith('readFile '))).toEqual([]);
    expect(await runCli(['build', '--check', '-v'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe(`Artefacto al día: /work/data/dist/profile.json (${SUMMARY})\n`);
  });

  it('falla con 1 si el artefacto falta o no está al día, con 2 si no se puede leer, y con 1 si las fuentes son inválidas', async () => {
    const missing = harness(VALID);
    expect(await runCli(['build', '--check'], missing.context)).toBe(EXIT_DATA_ERROR);
    expect(missing.stderr()).toBe('Falta el artefacto «/work/data/dist/profile.json»: ejecuta «cv build»\n');
    expect(missing.fs.file('/work/data/dist/profile.json')).toBeUndefined();

    const outdated = harness(VALID);
    expect(await runCli(['build'], outdated.context)).toBe(EXIT_OK);
    await outdated.fs.writeFile('/work/data/sources/skills.csv', 'name\nPHP\nGo\n', 0o644);
    expect(await runCli(['build', '--check'], outdated.context)).toBe(EXIT_DATA_ERROR);
    expect(outdated.stderr()).toBe('El artefacto «/work/data/dist/profile.json» no está al día con las fuentes: ejecuta «cv build»\n');
    expect(JSON.parse(outdated.fs.file('/work/data/dist/profile.json')?.content ?? '{}')).toMatchObject({ skills: [{ name: 'PHP' }] });

    const unreadable = harness(VALID);
    expect(await runCli(['build'], unreadable.context)).toBe(EXIT_OK);
    unreadable.fs.failures.add('readFile');
    expect(await runCli(['build', '--check'], unreadable.context)).toBe(EXIT_FAILURE);
    expect(unreadable.stderr()).toBe('No se pudo leer el artefacto «/work/data/dist/profile.json»: fallo simulado en readFile\n');

    const invalid = harness(datasetTree({ '/work/data/sources/notas.md': '' }));
    expect(await runCli(['build', '--check'], invalid.context)).toBe(EXIT_DATA_ERROR);
    expect(invalid.stderr()).toMatch(/\d+ problemas? en \/work\/data\/sources\n$/);
  });
});

describe('cv generate-cv --build (T-2.7)', () => {
  it('recompila el artefacto antes de generar, sin aviso de obsolescencia, y no genera si la compilación falla', async () => {
    const fresh = harness(VALID);
    expect(await runCli(['generate-cv', '--build', '--stdout'], fresh.context)).toBe(EXIT_OK);
    expect(fresh.stderr()).toBe('');
    expect(fresh.fs.file('/work/data/dist/profile.json')?.mode).toBe(0o600);
    expect(fresh.stdout()).toMatch(/^# Ada\n/);
    expect(fresh.stdout()).toContain('PHP');

    const stale = compiled();
    stale.fs.touch('/work/data/sources/profile.md', 900);
    expect(await runCli(['generate-cv', '--build', '--stdout'], stale.context)).toBe(EXIT_OK);
    expect(stale.stderr()).toBe('');
    expect(stale.stdout()).toBe('# Ada\n');

    const invalid = harness(datasetTree({ '/work/data/sources/notas.md': '' }));
    expect(await runCli(['generate-cv', '--build', '--stdout'], invalid.context)).toBe(EXIT_DATA_ERROR);
    expect(invalid.stdout()).toBe('');
    expect(invalid.stderr()).toMatch(/\d+ problemas? en \/work\/data\/sources\n$/);
  });
});
