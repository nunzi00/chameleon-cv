/**
 * `cv import-manfred` (T-9.22): el MAC de Manfred al borrador de `import/<nombre>/`, con `--name`/`--replace` y
 * los avisos de lo que el perfil no guarda; y la pista que da `cv import-cv` cuando le das un JSON.
 */
import { describe, expect, it } from 'vitest';

import { EXIT_DATA_ERROR, EXIT_OK, runCli, type CliContext } from '../../src/cli';
import { MemoryLlmCache, llmStatus } from '../../src/llm';
import { defaultSourceParsers } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import { defaultAssets } from '../../src/shared/assets';
import { MemoryFileSystem, type MemoryEntry } from '../helpers/memory-file-system';

const MAC = JSON.stringify({
  settings: { language: 'ES', MACVersion: '0.5' },
  aboutMe: { profile: { name: 'Ada', surnames: 'Ejemplo', title: 'Backend', location: { country: 'España' } } },
  experience: { jobs: [{ organization: { name: 'Acme' }, roles: [{ name: 'Backend Senior', startDate: '2020-01-01', finishDate: '2021-01-01' }] }] },
  knowledge: {
    hardSkills: [{ skill: { name: 'PHP', type: 'technology' } }],
    studies: [{ studyType: 'officialDegree', degreeAchieved: true, name: 'Ciclo', startDate: '2008-09-01', finishDate: '2010-06-01', institution: { name: 'I.E.S' } }],
  },
  careerPreferences: { preferences: { preferredRoles: ['Backend Developer'] } },
});

interface Harness {
  readonly context: CliContext;
  readonly fs: MemoryFileSystem;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

function harness(extra: Record<string, string | MemoryEntry> = {}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const fs = new MemoryFileSystem({ '/work/mac.json': MAC, ...extra });
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

describe('cv import-manfred', () => {
  it('escribe el borrador con el nombre del perfil y sus ficheros de fuentes', async () => {
    const h = harness();
    expect(await runCli(['import-manfred', 'mac.json'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe('import/ada-ejemplo\n');
    expect(h.fs.file('/work/import/ada-ejemplo/profile.md')?.content).toContain('fullName: Ada Ejemplo');
    expect(h.fs.file('/work/import/ada-ejemplo/experience/backend-senior-acme.md')?.content).toContain('company: Acme');
    expect(h.fs.file('/work/import/ada-ejemplo/skills.csv')?.content).toContain('PHP');
    expect(h.stderr()).toContain('1 experiencias · 0 proyectos · 1 formaciones');
  });

  it('el informe encabeza con lo que el MAC trae y el perfil no guarda', async () => {
    const h = harness();
    expect(await runCli(['import-manfred', 'mac.json'], h.context)).toBe(EXIT_OK);
    const readme = h.fs.file('/work/import/ada-ejemplo/README.md')?.content ?? '';
    expect(readme).toContain('## Degradado o avisado');
    expect(readme).toContain('los puestos que buscas');
    // Un MAC no deja nada sin situar: el fichero dice a qué sección pertenece cada dato.
    expect(readme).not.toContain('## Sin situar');
    expect(h.stderr()).toContain('lo que el MAC trae y el perfil no guarda');
  });

  it('--name elige la carpeta y --replace aparta la anterior entera', async () => {
    const existing: Record<string, MemoryEntry> = { '/work/import/mio': { kind: 'directory' }, '/work/import/mio/README.md': { kind: 'file', content: 'anterior' } };
    const denied = harness(existing);
    expect(await runCli(['import-manfred', 'mac.json', '--name', 'mio'], denied.context)).toBe(EXIT_DATA_ERROR);
    expect(denied.stderr()).toContain('Ya existe import/mio');
    const replaced = harness(existing);
    expect(await runCli(['import-manfred', 'mac.json', '--name', 'mio', '--replace'], replaced.context)).toBe(EXIT_OK);
    expect(replaced.fs.file('/work/import/mio/profile.md')?.content).toContain('Ada Ejemplo');
    expect(replaced.stderr()).toContain('se apartó completo');
  });

  it('un JSON que no es un MAC se rechaza diciendo qué se esperaba, y uno ilegible no rompe nada', async () => {
    const malo = harness({ '/work/otro.json': '{"cualquier":"cosa"}' });
    expect(await runCli(['import-manfred', 'otro.json'], malo.context)).toBe(EXIT_DATA_ERROR);
    expect(malo.stderr()).toContain('no parece un MAC');
    const roto = harness({ '/work/roto.json': 'no es json' });
    expect(await runCli(['import-manfred', 'roto.json'], roto.context)).toBe(EXIT_DATA_ERROR);
    expect(roto.stderr()).toContain('no es JSON válido');
    const ausente = harness();
    expect(await runCli(['import-manfred', 'no-existe.json'], ausente.context)).toBe(2);
  });

  it('«cv import-cv» con un JSON no dice «cabecera desconocida»: dice por dónde entra', async () => {
    const h = harness();
    expect(await runCli(['import-cv', 'mac.json'], h.context)).toBe(EXIT_DATA_ERROR);
    expect(h.stderr()).toContain('cv import-manfred');
  });
});
