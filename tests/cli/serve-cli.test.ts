import { InvalidArgumentError } from 'commander';
import { describe, expect, it } from 'vitest';

import { DEFAULT_DEPS, EXIT_FAILURE, EXIT_OK, openBrowser, parsePort, runCli, runServe, type CliContext, type ServeDeps } from '../../src/cli';
import { MemoryLlmCache, llmStatus } from '../../src/llm';
import { defaultSourceParsers } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import { renderTypstCv } from '../../src/renderers/typst';
import type { ServerHandle } from '../../src/serve';
import { defaultAssets } from '../../src/shared/assets';
import { installTypst, typstStatus } from '../../src/typst';
import { MemoryFileSystem, datasetTree } from '../helpers/memory-file-system';

function harness(tree = datasetTree()): { context: CliContext; stderr: () => string } {
  const err: string[] = [];
  const fs = new MemoryFileSystem({ ...tree, '/work/data/sources/profile.md': '---\nfullName: Ada\n---\n' });
  const context: CliContext = {
    cwd: '/work',
    stdout: () => undefined,
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
    llmProvider: () => Promise.resolve({ ok: false as const, message: 'sin proveedor' }),
    llmCache: new MemoryLlmCache(),
    assets: defaultAssets(),
  };
  return { context, stderr: () => err.join('') };
}

function fakeHandle(): { handle: ServerHandle; closeCalls: () => number } {
  let calls = 0;
  let resolveClosed: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  return {
    handle: {
      url: 'http://127.0.0.1:4310/',
      token: 'tok',
      port: 4310,
      closed,
      close: () => {
        calls += 1;
        resolveClosed();
        return Promise.resolve();
      },
    },
    closeCalls: () => calls,
  };
}

const OPTIONS = { port: 4310, host: '127.0.0.1', data: 'data/sources', profile: 'data/dist/profile.json', apiOnly: false, open: false, allowRemote: false } as const;

describe('cv serve', () => {
  it('arranca sobre el espacio de trabajo, imprime la URL con el token y termina con Ctrl-C', async () => {
    const { context, stderr } = harness();
    const { handle, closeCalls } = fakeHandle();
    const opened: string[] = [];
    let started: Parameters<ServeDeps['start']>[0] | undefined;
    const deps: ServeDeps = {
      start: (options) => {
        started = options;
        return Promise.resolve(handle);
      },
      openBrowser: (url) => {
        opened.push(url);
      },
      onInterrupt: (handler) => setTimeout(handler, 5),
    };
    expect(await runServe(context, { ...OPTIONS, open: true, allowedHosts: 'a:1,b:2' }, deps)).toBe(EXIT_OK);
    expect(started?.context.cwd).toBe('/work');
    expect(started?.allowedHosts).toEqual(['a:1', 'b:2']);
    expect(started?.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(opened).toEqual(['http://127.0.0.1:4310/#token=tok']);
    expect(closeCalls()).toBe(1);
    expect(stderr()).toContain('API: http://127.0.0.1:4310/api/v1/ (Authorization: Bearer <token>)\nInterfaz: http://127.0.0.1:4310/#token=tok\nCtrl-C para parar (o POST /api/v1/shutdown)\nServidor detenido\n');
  });

  it('en --api-only anuncia el token en lugar de la interfaz y admite --workspace', async () => {
    const { context, stderr } = harness({ '/work/otro/.keep': '' });
    const { handle } = fakeHandle();
    const deps: ServeDeps = { start: () => Promise.resolve(handle), openBrowser: () => undefined, onInterrupt: (handler) => setTimeout(handler, 1) };
    expect(await runServe(context, { ...OPTIONS, apiOnly: true, workspace: 'otro' }, deps)).toBe(EXIT_OK);
    expect(stderr()).toContain('espacio de trabajo /work/otro\n');
    expect(stderr()).toContain('Token: http://127.0.0.1:4310/#token=tok\n');
  });

  it('con --allow-remote lo anuncia y se lo pasa al servidor', async () => {
    const { context, stderr } = harness();
    const { handle } = fakeHandle();
    let started: Parameters<ServeDeps['start']>[0] | undefined;
    const deps: ServeDeps = {
      start: (options) => {
        started = options;
        return Promise.resolve(handle);
      },
      openBrowser: () => undefined,
      onInterrupt: (handler) => setTimeout(handler, 1),
    };
    expect(await runServe(context, { ...OPTIONS, allowRemote: true }, deps)).toBe(EXIT_OK);
    expect(started?.allowRemote).toBe(true);
    expect(stderr()).toContain('Proveedores remotos permitidos (--allow-remote): cada trabajo exigirá confirmar el coste estimado\n');
  });

  it('rechaza un espacio de trabajo inexistente o que no es un directorio, y un arranque fallido', async () => {
    const { context, stderr } = harness();
    const deps: ServeDeps = { start: () => Promise.reject(new Error('EADDRINUSE')), openBrowser: () => undefined, onInterrupt: () => undefined };
    expect(await runServe(context, { ...OPTIONS, workspace: 'no-existe' }, deps)).toBe(EXIT_FAILURE);
    expect(stderr()).toContain('No se puede usar el espacio de trabajo «/work/no-existe»');
    expect(await runServe(context, { ...OPTIONS, workspace: 'data/sources/profile.md' }, deps)).toBe(EXIT_FAILURE);
    expect(stderr()).toContain('El espacio de trabajo «/work/data/sources/profile.md» no es un directorio');
    expect(await runServe(context, OPTIONS, deps)).toBe(EXIT_FAILURE);
    expect(stderr()).toContain('No se pudo arrancar el servidor en 127.0.0.1:4310: EADDRINUSE');
  });

  it('parsePort admite 0–65535 y rechaza el resto', () => {
    expect(parsePort('0')).toBe(0);
    expect(parsePort('4310')).toBe(4310);
    expect(() => parsePort('65536')).toThrow(InvalidArgumentError);
    expect(() => parsePort('abc')).toThrow(InvalidArgumentError);
  });

  it('openBrowser elige la orden de cada plataforma, no espera y traga los errores', () => {
    const calls: Array<[string, readonly string[]]> = [];
    const spawner = (command: string, args: readonly string[]): { on(event: 'error', handler: () => void): unknown; unref(): void } => {
      calls.push([command, args]);
      return { on: (_event, handler) => handler(), unref: () => undefined };
    };
    openBrowser('http://x/', 'linux', spawner);
    openBrowser('http://x/', 'darwin', spawner);
    openBrowser('http://x/', 'win32', spawner);
    expect(calls).toEqual([
      ['xdg-open', ['http://x/']],
      ['open', ['http://x/']],
      ['cmd', ['/c', 'start', '', 'http://x/']],
    ]);
    // El spawner por defecto: en Linux «cmd» no existe y el error se traga sin abrir nada.
    openBrowser('about:blank', 'win32');
    const before = process.listenerCount('SIGINT');
    const handler = (): void => undefined;
    DEFAULT_DEPS.onInterrupt(handler);
    expect(process.listenerCount('SIGINT')).toBe(before + 1);
    process.removeListener('SIGINT', handler);
    process.removeListener('SIGTERM', handler);
  });

  it('a través de commander: un servidor real en un puerto efímero que se para con POST /shutdown', async () => {
    const { context, stderr } = harness();
    const pending = runCli(['serve', '--port', '0', '--api-only'], context);
    for (let attempt = 0; attempt < 100 && !stderr().includes('Token:'); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const url = /Token: (http:\/\/127\.0\.0\.1:\d+\/)#token=(\S+)/.exec(stderr());
    expect(url).not.toBeNull();
    const [, base, token] = url as RegExpExecArray;
    const status = await fetch(`${base}api/v1/status`, { headers: { Authorization: `Bearer ${token}` } });
    expect(status.status).toBe(200);
    expect((await fetch(`${base}api/v1/shutdown`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).status).toBe(202);
    expect(await pending).toBe(EXIT_OK);
    expect(stderr()).toContain('Servidor detenido');
  });
});
