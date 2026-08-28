import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  NETWORK_KILL_SWITCH,
  NO_PACKAGES_DIRECTORY,
  TYPST_ENV_VARIABLE,
  TYPST_LIMITS,
  TYPST_VERSION,
  cacheDirectory,
  cachedBinaryPath,
  classifyExecError,
  compileTypst,
  containedEnvironment,
  isExecutableFile,
  locateTypst,
  parseTypstVersion,
  runProcess,
  typstArguments,
  typstCandidates,
  typstVersion,
  type CompileRequest,
  type ProcessOutcome,
  type ProcessRequest,
  type ProcessRunner,
} from '../../../src/renderers/typst';

const PDF = Buffer.from('%PDF-1.7 falso', 'latin1');

function fakeRunner(outcome: ProcessOutcome, calls: ProcessRequest[] = []): ProcessRunner {
  return (request) => {
    calls.push(request);
    return Promise.resolve(outcome);
  };
}

const REQUEST: CompileRequest = {
  binary: '/opt/typst',
  source: '#import "/cv.typ": cv\n#cv(json(bytes("{}")))\n',
  root: '/tpl',
  fontsDirectories: ['/fonts'],
  creationTimestamp: 946684800,
};

describe('entorno y argumentos contenidos', () => {
  it('el entorno del hijo está vacío salvo el interruptor de red (y SystemRoot en Windows)', () => {
    const linux = containedEnvironment('linux', { HOME: '/home/ada', TYPST_ROOT: '/', PATH: '/usr/bin' });
    expect(linux).toEqual({
      HTTP_PROXY: NETWORK_KILL_SWITCH,
      HTTPS_PROXY: NETWORK_KILL_SWITCH,
      ALL_PROXY: NETWORK_KILL_SWITCH,
      http_proxy: NETWORK_KILL_SWITCH,
      https_proxy: NETWORK_KILL_SWITCH,
      all_proxy: NETWORK_KILL_SWITCH,
      NO_PROXY: '',
      no_proxy: '',
    });
    expect(NETWORK_KILL_SWITCH).toBe('http://127.0.0.1:9');
    expect(containedEnvironment('win32', { SystemRoot: 'C:\\Windows', HOME: 'x' })['SystemRoot']).toBe('C:\\Windows');
    expect('SystemRoot' in containedEnvironment('win32', {})).toBe(false);
    expect(containedEnvironment()).toMatchObject({ HTTPS_PROXY: NETWORK_KILL_SWITCH });
  });

  it('el argv es fijo: stdin/stdout, root, fuentes propias, sin paquetes, fecha reproducible', () => {
    expect(typstArguments(REQUEST)).toEqual([
      'compile',
      '-',
      '-',
      '--root',
      '/tpl',
      '--font-path',
      '/fonts',
      '--ignore-system-fonts',
      '--package-path',
      NO_PACKAGES_DIRECTORY,
      '--package-cache-path',
      NO_PACKAGES_DIRECTORY,
      '--creation-timestamp',
      '946684800',
      '--diagnostic-format',
      'short',
    ]);
    expect(NO_PACKAGES_DIRECTORY.endsWith('chameleon-cv-no-packages')).toBe(true);
  });
});

describe('compileTypst', () => {
  it('devuelve el PDF de stdout y pasa la fuente por stdin con el entorno contenido y el root como cwd', async () => {
    const calls: ProcessRequest[] = [];
    const result = await compileTypst(REQUEST, fakeRunner({ kind: 'exited', status: 0, stdout: PDF, stderr: '' }, calls));
    expect(result).toEqual({ ok: true, pdf: PDF });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ file: '/opt/typst', args: typstArguments(REQUEST), input: REQUEST.source, cwd: '/tpl', timeoutMs: TYPST_LIMITS.timeoutMs, maxOutputBytes: TYPST_LIMITS.maxOutputBytes });
    expect(calls[0]?.env).toEqual(containedEnvironment());
    const custom: ProcessRequest[] = [];
    await compileTypst({ ...REQUEST, timeoutMs: 500, env: { X: '1' } }, fakeRunner({ kind: 'exited', status: 0, stdout: PDF, stderr: '' }, custom));
    expect(custom[0]).toMatchObject({ timeoutMs: 500, env: { X: '1' } });
  });

  it('traduce diagnósticos, salidas sin PDF, tiempo agotado y fallos de arranque', async () => {
    expect(await compileTypst(REQUEST, fakeRunner({ kind: 'exited', status: 1, stdout: Buffer.alloc(0), stderr: '<stdin>:2:5: error: unknown variable: cv\n' }))).toEqual({
      ok: false,
      code: 'compile-error',
      message: '<stdin>:2:5: error: unknown variable: cv',
    });
    expect(await compileTypst(REQUEST, fakeRunner({ kind: 'exited', status: 3, stdout: Buffer.alloc(0), stderr: '  ' }))).toEqual({
      ok: false,
      code: 'failed',
      message: 'Typst terminó con código 3 sin diagnóstico',
    });
    expect(await compileTypst(REQUEST, fakeRunner({ kind: 'exited', status: 0, stdout: Buffer.from('hola'), stderr: '' }))).toEqual({
      ok: false,
      code: 'failed',
      message: 'La salida de Typst no es un PDF',
    });
    expect(await compileTypst(REQUEST, fakeRunner({ kind: 'timeout' }))).toEqual({ ok: false, code: 'timeout', message: 'Typst superó los 20000 ms permitidos y fue terminado' });
    expect(await compileTypst(REQUEST, fakeRunner({ kind: 'failed', message: 'spawn ENOENT' }))).toEqual({ ok: false, code: 'failed', message: 'No se pudo ejecutar Typst: spawn ENOENT' });
  });
});

describe('typstVersion', () => {
  it('parsea la salida de --version y explica cualquier otra cosa', async () => {
    expect(parseTypstVersion('typst 0.15.1 (9dfd3a08)\n')).toBe('0.15.1');
    expect(parseTypstVersion('Typst version 1')).toBeUndefined();
    const calls: ProcessRequest[] = [];
    expect(await typstVersion('/opt/typst', fakeRunner({ kind: 'exited', status: 0, stdout: Buffer.from('typst 0.15.1 (9dfd3a08)\n'), stderr: '' }, calls))).toEqual({ ok: true, version: '0.15.1' });
    expect(calls[0]).toMatchObject({ file: '/opt/typst', args: ['--version'], timeoutMs: TYPST_LIMITS.versionTimeoutMs, env: containedEnvironment() });
    expect(await typstVersion('/opt/typst', fakeRunner({ kind: 'exited', status: 2, stdout: Buffer.alloc(0), stderr: 'x' }))).toEqual({ ok: false, message: '«/opt/typst --version» no respondió correctamente' });
    expect(await typstVersion('/opt/typst', fakeRunner({ kind: 'timeout' }))).toEqual({ ok: false, message: '«/opt/typst --version» no respondió correctamente' });
    expect(await typstVersion('/opt/typst', fakeRunner({ kind: 'failed', message: 'EACCES' }))).toEqual({ ok: false, message: 'EACCES' });
    expect(await typstVersion('/opt/typst', fakeRunner({ kind: 'exited', status: 0, stdout: Buffer.from('¿?'), stderr: '' }))).toEqual({ ok: false, message: '«/opt/typst --version» no devolvió una versión reconocible' });
  });
});

describe('localización del binario', () => {
  it('conoce la caché de usuario de cada plataforma', () => {
    expect(cacheDirectory({ XDG_CACHE_HOME: '/xdg' }, 'linux', '/home/ada')).toBe('/xdg/chameleon-cv');
    expect(cacheDirectory({}, 'linux', '/home/ada')).toBe('/home/ada/.cache/chameleon-cv');
    expect(cacheDirectory({}, 'darwin', '/Users/ada')).toBe('/Users/ada/Library/Caches/chameleon-cv');
    expect(cacheDirectory({ LOCALAPPDATA: 'C:\\Users\\ada\\AppData\\Local' }, 'win32', 'C:\\Users\\ada')).toBe(join('C:\\Users\\ada\\AppData\\Local', 'chameleon-cv'));
    expect(cacheDirectory({}, 'win32', 'C:\\Users\\ada')).toBe(join('C:\\Users\\ada', 'AppData', 'Local', 'chameleon-cv'));
    expect(cachedBinaryPath({}, 'linux', '/home/ada')).toBe(`/home/ada/.cache/chameleon-cv/typst/${TYPST_VERSION}/typst`);
    expect(cachedBinaryPath({}, 'win32', 'C:\\Users\\ada', '0.16.0').endsWith(join('typst', '0.16.0', 'typst.exe'))).toBe(true);
  });

  it('ordena los candidatos: --typst-path, CHAMELEON_TYPST, caché, PATH (con typst.exe en Windows)', () => {
    const env = { [TYPST_ENV_VARIABLE]: '/env/typst', PATH: '/usr/local/bin::/usr/bin' };
    expect(typstCandidates({ explicitPath: '/opt/typst', env, platform: 'linux', home: '/home/ada' })).toEqual([
      { path: '/opt/typst', source: 'option' },
      { path: '/env/typst', source: 'env' },
      { path: `/home/ada/.cache/chameleon-cv/typst/${TYPST_VERSION}/typst`, source: 'cache' },
      { path: '/usr/local/bin/typst', source: 'path' },
      { path: '/usr/bin/typst', source: 'path' },
    ]);
    expect(typstCandidates({ env: { [TYPST_ENV_VARIABLE]: '', PATH: 'C:\\bin;D:\\tools' }, platform: 'win32', home: 'C:\\Users\\ada' }).map((candidate) => candidate.path)).toEqual([
      join('C:\\Users\\ada', 'AppData', 'Local', 'chameleon-cv', 'typst', TYPST_VERSION, 'typst.exe'),
      join('C:\\bin', 'typst.exe'),
      join('C:\\bin', 'typst'),
      join('D:\\tools', 'typst.exe'),
      join('D:\\tools', 'typst'),
    ]);
    expect(typstCandidates({ env: {}, platform: 'linux', home: '/h' }).map((candidate) => candidate.source)).toEqual(['cache']);
    expect(typstCandidates().length).toBeGreaterThan(0);
  });

  it('devuelve el primer candidato ejecutable, o nada', async () => {
    const options = { env: { PATH: '/usr/bin' }, platform: 'linux' as const, home: '/home/ada' };
    expect(await locateTypst({ ...options, isExecutable: (path) => Promise.resolve(path === '/usr/bin/typst') })).toEqual({ path: '/usr/bin/typst', source: 'path' });
    expect(await locateTypst({ ...options, isExecutable: () => Promise.resolve(false) })).toBeUndefined();
  });

  it('isExecutableFile distingue ejecutables de ficheros sin permiso, directorios y ausentes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chameleon-typst-'));
    try {
      const executable = join(directory, 'typst');
      await writeFile(executable, '#!/bin/sh\necho typst 0.15.1\n', { mode: 0o755 });
      const plain = join(directory, 'plain');
      await writeFile(plain, '', { mode: 0o644 });
      expect(await isExecutableFile(executable)).toBe(true);
      expect(await isExecutableFile(plain)).toBe(false);
      expect(await isExecutableFile(directory)).toBe(false);
      expect(await isExecutableFile(join(directory, 'no-existe'))).toBe(false);
      expect(await locateTypst({ env: { PATH: directory }, platform: 'linux', home: '/nada' })).toEqual({ path: executable, source: 'path' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('runProcess (binarios de prueba reales)', () => {
  async function script(directory: string, name: string, body: string): Promise<string> {
    const path = join(directory, name);
    await writeFile(path, `#!/bin/sh\n${body}\n`);
    await chmod(path, 0o755);
    return path;
  }

  it('pasa stdin, recoge stdout/stderr y el código; agota el tiempo con SIGKILL; limita la salida; informa de fallos de arranque', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chameleon-run-'));
    try {
      await mkdir(join(directory, 'cwd'));
      const base = { env: containedEnvironment('linux', {}), cwd: join(directory, 'cwd'), timeoutMs: 5_000, maxOutputBytes: 1024 * 1024 };
      const echo = await script(directory, 'echo.sh', 'printf "%s" "$(cat)"; printf "aviso" >&2; test -z "$HOME" || exit 9; pwd >&2; exit 0');
      const ok = await runProcess({ ...base, file: echo, args: [], input: '%PDF-entrada' });
      expect(ok).toMatchObject({ kind: 'exited', status: 0, stderr: `aviso${join(directory, 'cwd')}\n` });
      expect(ok.kind === 'exited' && ok.stdout.toString()).toBe('%PDF-entrada');

      const failing = await script(directory, 'fail.sh', 'printf "diag" >&2; exit 3');
      expect(await runProcess({ ...base, file: failing, args: ['x'] })).toMatchObject({ kind: 'exited', status: 3, stderr: 'diag' });

      const slow = await script(directory, 'slow.sh', 'sleep 5');
      expect(await runProcess({ ...base, file: slow, args: [], timeoutMs: 200 })).toEqual({ kind: 'timeout' });

      const noisy = await script(directory, 'noisy.sh', 'head -c 5000 /dev/zero');
      expect(await runProcess({ ...base, file: noisy, args: [], maxOutputBytes: 1000 })).toEqual({ kind: 'failed', message: 'la salida del proceso supera el máximo permitido' });

      const missing = await runProcess({ ...base, file: join(directory, 'no-existe'), args: [] });
      expect(missing.kind).toBe('failed');
      expect(missing.kind === 'failed' && missing.message).toContain('ENOENT');

      // Un proceso que termina sin leer una entrada grande provoca EPIPE en stdin: se ignora y manda el resultado del proceso.
      const deaf = await script(directory, 'deaf.sh', 'exit 0');
      expect(await runProcess({ ...base, file: deaf, args: [], input: 'x'.repeat(4 * 1024 * 1024) })).toMatchObject({ kind: 'exited', status: 0 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('classifyExecError cubre las cuatro clases', () => {
    const out = Buffer.from('o');
    const err = Buffer.from('e');
    expect(classifyExecError(Object.assign(new Error('big'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true }), out, err)).toEqual({ kind: 'failed', message: 'la salida del proceso supera el máximo permitido' });
    expect(classifyExecError(Object.assign(new Error('killed'), { killed: true, signal: 'SIGKILL' as const }), out, err)).toEqual({ kind: 'timeout' });
    expect(classifyExecError(Object.assign(new Error('exit'), { code: 2 }), out, err)).toEqual({ kind: 'exited', status: 2, stdout: out, stderr: 'e' });
    expect(classifyExecError(Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }), out, err)).toEqual({ kind: 'failed', message: 'spawn EACCES' });
  });
});
