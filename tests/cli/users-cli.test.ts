/**
 * `cv users` y la bandera global `--user` (T-9.32): varias personas en el mismo espacio de trabajo.
 * Lo que se comprueba aquí no es el listado bonito, es que ELEGIR UN USUARIO CAMBIA LA RAÍZ: la misma
 * orden, con y sin `--user`, escribe en sitios distintos.
 */
import { describe, expect, it } from 'vitest';

import { EXIT_FAILURE, EXIT_OK, runCli, type CliContext } from '../../src/cli';
import { MemoryLlmCache, llmStatus } from '../../src/llm';
import { defaultSourceParsers } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import { defaultAssets } from '../../src/shared/assets';
import { MemoryFileSystem, type MemoryEntry } from '../helpers/memory-file-system';

const PROFILE = ['---', 'schemaVersion: 1', 'locale: es-ES', 'fullName: Ada Ejemplo', 'links: []', '---', ''].join('\n');
const TEMPLATE: Record<string, string | MemoryEntry> = { '/tpl/profile.md': PROFILE, '/tpl/README.md': '# Guía\n' };

interface Harness {
  readonly context: CliContext;
  readonly fs: MemoryFileSystem;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

function harness(tree: Record<string, string | MemoryEntry> = {}, environment: Record<string, string | undefined> = {}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const fs = new MemoryFileSystem({ ...TEMPLATE, ...tree });
  const assets = defaultAssets();
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
    typstInstall: () => Promise.reject(new Error('no usado')),
    typstStatus: () => Promise.reject(new Error('no usado')),
    llmStatus: (options) => llmStatus(options),
    llmProvider: () => Promise.resolve({ ok: false as const, message: 'sin proveedor en las pruebas' }),
    llmCache: new MemoryLlmCache(),
    // El dataset de ejemplo se sirve desde el disco en memoria, no desde el distribuido.
    assets: { kind: assets.kind, text: (key) => assets.text(key), bytes: (key) => assets.bytes(key), keys: (prefix) => assets.keys(prefix), directory: () => Promise.resolve('/tpl') },
    now: () => new Date('2026-09-04T10:00:00.000Z'),
  };
  void environment;
  return { context, fs, stdout: () => out.join(''), stderr: () => err.join('') };
}

describe('cv users', () => {
  it('sin usuarios lo dice y explica cómo crear el primero', async () => {
    const h = harness({ '/work/data/sources/profile.md': PROFILE });
    expect(await runCli(['users'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe('No hay usuarios en /work/usuarios\nEste espacio de trabajo es de una sola persona; «cv users create <id>» crea el primero.\n');
  });

  it('crea un usuario, lo siembra con el dataset de ejemplo y lo lista con su nombre compilado', async () => {
    const h = harness({ '/work/data/sources/profile.md': PROFILE });
    expect(await runCli(['users', 'create', 'invitado1'], h.context)).toBe(EXIT_OK);
    expect(h.fs.file('/work/usuarios/invitado1/data/sources/profile.md')?.content).toBe(PROFILE);
    expect(h.stdout()).toContain('Usuario «invitado1» creado en /work/usuarios/invitado1');
    expect(h.stdout()).toContain('Sembrado con el dataset de ejemplo');
    expect(h.stdout()).toContain('cv --user invitado1 build');
    // Compilado su artefacto, el listado lo llama por su nombre; sin compilar, con una raya.
    expect(await runCli(['--user', 'invitado1', 'build'], h.context)).toBe(EXIT_OK);
    expect(await runCli(['users', 'create', 'invitado2', '--empty'], h.context)).toBe(EXIT_OK);
    expect(await runCli(['users', 'list'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('invitado1  Ada Ejemplo  sí');
    expect(h.stdout()).toContain('invitado2  —            no');
    expect(h.stdout()).toContain('2 usuarios · elige con «cv --user <id> <orden>» o CHAMELEON_USER');
  });

  it('--empty no siembra nada y --adopt con --empty se rechaza por contradictorio', async () => {
    const h = harness();
    expect(await runCli(['users', 'create', 'vacio', '--empty'], h.context)).toBe(EXIT_OK);
    expect(h.fs.file('/work/usuarios/vacio/data/sources/profile.md')).toBeUndefined();
    expect(await runCli(['users', 'create', 'otro', '--empty', '--adopt'], h.context)).toBe(EXIT_FAILURE);
    expect(h.stderr()).toContain('se contradicen');
  });

  it('--adopt traslada lo de la raíz y avisa del .gitignore', async () => {
    const h = harness({ '/work/data/sources/profile.md': PROFILE, '/work/output/cv.md': 'cv' });
    expect(await runCli(['users', 'create', 'lucas', '--adopt'], h.context)).toBe(EXIT_OK);
    expect(h.fs.file('/work/usuarios/lucas/data/sources/profile.md')?.content).toBe(PROFILE);
    expect(h.fs.file('/work/data/sources/profile.md')).toBeUndefined();
    expect(h.stdout()).toContain('Trasladado desde la raíz: data, output');
    expect(h.stdout()).toContain('usuarios/*/data/dist/');
  });

  it('no pisa un usuario que ya existe', async () => {
    const h = harness({ '/work/usuarios/invitado1': { kind: 'directory' } });
    expect(await runCli(['users', 'create', 'invitado1'], h.context)).toBe(EXIT_FAILURE);
    expect(h.stderr()).toContain('Ya existe el usuario «invitado1»');
  });

  it('path imprime la ruta y falla si el usuario no existe', async () => {
    const h = harness({ '/work/usuarios/lucas': { kind: 'directory' } });
    expect(await runCli(['users', 'path', 'lucas'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe('/work/usuarios/lucas\n');
    expect(await runCli(['users', 'path', 'nadie'], h.context)).toBe(EXIT_FAILURE);
    expect(h.stderr()).toContain('No existe el usuario «nadie»');
  });

  it('remove no borra: aparta el espacio entero y dice cómo devolverlo', async () => {
    const h = harness({ '/work/usuarios/invitado1/data/sources/profile.md': PROFILE });
    expect(await runCli(['users', 'remove', 'invitado1'], h.context)).toBe(EXIT_OK);
    // La marca de tiempo es la LOCAL de quien ejecuta: se comprueba su forma, no un huso concreto.
    const backup = /su espacio queda entero en (\/work\/usuarios\/invitado1\.\d{8}-\d{6}\.bak)\n/.exec(h.stdout());
    expect(backup?.[1]).toBeDefined();
    expect(h.stdout()).toContain('Para deshacerlo, renómbralo de vuelta a /work/usuarios/invitado1\n');
    expect(h.fs.file(`${String(backup?.[1])}/data/sources/profile.md`)?.content).toBe(PROFILE);
    expect(await runCli(['users', 'remove', 'invitado1'], h.context)).toBe(EXIT_FAILURE);
  });
});

describe('cv --user', () => {
  it('la misma orden, con y sin usuario, valida fuentes distintas, y trabajar sobre la raíz se avisa', async () => {
    const roto = ['---', 'schemaVersion: 1', 'locale: es-ES', 'links: []', '---', ''].join('\n');
    const h = harness({ '/work/data/sources/profile.md': PROFILE, '/work/usuarios/invitado1/data/sources/profile.md': roto });
    expect(await runCli(['validate'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain('Trabajando sobre la raíz; este espacio tiene 1 usuario (invitado1): elige con --user');
    expect(await runCli(['--user', 'invitado1', 'validate'], h.context)).not.toBe(EXIT_OK);
  });

  it('compila el artefacto DENTRO del usuario, no en la raíz', async () => {
    const h = harness({ '/work/usuarios/invitado1/data/sources/profile.md': PROFILE });
    expect(await runCli(['--user', 'invitado1', 'build'], h.context)).toBe(EXIT_OK);
    expect(h.fs.file('/work/usuarios/invitado1/data/dist/profile.json')).toBeDefined();
    expect(h.fs.file('/work/data/dist/profile.json')).toBeUndefined();
  });

  it('CHAMELEON_USER hace lo mismo que la bandera', async () => {
    const h = harness({ '/work/usuarios/invitado1/data/sources/profile.md': PROFILE });
    const program = await runCli(['build'], h.context, { CHAMELEON_USER: 'invitado1' });
    expect(program).toBe(EXIT_OK);
    expect(h.fs.file('/work/usuarios/invitado1/data/dist/profile.json')).toBeDefined();
  });

  it('un usuario que no existe se dice, y no se compila nada', async () => {
    const h = harness({ '/work/data/sources/profile.md': PROFILE });
    expect(await runCli(['--user', 'nadie', 'build'], h.context)).toBe(EXIT_FAILURE);
    expect(h.stderr()).toContain('No existe el usuario «nadie»');
  });

  it('con usuarios y sin elegir ninguno, y la raíz ya sin fuentes, se para y dice con quién se puede trabajar', async () => {
    const h = harness({ '/work/usuarios/lucas/data/sources/profile.md': PROFILE });
    expect(await runCli(['build'], h.context)).toBe(EXIT_FAILURE);
    expect(h.stderr()).toContain('Este espacio de trabajo tiene usuarios y no has elegido ninguno.');
    expect(h.stderr()).toContain('cv --user lucas <orden>');
  });

  it('«users» e «init» no exigen usuario: gestionan el espacio, no las fuentes de nadie', async () => {
    const h = harness({ '/work/usuarios/lucas/data/sources/profile.md': PROFILE });
    expect(await runCli(['users', 'list'], h.context)).toBe(EXIT_OK);
    expect(await runCli(['init', 'nuevo', '--template', '/tpl'], h.context)).toBe(EXIT_OK);
    expect(h.fs.file('/work/nuevo/data/sources/profile.md')?.content).toBe(PROFILE);
  });
});
