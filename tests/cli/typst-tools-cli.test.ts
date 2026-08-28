import { describe, expect, it } from 'vitest';

import { EXIT_FAILURE, EXIT_OK, runCli, type CliContext, type TypstInstaller, type TypstStatusReporter } from '../../src/cli';
import { defaultSourceParsers } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import { TYPST_VERSION, renderTypstCv } from '../../src/renderers/typst';
import type { InstallOptions, InstallResult, TypstStatus } from '../../src/typst';
import { MemoryLlmCache, llmStatus } from '../../src/llm';
import { MemoryFileSystem } from '../helpers/memory-file-system';

interface Harness {
  readonly context: CliContext;
  readonly installs: InstallOptions[];
  readonly stdout: () => string;
  readonly stderr: () => string;
}

function harness(install: InstallResult, status: TypstStatus): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const installs: InstallOptions[] = [];
  const fs = new MemoryFileSystem();
  const typstInstall: TypstInstaller = (options, report) => {
    installs.push(options);
    report('paso 1');
    report('paso 2');
    return Promise.resolve(install);
  };
  const typstStatus: TypstStatusReporter = () => Promise.resolve(status);
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
    typstInstall,
    typstStatus,
    llmStatus: (options) => llmStatus(options),
    llmProvider: () => ({ ok: false, message: 'sin proveedor en las pruebas' }),
    llmCache: new MemoryLlmCache(),
  };
  return { context, installs, stdout: () => out.join(''), stderr: () => err.join('') };
}

const INSTALLED: InstallResult = { ok: true, path: '/home/ada/.cache/chameleon-cv/typst/0.15.1/typst', version: TYPST_VERSION, alreadyInstalled: false };
const USABLE: TypstStatus = {
  required: TYPST_VERSION,
  candidates: [{ source: 'cache', path: '/c/typst', state: 'ok', version: TYPST_VERSION }],
  selected: { source: 'cache', path: '/c/typst', state: 'ok', version: TYPST_VERSION },
  usable: true,
};
const NONE: TypstStatus = { required: TYPST_VERSION, candidates: [{ source: 'path', path: undefined, state: 'missing' }], selected: undefined, usable: false };

describe('cv typst install', () => {
  it('cuenta cada paso por stdout y sale con 0; --force se transmite', async () => {
    const h = harness(INSTALLED, USABLE);
    expect(await runCli(['typst', 'install'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe('paso 1\npaso 2\n');
    expect(h.stderr()).toBe('');
    expect(h.installs).toEqual([{ force: false }]);
    expect(await runCli(['typst', 'install', '--force'], h.context)).toBe(EXIT_OK);
    expect(h.installs[1]).toEqual({ force: true });
  });

  it('un fallo se explica en stderr y sale con 2', async () => {
    const h = harness({ ok: false, code: 'integrity', message: 'SHA-256 incorrecto: …' }, USABLE);
    expect(await runCli(['typst', 'install'], h.context)).toBe(EXIT_FAILURE);
    expect(h.stdout()).toBe('paso 1\npaso 2\n');
    expect(h.stderr()).toBe('SHA-256 incorrecto: …\n');
  });
});

describe('cv typst status', () => {
  it('imprime el estado y sale con 0 si hay un binario utilizable, con 2 si no', async () => {
    const usable = harness(INSTALLED, USABLE);
    expect(await runCli(['typst', 'status'], usable.context)).toBe(EXIT_OK);
    expect(usable.stdout()).toBe(`Typst requerido: ${TYPST_VERSION}\nSe usaría: /c/typst (caché de usuario) · typst ${TYPST_VERSION}\nCandidatos, por prioridad:\n  caché de usuario: /c/typst (typst ${TYPST_VERSION})\n`);

    const none = harness(INSTALLED, NONE);
    expect(await runCli(['typst', 'status'], none.context)).toBe(EXIT_FAILURE);
    expect(none.stdout()).toContain('Ningún binario ejecutable');
  });

  it('la ayuda del grupo typst describe ambos subcomandos', async () => {
    const h = harness(INSTALLED, USABLE);
    await runCli(['typst', '--help'], h.context);
    expect(h.stdout()).toContain('install');
    expect(h.stdout()).toContain('status');
    expect(h.stdout().replace(/\s+/g, ' ')).toContain('única operación de red');
  });
});
