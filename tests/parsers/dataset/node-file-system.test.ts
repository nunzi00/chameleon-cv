import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NodeFileSystem, entryKindOf, fileStatOf } from '../../../src/parsers/dataset/node-file-system';

const FIXTURE_ROOT = join(__dirname, '../../fixtures/dataset');
const fs = new NodeFileSystem();

describe('NodeFileSystem', () => {
  let temporary = '';

  beforeAll(async () => {
    temporary = await mkdtemp(join(tmpdir(), 'chameleon-fs-'));
    await writeFile(join(temporary, 'real.md'), 'contenido', 'utf8');
    await symlink(join(temporary, 'real.md'), join(temporary, 'link.md'));
  });

  afterAll(async () => {
    await rm(temporary, { recursive: true, force: true });
  });

  it('lista un directorio clasificando ficheros, directorios y enlaces', async () => {
    const names = Object.fromEntries((await fs.readDirectory(FIXTURE_ROOT)).map((entry) => [entry.name, entry.kind]));
    expect(names).toMatchObject({ 'profile.md': 'file', experience: 'directory', '.hidden': 'directory', 'README.md': 'file' });
    const temporaryEntries = Object.fromEntries((await fs.readDirectory(temporary)).map((entry) => [entry.name, entry.kind]));
    expect(temporaryEntries).toEqual({ 'real.md': 'file', 'link.md': 'symlink' });
  });

  it('resuelve rutas reales, describe ficheros y lee texto', async () => {
    expect(await fs.realPath(join(temporary, 'link.md'))).toBe(await fs.realPath(join(temporary, 'real.md')));
    expect(await fs.stat(join(temporary, 'link.md'))).toEqual({ kind: 'file', size: 9, mtimeMs: expect.any(Number) });
    expect((await fs.stat(FIXTURE_ROOT)).kind).toBe('directory');
    expect(await fs.readTextFile(join(temporary, 'link.md'))).toBe('contenido');
    expect(Buffer.from(await fs.readBinaryFile(join(temporary, 'real.md'))).toString('utf8')).toBe('contenido');
  });
});

describe('clasificadores', () => {
  const fake = (flags: { file?: boolean; directory?: boolean; symlink?: boolean }) => ({
    isFile: () => flags.file === true,
    isDirectory: () => flags.directory === true,
    isSymbolicLink: () => flags.symlink === true,
    size: 7,
    mtimeMs: 5,
  });

  it('entryKindOf prioriza el enlace simbólico y cae en «other» para el resto', () => {
    expect(entryKindOf(fake({ symlink: true, file: true }))).toBe('symlink');
    expect(entryKindOf(fake({ file: true }))).toBe('file');
    expect(entryKindOf(fake({ directory: true }))).toBe('directory');
    expect(entryKindOf(fake({}))).toBe('other');
  });

  it('fileStatOf conserva el tamaño y clasifica en file/directory/other', () => {
    expect(fileStatOf(fake({ file: true }))).toEqual({ kind: 'file', size: 7, mtimeMs: 5 });
    expect(fileStatOf(fake({ directory: true }))).toEqual({ kind: 'directory', size: 7, mtimeMs: 5 });
    expect(fileStatOf(fake({}))).toEqual({ kind: 'other', size: 7, mtimeMs: 5 });
  });
});
