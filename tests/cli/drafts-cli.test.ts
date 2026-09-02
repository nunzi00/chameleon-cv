/**
 * `cv drafts` (T-9.19): listar los borradores de `import/`, ver sus entradas con el id que hay que señalar,
 * los grupos de duplicados y la adopción en `data/sources/` con sus dos negativas (nada señalado, sección
 * inventada) y su `--dry-run`.
 */
import { describe, expect, it } from 'vitest';

import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK, runCli, type CliContext } from '../../src/cli';
import { MemoryLlmCache, llmStatus } from '../../src/llm';
import { defaultSourceParsers } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import { defaultAssets } from '../../src/shared/assets';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const PROFILE = ['---', 'schemaVersion: 1', 'locale: es-ES', 'fullName: Ada Ejemplo', 'links: []', '---', ''].join('\n');

function experience(company: string, role: string, start: string, end?: string): string {
  return ['---', `company: ${company}`, `role: ${role}`, `start: ${start}`, ...(end === undefined ? [] : [`end: ${end}`]), '---', ''].join('\n');
}

const REPORT = ['# Informe del borrador importado', '', '- Origen: CV Lucas.pdf', '', '## Sin situar (revísalo a mano)', '', '- línea 63: Informática', ''].join('\n');

const TREE: Record<string, string> = {
  '/work/data/sources/profile.md': PROFILE,
  '/work/data/sources/experience/life5.md': experience('Life5', 'Backend', '2022-05', '2022-12'),
  '/work/import/mio/profile.md': PROFILE,
  '/work/import/mio/README.md': REPORT,
  '/work/import/mio/experience/acme.md': experience('Acme', 'Backend Senior', '2020-01', '2021-01'),
  '/work/import/mio/experience/life5.md': experience('Life5', 'Software Developer', '2022-04'),
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

describe('cv drafts list', () => {
  it('lista cada borrador con su origen y sus cuentas', async () => {
    const h = harness();
    expect(await runCli(['drafts', 'list'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('Borrador');
    expect(h.stdout()).toContain('mio');
    expect(h.stdout()).toContain('CV Lucas.pdf');
    expect(h.stderr()).toContain('1 borrador');
  });

  it('es lo que hace «cv drafts» a secas', async () => {
    const h = harness();
    expect(await runCli(['drafts'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('mio');
  });

  it('sin borradores dice cómo importarlos, y no es un error', async () => {
    const h = harness();
    const empty = { ...h, context: { ...h.context, cwd: '/vacio' } };
    expect(await runCli(['drafts'], empty.context)).toBe(EXIT_OK);
    expect(empty.stderr()).toContain('cv import-cv');
  });
});

describe('cv drafts show', () => {
  it('enseña las entradas con el id que hay que señalar', async () => {
    const h = harness();
    expect(await runCli(['drafts', 'show', 'mio'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('exp-acme');
    expect(h.stdout()).toContain('Backend Senior · Acme');
    expect(h.stdout()).toContain('2020-01 → 2021-01');
    // Un empleo en curso se ve como tal, no como una fecha que falta.
    expect(h.stdout()).toContain('2022-04 → …');
  });

  it('un borrador que no carga sale con código de datos y su motivo', async () => {
    const h = harness({ '/work/import/roto/profile.md': '---\nschemaVersion: 1\n---\n' });
    expect(await runCli(['drafts', 'show', 'roto'], h.context)).toBe(EXIT_DATA_ERROR);
    expect(h.stderr()).toContain('no carga');
  });
});

describe('cv drafts duplicates', () => {
  it('agrupa lo que se parece y avisa de lo que ya está en las fuentes', async () => {
    const h = harness();
    expect(await runCli(['drafts', 'duplicates'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('YA TIENES UNA EN TUS FUENTES');
    expect(h.stdout()).toContain('data/sources');
    expect(h.stderr()).toContain('no una fusión');
  });
});

describe('cv drafts: los bordes de cada orden', () => {
  it('un borrador sin origen ni entradas se lista y se abre sin inventar nada', async () => {
    const h = harness({ '/work/import/vacio/profile.md': PROFILE });
    expect(await runCli(['drafts'], h.context)).toBe(EXIT_OK);
    // Sin README no hay origen: se dice con un guion, no con una ruta adivinada.
    expect(h.stdout()).toContain('—');
    const abierto = harness({ '/work/import/vacio/profile.md': PROFILE });
    expect(await runCli(['drafts', 'show', 'vacio'], abierto.context)).toBe(EXIT_OK);
    expect(abierto.stderr()).toContain('no tiene experiencias, formaciones ni proyectos');
  });

  it('un borrador que no carga sale marcado en la lista, sin tumbarla', async () => {
    const h = harness({ '/work/import/roto/profile.md': '---\nschemaVersion: 1\n---\n' });
    expect(await runCli(['drafts'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('!');
    expect(h.stderr()).toContain('no carga');
  });

  it('un grupo que solo está en los borradores no dice que ya lo tengas', async () => {
    const h = harness({
      '/work/data/sources/experience/life5.md': experience('Otra', 'Cosa', '1990-01', '1990-06'),
      '/work/import/otro/profile.md': PROFILE,
      '/work/import/otro/experience/acme.md': experience('Acme', 'Backend Senior', '2020-01', '2021-01'),
    });
    expect(await runCli(['drafts', 'duplicates'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).not.toContain('YA TIENES UNA EN TUS FUENTES');
  });

  it('--section y --entry juntos acotan a esa sección Y a esos ids', async () => {
    const h = harness();
    expect(await runCli(['drafts', 'adopt', 'mio', '--section', 'experience', '--entry', 'exp-acme'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe('experience/acme.md\n');
  });

  it('sin duplicados entre borradores se dice, y no es un error', async () => {
    const h = harness({ '/work/import/mio/experience/life5.md': experience('Otra Cosa', 'Puesto distinto', '1999-01', '1999-06') });
    expect(await runCli(['drafts', 'duplicates'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain('Ninguna entrada se parece a otra');
  });

  it('un periodo sin fecha de fin se ve como en curso, y uno sin fechas con un guion', async () => {
    const h = harness({ '/work/import/mio/education/sin-fechas.md': ['---', 'institution: I.E.S', 'degree: Ciclo', '---', ''].join('\n') });
    expect(await runCli(['drafts', 'show', 'mio'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('2022-04 → …');
    expect(h.stdout()).toContain('—');
  });

  it('adoptar de un borrador que no carga no escribe nada', async () => {
    const h = harness({ '/work/import/roto/profile.md': '---\nschemaVersion: 1\n---\n' });
    expect(await runCli(['drafts', 'adopt', 'roto', '--section', 'experience'], h.context)).toBe(EXIT_DATA_ERROR);
    expect(h.stderr()).toContain('no carga');
  });

  it('un id que no está en el borrador se dice, y lo demás entra igual', async () => {
    const h = harness();
    expect(await runCli(['drafts', 'adopt', 'mio', '--entry', 'exp-acme', 'exp-fantasma'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain('sin adoptar exp-fantasma: no es una entrada de import/mio');
    expect(h.fs.file('/work/data/sources/experience/acme.md')).toBeDefined();
  });

  it('unas fuentes que no cargan paran la adopción antes de escribir', async () => {
    const h = harness({ '/work/data/sources/experience/roto.md': '---\ncompany: Solo empresa\n---\n' });
    expect(await runCli(['drafts', 'adopt', 'mio', '--entry', 'exp-acme'], h.context)).not.toBe(EXIT_OK);
    // `errorLines` prefiere el detalle al titular: se ven los problemas del dataset, que es lo accionable.
    expect(h.stderr()).toContain('problemas en /work/data/sources');
    expect(h.fs.file('/work/data/sources/experience/acme.md')).toBeUndefined();
  });
});

describe('cv drafts adopt', () => {
  it('escribe la entrada señalada como fichero nuevo y no toca lo que ya había', async () => {
    const h = harness();
    const before = h.fs.file('/work/data/sources/experience/life5.md')?.content;
    expect(await runCli(['drafts', 'adopt', 'mio', '--entry', 'exp-acme'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe('experience/acme.md\n');
    expect(h.fs.file('/work/data/sources/experience/acme.md')?.content).toContain('company: Acme');
    expect(h.fs.file('/work/data/sources/experience/life5.md')?.content).toBe(before);
    expect(h.stderr()).toContain('cv build');
  });

  it('--section adopta la sección entera; --dry-run no escribe', async () => {
    const h = harness();
    expect(await runCli(['drafts', 'adopt', 'mio', '--section', 'experience', '--dry-run'], h.context)).toBe(EXIT_OK);
    expect(h.stdout().split('\n').filter((line) => line !== '')).toHaveLength(2);
    expect(h.fs.file('/work/data/sources/experience/acme.md')).toBeUndefined();
    expect(h.stderr()).toContain('--dry-run');
  });

  it('adoptar dos veces la misma entrada no pisa la primera: la segunda toma el id libre', async () => {
    const h = harness();
    expect(await runCli(['drafts', 'adopt', 'mio', '--entry', 'exp-acme'], h.context)).toBe(EXIT_OK);
    expect(await runCli(['drafts', 'adopt', 'mio', '--entry', 'exp-acme'], h.context)).toBe(EXIT_OK);
    expect(h.fs.file('/work/data/sources/experience/acme.md')).toBeDefined();
    expect(h.fs.file('/work/data/sources/experience/acme-2.md')).toBeDefined();
  });

  it('sin decir qué adoptar, o con una sección inventada, no se escribe nada', async () => {
    const h = harness();
    expect(await runCli(['drafts', 'adopt', 'mio'], h.context)).toBe(EXIT_FAILURE);
    expect(h.stderr()).toContain('--entry');
    const bad = harness();
    expect(await runCli(['drafts', 'adopt', 'mio', '--section', 'habilidades'], bad.context)).toBe(EXIT_FAILURE);
    expect(bad.stderr()).toContain('no es una sección adoptable');
    const missing = harness();
    expect(await runCli(['drafts', 'adopt', 'mio', '--entry', 'exp-inventada'], missing.context)).toBe(EXIT_DATA_ERROR);
    expect(missing.fs.file('/work/data/sources/experience/acme.md')).toBeUndefined();
  });
});
