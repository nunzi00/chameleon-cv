/**
 * `cv duplicates` (T-9.20): los grupos de las propias fuentes con su id y su fichero, y la resolución —lo que se
 * toma, lo que se conserva y lo que se borra— con su `--dry-run` y sus dos negativas.
 */
import { describe, expect, it } from 'vitest';

import { EXIT_FAILURE, EXIT_OK, runCli, type CliContext } from '../../src/cli';
import { formatTable } from '../../src/cli/output';
import { MemoryLlmCache, llmStatus } from '../../src/llm';
import { defaultSourceParsers } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import { defaultAssets } from '../../src/shared/assets';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const PROFILE = ['---', 'schemaVersion: 1', 'locale: es-ES', 'fullName: Ada Ejemplo', 'links: []', '---', ''].join('\n');

function education(institution: string, degree: string, start?: string, end?: string): string {
  return ['---', `institution: ${institution}`, `degree: ${degree}`, ...(start === undefined ? [] : [`start: ${start}`]), ...(end === undefined ? [] : [`end: ${end}`]), '---', ''].join('\n');
}

const TREE: Record<string, string> = {
  '/work/data/sources/profile.md': PROFILE,
  '/work/data/sources/education/ciclo.md': education('Centro pendiente', 'Ciclo Superior Administrador de Sistemas', '2008', '2010'),
  '/work/data/sources/education/piringalla.md': education('I.E.S Piringalla', 'cs administrador de sistemas informaticos'),
};

interface Harness {
  readonly context: CliContext;
  readonly fs: MemoryFileSystem;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

function harness(extra: Record<string, string> = {}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const fs = new MemoryFileSystem({ ...TREE, ...extra });
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
    assets: defaultAssets(),
    confirm: () => Promise.resolve(true),
    interactive: false,
  };
  return { context, fs, stdout: () => out.join(''), stderr: () => err.join('') };
}

describe('cv duplicates', () => {
  it('agrupa lo repetido con su id y su fichero, y propone la orden que lo resuelve', async () => {
    const h = harness();
    expect(await runCli(['duplicates'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('edu-ciclo');
    expect(h.stdout()).toContain('education/piringalla.md');
    expect(h.stdout()).toContain('2008 → 2010');
    expect(h.stderr()).toContain('cv duplicates resolve');
  });

  it('la orden que propone incluye el id del segundo miembro, y un periodo abierto se ve como tal', async () => {
    const h = harness({ '/work/data/sources/education/piringalla.md': education('I.E.S Piringalla', 'cs administrador de sistemas informaticos', '2008') });
    expect(await runCli(['duplicates'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain('--absorb edu-piringalla');
    expect(h.stdout()).toContain('2008 → …');
  });

  it('sin nada repetido lo dice, y no es un error', async () => {
    const limpio = harness({ '/work/data/sources/education/piringalla.md': education('I.E.S Otra', 'Grado en Historia', '1990', '1995') });
    expect(await runCli(['duplicates'], limpio.context)).toBe(EXIT_OK);
    expect(limpio.stderr()).toContain('Ninguna entrada');
  });
});

describe('formatTable: una fila más corta que la cabecera no descuadra', () => {
  it('rellena las celdas que faltan en vez de romper el ancho', () => {
    const table = formatTable(['Uno', 'Dos', 'Tres'], [['a', 'b', 'c'], ['solo']]);
    expect(table.split('\n')[2]).toBe('solo');
  });
});

describe('cv duplicates: los bordes', () => {
  it('unas fuentes que no cargan se explican, y no se listan grupos a medias', async () => {
    const roto = harness({ '/work/data/sources/education/ciclo.md': '---\ninstitution: I.E.S\n---\n' });
    expect(await runCli(['duplicates'], roto.context)).not.toBe(EXIT_OK);
    expect(roto.stdout()).toBe('');
  });

  it('una entrada sin fechas se lista como tal, no con una fecha inventada', async () => {
    const h = harness();
    expect(await runCli(['duplicates'], h.context)).toBe(EXIT_OK);
    // «piringalla» no trae fechas en el fichero: la columna del periodo lo dice con un guion.
    expect(h.stdout()).toContain('—');
  });
});

describe('cv duplicates resolve', () => {
  const orden = ['duplicates', 'resolve', 'edu-ciclo', '--absorb', 'edu-piringalla'];

  it('la elegida absorbe lo que le falta, la otra se borra y se dice cómo deshacerlo', async () => {
    const h = harness();
    expect(await runCli(orden, h.context)).toBe(EXIT_OK);
    expect(h.fs.file('/work/data/sources/education/ciclo.md')?.content).toContain('institution: I.E.S Piringalla');
    expect(h.fs.file('/work/data/sources/education/piringalla.md')).toBeUndefined();
    expect(h.stderr()).toContain('tomado institution');
    // La discrepancia no se pierde en silencio: se dice cuál se conserva y cuál se descarta.
    expect(h.stderr()).toContain('se conserva degree');
    expect(h.stderr()).toContain('cv history restore');
    expect(h.stdout()).toBe('education/ciclo.md\n');
  });

  it('--dry-run enseña lo mismo y no escribe ni borra', async () => {
    const h = harness();
    expect(await runCli([...orden, '--dry-run'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain('tomado institution');
    expect(h.stderr()).toContain('--dry-run');
    expect(h.fs.file('/work/data/sources/education/piringalla.md')).toBeDefined();
    expect(h.fs.file('/work/data/sources/education/ciclo.md')?.content).toContain('institution: Centro pendiente');
  });

  it('los logros y las tecnologías que se añaden se enumeran uno a uno', async () => {
    // La rama de «añadido»: lo que entra en listas, no en campos, también se dice antes de escribir.
    const conListas = harness({
      '/work/data/sources/experience/a.md': ['---', 'company: Acme', 'role: Backend', 'start: 2020-01', 'technologies: [PHP]', '---', ''].join('\n'),
      '/work/data/sources/experience/b.md': ['---', 'company: Acme', 'role: Backend', 'start: 2020-01', 'technologies: [PHP, Kubernetes]', '---', '', '## Logros', '', '- Migré 14 servicios.', ''].join('\n'),
    });
    expect(await runCli(['duplicates', 'resolve', 'exp-a', '--absorb', 'exp-b'], conListas.context)).toBe(EXIT_OK);
    expect(conListas.stderr()).toContain('añadido technologies: Kubernetes');
    expect(conListas.stderr()).toContain('añadido logro: Migré 14 servicios.');
  });

  it('sin --absorb no hay nada que resolver, y un id inventado no borra nada', async () => {
    const h = harness();
    expect(await runCli(['duplicates', 'resolve', 'edu-ciclo'], h.context)).toBe(EXIT_FAILURE);
    expect(h.stderr()).toContain('--absorb');
    const malo = harness();
    expect(await runCli(['duplicates', 'resolve', 'edu-ciclo', '--absorb', 'edu-inventada'], malo.context)).not.toBe(EXIT_OK);
    expect(malo.fs.file('/work/data/sources/education/piringalla.md')).toBeDefined();
  });
});
