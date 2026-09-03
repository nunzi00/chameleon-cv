/**
 * `cv sources delete` (T-9.25): qué desaparece antes de borrar, la confirmación, la negativa cuando lo que
 * quedaría no carga y el camino de vuelta por el histórico.
 */
import { describe, expect, it } from 'vitest';

import { EXIT_DATA_ERROR, EXIT_OK, runCli, type CliContext } from '../../src/cli';
import { MemoryLlmCache, llmStatus } from '../../src/llm';
import { defaultSourceParsers } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import { defaultAssets } from '../../src/shared/assets';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const SOURCES = '/work/data/sources';
const PROFILE = ['---', 'schemaVersion: 1', 'locale: es-ES', 'fullName: Ada Ejemplo', 'links: []', '---', ''].join('\n');
const ACME = ['---', 'company: ACME', 'role: Backend Engineer', 'start: 2020-01', 'end: 2022-12', 'id: exp-acme', '---', '', '## Logros', '', '- Reduje la latencia un 40 %', ''].join('\n');

interface Harness {
  readonly context: CliContext;
  readonly fs: MemoryFileSystem;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

/** `answer` es lo que contesta la terminal; «sin-terminal» monta un contexto sin `confirm`, como un script. */
function harness(answer: boolean | 'sin-terminal' = true, extra: Record<string, string> = {}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const fs = new MemoryFileSystem({ [`${SOURCES}/profile.md`]: PROFILE, [`${SOURCES}/experience/acme.md`]: ACME, ...extra });
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
    now: () => new Date('2026-09-03T10:00:00.000Z'),
    ...(answer === 'sin-terminal' ? {} : { confirm: () => Promise.resolve(answer) }),
  };
  return { context, fs, stdout: () => out.join(''), stderr: () => err.join('') };
}

describe('cv sources delete (T-9.25)', () => {
  it('dice qué entradas se lleva, pregunta, borra y explica cómo recuperarlo', async () => {
    const h = harness();
    expect(await runCli(['sources', 'delete', 'experience/acme.md'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('Borrar experience/acme.md quita 1 entrada: exp-acme (Backend Engineer · ACME)');
    expect(h.stdout()).toContain('Borrada experience/acme.md');
    expect(h.stderr()).toContain('cv history restore latest experience/acme.md');
    expect(h.stderr()).toContain('cv build');
    expect(h.fs.file(`${SOURCES}/experience/acme.md`)).toBeUndefined();
  });

  it('--dry-run enseña lo que se llevaría y no borra; decir que no tampoco borra', async () => {
    const seco = harness();
    expect(await runCli(['sources', 'delete', 'experience/acme.md', '--dry-run'], seco.context)).toBe(EXIT_OK);
    expect(seco.stderr()).toContain('Ejecución en seco');
    expect(seco.fs.file(`${SOURCES}/experience/acme.md`)).toBeDefined();

    const no = harness(false);
    expect(await runCli(['sources', 'delete', 'experience/acme.md'], no.context)).toBe(EXIT_OK);
    expect(no.stderr()).toContain('Cancelado');
    expect(no.fs.file(`${SOURCES}/experience/acme.md`)).toBeDefined();
  });

  it('sin terminal exige --yes: borrar no se supone', async () => {
    const sinTerminal = harness('sin-terminal');
    expect(await runCli(['sources', 'delete', 'experience/acme.md'], sinTerminal.context)).toBe(EXIT_DATA_ERROR);
    expect(sinTerminal.stderr()).toContain('exige «--yes»');
    expect(sinTerminal.fs.file(`${SOURCES}/experience/acme.md`)).toBeDefined();

    const conYes = harness('sin-terminal');
    expect(await runCli(['sources', 'delete', 'experience/acme.md', '--yes'], conYes.context)).toBe(EXIT_OK);
    expect(conYes.fs.file(`${SOURCES}/experience/acme.md`)).toBeUndefined();
  });

  it('se niega a dejar el espacio de trabajo sin cargar, y a borrar lo que no existe', async () => {
    const h = harness();
    expect(await runCli(['sources', 'delete', 'profile.md'], h.context)).toBe(EXIT_DATA_ERROR);
    expect(h.stderr()).toContain('dejarían de cargar');
    expect(h.fs.file(`${SOURCES}/profile.md`)).toBeDefined();
    expect(await runCli(['sources', 'delete', 'experience/no-esta.md'], h.context)).not.toBe(EXIT_OK);
  });

  it('un fallo del disco al borrar se dice, después de haber enseñado el plan', async () => {
    const h = harness();
    h.fs.failures.add('remove');
    expect(await runCli(['sources', 'delete', 'experience/acme.md'], h.context)).not.toBe(EXIT_OK);
    expect(h.stdout()).toContain('Borrar experience/acme.md quita');
    expect(h.stderr()).toContain('No se pudo borrar');
  });

  it('-d apunta a otro directorio de fuentes', async () => {
    const h = harness(true, { '/work/otras/profile.md': PROFILE, '/work/otras/experience/acme.md': ACME });
    expect(await runCli(['sources', 'delete', 'experience/acme.md', '-d', 'otras'], h.context)).toBe(EXIT_OK);
    expect(h.fs.file('/work/otras/experience/acme.md')).toBeUndefined();
    expect(h.fs.file(`${SOURCES}/experience/acme.md`)).toBeDefined();
  });
});
