import { describe, expect, it } from 'vitest';

import { NodeWritableFileSystem, serializeProfile } from '../../src/artifact';
import {
  EXIT_DATA_ERROR,
  EXIT_FAILURE,
  EXIT_OK,
  createNodeContext,
  formatDatasetError,
  packageVersion,
  pluralize,
  readVersion,
  runCli,
  type CliContext,
} from '../../src/cli';
import { NodeFileSystem, defaultSourceParsers } from '../../src/parsers';
import { describeError } from '../../src/shared/errors';
import { MemoryFileSystem, datasetTree, type MemoryEntry } from '../helpers/memory-file-system';
import { MemoryWritableFileSystem } from '../helpers/memory-writable-file-system';

interface Harness {
  readonly context: CliContext;
  readonly artifacts: MemoryWritableFileSystem;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

function harness(tree: Record<string, string | MemoryEntry> = datasetTree(), overrides: Partial<CliContext> = {}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const artifacts = new MemoryWritableFileSystem();
  const context: CliContext = {
    cwd: '/work',
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
    datasetFileSystem: new MemoryFileSystem(tree),
    artifactFileSystem: artifacts,
    parsers: defaultSourceParsers(),
    ...overrides,
  };
  return { context, artifacts, stdout: () => out.join(''), stderr: () => err.join('') };
}

const VALID = datasetTree({ '/work/data/sources/profile.md': '---\nfullName: Ada\n---\n', '/work/data/sources/skills.csv': 'name\nPHP\n' });

describe('cv build-profile', () => {
  it('escribe el artefacto en silencio cuando las fuentes son válidas', async () => {
    const h = harness(VALID);
    expect(await runCli(['build-profile'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe('');
    expect(h.stderr()).toBe('');
    const artifact = h.artifacts.files.get('/work/data/dist/profile.json');
    expect(artifact?.mode).toBe(0o600);
    const written: unknown = JSON.parse(artifact?.content ?? '{}');
    expect(written).toMatchObject({ personal: { fullName: 'Ada' }, skills: [{ id: 'skill-1', name: 'PHP' }] });
  });

  it('admite rutas propias y un resumen con --verbose', async () => {
    const h = harness(datasetTree({ '/work/fuentes/profile.md': '---\nfullName: Ada\n---\n' }));
    expect(await runCli(['build-profile', '--data', 'fuentes', '--out', 'build/perfil.json', '-v'], h.context)).toBe(EXIT_OK);
    expect(h.artifacts.files.has('/work/build/perfil.json')).toBe(true);
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
    expect(h.artifacts.files.size).toBe(0);
  });

  it('cuando no puede escribir el artefacto lo explica y sale con 2', async () => {
    const h = harness(VALID);
    h.artifacts.failures.add('mkdir');
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
    expect(h.artifacts.files.size).toBe(0);
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

describe('cv (programa)', () => {
  it('muestra la ayuda y la versión sin ejecutar nada', async () => {
    const help = harness();
    expect(await runCli(['--help'], help.context)).toBe(EXIT_OK);
    expect(help.stdout()).toContain('Usage: cv [options] [command]');
    expect(help.stdout()).toContain('build-profile');
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
        stat: () => Promise.resolve({ kind: 'directory', size: 0 }),
        realPath: (path) => Promise.resolve(path),
        readTextFile: () => Promise.resolve(''),
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

  it('describeError da un mensaje legible para cualquier valor lanzado', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('cadena')).toBe('cadena');
    expect(describeError(42)).toBe('42');
  });
});
