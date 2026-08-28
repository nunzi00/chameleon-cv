import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { NodeWritableFileSystem, type WritableFileSystem } from '../../src/artifact';
import { EXIT_FAILURE, EXIT_OK, GITIGNORE_ENTRIES, SOURCE_MODE, TEMPLATE_DATASET_DIR, listTemplateFiles, runCli, type CliContext } from '../../src/cli';
import { NodeFileSystem, defaultSourceParsers, loadDataset } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import { renderTypstCv } from '../../src/renderers/typst';
import { MemoryFileSystem, type MemoryEntry } from '../helpers/memory-file-system';

interface Harness {
  readonly context: CliContext;
  readonly fs: MemoryFileSystem;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

const TEMPLATE: Record<string, string | MemoryEntry> = {
  '/tpl/README.md': '# Guía\n',
  '/tpl/profile.md': '---\nfullName: Ada\n---\n',
  '/tpl/skills.csv': 'name\nPHP\n',
  '/tpl/specialties/backend.md': '---\ntitle: Backend\ntags: [php]\n---\n',
  '/tpl/.oculto': 'ignorado',
  '/tpl/enlace.md': { kind: 'symlink', target: '/tpl/profile.md' },
  '/tpl/raro': { kind: 'other' },
};

const TEMPLATE_FILES = ['profile.md', 'README.md', 'skills.csv', 'specialties/backend.md'];

function harness(tree: Record<string, string | MemoryEntry> = TEMPLATE, overrides: Partial<CliContext> = {}): Harness {
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
    ...overrides,
  };
  return { context, fs, stdout: () => out.join(''), stderr: () => err.join('') };
}

const INIT = ['init', 'nuevo', '--template', '/tpl'];

const NEXT_STEPS =
  'Siguientes pasos:\n  1. Edita data/sources/ (formato: docs/formato-dataset.md y docs/formato-csv.md)\n  2. cv build                    # valida y compila data/dist/profile.json\n  3. cv generate-cv -s backend   # o --format pdf, o -f oferta.txt para adaptarlo a una oferta\n';

describe('cv init', () => {
  it('lista los ficheros de la plantilla en orden estable, sin ocultos, enlaces ni entradas raras', async () => {
    expect(await listTemplateFiles(new MemoryFileSystem(TEMPLATE), '/tpl')).toEqual(TEMPLATE_FILES);
  });

  it('crea data/sources con la plantilla (permisos 0600) y un .gitignore, y explica los siguientes pasos', async () => {
    const h = harness();
    expect(await runCli(INIT, h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toBe('');
    for (const file of TEMPLATE_FILES) {
      const written = h.fs.file(`/work/nuevo/data/sources/${file}`);
      expect(written?.mode).toBe(SOURCE_MODE);
      expect(written?.content).toBe(h.fs.file(`/tpl/${file}`)?.content);
    }
    expect(h.fs.file('/work/nuevo/data/sources/.oculto')).toBeUndefined();
    expect(h.fs.file('/work/nuevo/data/sources/enlace.md')).toBeUndefined();
    expect(h.fs.file('/work/nuevo/.gitignore')).toMatchObject({
      mode: 0o644,
      content: '# Chameleon CV: datos personales generados, nunca se versionan\ndata/dist/\noutput/\n',
    });
    expect(GITIGNORE_ENTRIES).toEqual(['data/dist/', 'output/']);
    expect(h.stdout()).toBe(
      `Espacio de trabajo creado en /work/nuevo: 4 ficheros de ejemplo en data/sources (perfil sintético; sustitúyelo por tus datos)\n.gitignore creado (data/dist/ y output/ contienen datos personales)\n${NEXT_STEPS}`,
    );
  });

  it('por defecto inicializa el directorio actual', async () => {
    const h = harness();
    expect(await runCli(['init', '--template', '/tpl'], h.context)).toBe(EXIT_OK);
    expect(h.fs.file('/work/data/sources/profile.md')?.content).toBe('---\nfullName: Ada\n---\n');
    expect(h.fs.file('/work/.gitignore')).toBeDefined();
  });

  it('nunca sobrescribe: si algún destino existe lista los conflictos y no escribe nada', async () => {
    const h = harness({ ...TEMPLATE, '/work/nuevo/data/sources/profile.md': 'mío', '/work/nuevo/data/sources/specialties/backend.md': 'mío' });
    const before = h.fs.log.length;
    expect(await runCli(INIT, h.context)).toBe(EXIT_FAILURE);
    expect(h.stderr()).toBe('No se ha escrito nada: 2 destinos ya existen en /work/nuevo/data/sources\n  data/sources/profile.md\n  data/sources/specialties/backend.md\n');
    expect(h.stdout()).toBe('');
    expect(h.fs.log.slice(before).filter((entry) => !entry.startsWith('readFile '))).toEqual([]);
    expect(h.fs.file('/work/nuevo/data/sources/profile.md')?.content).toBe('mío');
    expect(h.fs.file('/work/nuevo/data/sources/skills.csv')).toBeUndefined();
    expect(h.fs.file('/work/nuevo/.gitignore')).toBeUndefined();
  });

  it('respeta un .gitignore existente: lo conserva si cubre las rutas sensibles y avisa si no (o si no puede leerlo)', async () => {
    const complete = harness({ ...TEMPLATE, '/work/nuevo/.gitignore': 'node_modules/\ndata/dist\n output/ \n' });
    expect(await runCli(INIT, complete.context)).toBe(EXIT_OK);
    expect(complete.stdout()).toContain('\n.gitignore conservado (ya cubre las rutas sensibles)\n');
    expect(complete.fs.file('/work/nuevo/.gitignore')?.content).toBe('node_modules/\ndata/dist\n output/ \n');

    const incomplete = harness({ ...TEMPLATE, '/work/nuevo/.gitignore': 'node_modules/\n' });
    expect(await runCli(INIT, incomplete.context)).toBe(EXIT_OK);
    expect(incomplete.stdout()).toContain('\nAviso: añade data/dist/ y output/ a tu .gitignore (contienen datos personales)\n');

    const unreadable = harness({ ...TEMPLATE, '/work/nuevo/.gitignore': { kind: 'directory' } });
    expect(await runCli(INIT, unreadable.context)).toBe(EXIT_OK);
    expect(unreadable.stdout()).toContain('\nAviso: no se pudo leer .gitignore; comprueba que excluye data/dist/ y output/\n');
  });

  it('con una plantilla vacía o ilegible no hace nada y sale con 2', async () => {
    const empty = harness({ '/tpl/.solo-ocultos': 'x' });
    expect(await runCli(INIT, empty.context)).toBe(EXIT_FAILURE);
    expect(empty.stderr()).toBe('El dataset de ejemplo «/tpl» está vacío\n');

    const missing = harness({});
    expect(await runCli(INIT, missing.context)).toBe(EXIT_FAILURE);
    expect(missing.stderr()).toBe('No se pudo leer el dataset de ejemplo «/tpl»: ENOENT: no such file or directory, /tpl\n');
    expect(missing.fs.file('/work/nuevo/.gitignore')).toBeUndefined();
  });

  it('si no puede escribir las fuentes o el .gitignore lo explica y sale con 2', async () => {
    const sources = harness();
    sources.fs.failures.add('writeFile');
    expect(await runCli(INIT, sources.context)).toBe(EXIT_FAILURE);
    expect(sources.stderr()).toBe('No se pudo crear el dataset en «/work/nuevo/data/sources»: fallo simulado en writeFile\n');

    const base = new MemoryFileSystem(TEMPLATE);
    const failingGitignore: WritableFileSystem = {
      mkdir: (path) => base.mkdir(path),
      writeFile: (path, content, mode) => (path.endsWith('.gitignore') ? Promise.reject(new Error('disco lleno')) : base.writeFile(path, content, mode)),
      writeBinaryFile: (path, bytes, mode) => base.writeBinaryFile(path, bytes, mode),
      chmod: (path, mode) => base.chmod(path, mode),
      rename: (from, to) => base.rename(from, to),
      remove: (path) => base.remove(path),
      readFile: (path) => base.readFile(path),
    };
    const gitignore = harness(TEMPLATE, { datasetFileSystem: base, artifactFileSystem: failingGitignore });
    expect(await runCli(INIT, gitignore.context)).toBe(EXIT_FAILURE);
    expect(gitignore.stderr()).toBe('No se pudo escribir «/work/nuevo/.gitignore»: disco lleno\n');
    expect(base.file('/work/nuevo/data/sources/profile.md')).toBeDefined();
  });

  it('la plantilla distribuida arranca un espacio de trabajo real que compila con cv build', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'chameleon-init-'));
    const out: string[] = [];
    const err: string[] = [];
    const context: CliContext = {
      cwd,
      stdout: (text) => {
        out.push(text);
      },
      stderr: (text) => {
        err.push(text);
      },
      stdin: () => Promise.resolve(''),
      datasetFileSystem: new NodeFileSystem(),
      artifactFileSystem: new NodeWritableFileSystem(),
      parsers: defaultSourceParsers(),
      pdfExtractor: (bytes) => extractPdfText(bytes),
      typstRenderer: (profile, options) => renderTypstCv(profile, options),
    };
    try {
      expect(TEMPLATE_DATASET_DIR.endsWith(join('templates', 'dataset'))).toBe(true);
      expect(await runCli(['init'], context)).toBe(EXIT_OK);
      expect(err.join('')).toBe('');
      expect(out.join('')).toContain(`Espacio de trabajo creado en ${cwd}: 11 ficheros de ejemplo en data/sources`);
      expect((await stat(join(cwd, 'data/sources/profile.md'))).mode & 0o777).toBe(SOURCE_MODE);
      expect(await readFile(join(cwd, '.gitignore'), 'utf8')).toContain('data/dist/\noutput/\n');
      const dataset = await loadDataset(join(cwd, 'data/sources'), { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
      expect(dataset.ok && dataset.files.length).toBe(10);
      expect(await runCli(['build'], context)).toBe(EXIT_OK);
      expect(await runCli(['build', '--check'], context)).toBe(EXIT_OK);
      expect((await stat(join(cwd, 'data/dist/profile.json'))).mode & 0o777).toBe(0o600);
      expect(await runCli(['init'], context)).toBe(EXIT_FAILURE);
      expect(err.join('')).toContain('No se ha escrito nada: 11 destinos ya existen');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
