/**
 * Orquestador contenido de Typst (T-3.2, `docs/typst-integration.md` §3.3, canon aprobado):
 * localiza el binario oficial, comprueba su versión y lo ejecuta como proceso hijo con el mínimo
 * privilegio: stdin → stdout, `--root` restringido, entorno vacío con interruptor de red, sin
 * fuentes del sistema, sin paquetes, tiempo y salida limitados, `SIGKILL` al agotar el tiempo.
 */
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { describeError } from '../../shared/errors';

/** Versión fijada (`docs/typst-integration.md` §2.3): la plantilla se prueba contra esta versión. */
export const TYPST_VERSION = '0.15.1';
export const TYPST_ENV_VARIABLE = 'CHAMELEON_TYPST';
export const TYPST_RELEASES_URL = `https://github.com/typst/typst/releases/tag/v${TYPST_VERSION}`;

export const TYPST_LIMITS = {
  timeoutMs: 20_000,
  versionTimeoutMs: 5_000,
  maxOutputBytes: 32 * 1024 * 1024,
} as const;

/** Puerto 9 (discard) en loopback: cualquier conexión saliente falla en el acto (§3.2, sonda 9). */
export const NETWORK_KILL_SWITCH = 'http://127.0.0.1:9';

/** Directorio de paquetes que nunca existe: ningún `@preview` se resuelve ni se cachea. */
export const NO_PACKAGES_DIRECTORY = join(tmpdir(), 'chameleon-cv-no-packages');

/* ────────────────────────────── proceso hijo ────────────────────────────── */

export interface ProcessRequest {
  readonly file: string;
  readonly args: readonly string[];
  readonly input?: string | undefined;
  readonly env: NodeJS.ProcessEnv;
  readonly cwd?: string | undefined;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export type ProcessOutcome =
  | { readonly kind: 'exited'; readonly status: number; readonly stdout: Buffer; readonly stderr: string }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'failed'; readonly message: string };

export type ProcessRunner = (request: ProcessRequest) => Promise<ProcessOutcome>;

interface ExecError extends Error {
  readonly code?: string | number | undefined;
  readonly killed?: boolean | undefined;
  readonly signal?: NodeJS.Signals | null | undefined;
}

/** Clasifica el error de `execFile`: salida con código, tiempo agotado, salida excesiva o fallo de arranque. */
export function classifyExecError(error: ExecError, stdout: Buffer, stderr: Buffer): ProcessOutcome {
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return { kind: 'failed', message: 'la salida del proceso supera el máximo permitido' };
  }
  if (error.killed === true) {
    return { kind: 'timeout' };
  }
  if (typeof error.code === 'number') {
    return { kind: 'exited', status: error.code, stdout, stderr: stderr.toString('utf8') };
  }
  return { kind: 'failed', message: describeError(error) };
}

/** Ejecuta un binario sin shell, con `argv` fijo, entorno dado y límites; la entrada va por stdin. */
export const runProcess: ProcessRunner = (request) =>
  new Promise((resolve) => {
    const child = execFile(
      request.file,
      [...request.args],
      {
        cwd: request.cwd,
        env: request.env,
        timeout: request.timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: request.maxOutputBytes,
        encoding: 'buffer',
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        resolve(error === null ? { kind: 'exited', status: 0, stdout, stderr: stderr.toString('utf8') } : classifyExecError(error, stdout, stderr));
      },
    );
    // Si el proceso no arranca (ENOENT) o termina antes de leer, stdin emite EPIPE: el resultado ya lo da el callback.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(request.input ?? '');
  });

/* ─────────────────────────── entorno y argumentos ─────────────────────────── */

/**
 * Entorno mínimo del proceso hijo: sin variables heredadas (ni `HOME`, ni `TYPST_*`), con todo
 * proxy apuntando al interruptor de red. En Windows el arranque de procesos exige `SystemRoot`.
 */
export function containedEnvironment(platform: NodeJS.Platform = process.platform, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    HTTP_PROXY: NETWORK_KILL_SWITCH,
    HTTPS_PROXY: NETWORK_KILL_SWITCH,
    ALL_PROXY: NETWORK_KILL_SWITCH,
    http_proxy: NETWORK_KILL_SWITCH,
    https_proxy: NETWORK_KILL_SWITCH,
    all_proxy: NETWORK_KILL_SWITCH,
    NO_PROXY: '',
    no_proxy: '',
  };
  if (platform === 'win32' && base['SystemRoot'] !== undefined) {
    env['SystemRoot'] = base['SystemRoot'];
  }
  return env;
}

export interface CompileRequest {
  readonly binary: string;
  /** Documento principal (stdin). */
  readonly source: string;
  /** Directorio con la plantilla y solo la plantilla (`--root`). */
  readonly root: string;
  readonly fontsDirectory: string;
  /** Segundos desde la época para `CreationDate` (reproducibilidad). */
  readonly creationTimestamp: number;
  readonly timeoutMs?: number | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
}

/** `argv` fijo de la compilación (§3.1): nada del usuario entra aquí salvo rutas ya resueltas. */
export function typstArguments(request: CompileRequest): string[] {
  return [
    'compile',
    '-',
    '-',
    '--root',
    request.root,
    '--font-path',
    request.fontsDirectory,
    '--ignore-system-fonts',
    '--package-path',
    NO_PACKAGES_DIRECTORY,
    '--package-cache-path',
    NO_PACKAGES_DIRECTORY,
    '--creation-timestamp',
    String(request.creationTimestamp),
    '--diagnostic-format',
    'short',
  ];
}

export type CompileErrorCode = 'compile-error' | 'timeout' | 'failed';

export type CompileResult =
  | { readonly ok: true; readonly pdf: Buffer }
  | { readonly ok: false; readonly code: CompileErrorCode; readonly message: string };

export async function compileTypst(request: CompileRequest, runner: ProcessRunner = runProcess): Promise<CompileResult> {
  const timeoutMs = request.timeoutMs ?? TYPST_LIMITS.timeoutMs;
  const outcome = await runner({
    file: request.binary,
    args: typstArguments(request),
    input: request.source,
    env: request.env ?? containedEnvironment(),
    cwd: request.root,
    timeoutMs,
    maxOutputBytes: TYPST_LIMITS.maxOutputBytes,
  });
  switch (outcome.kind) {
    case 'timeout':
      return { ok: false, code: 'timeout', message: `Typst superó los ${timeoutMs} ms permitidos y fue terminado` };
    case 'failed':
      return { ok: false, code: 'failed', message: `No se pudo ejecutar Typst: ${outcome.message}` };
    case 'exited':
      if (outcome.status !== 0) {
        const diagnostics = outcome.stderr.trim();
        return diagnostics === ''
          ? { ok: false, code: 'failed', message: `Typst terminó con código ${outcome.status} sin diagnóstico` }
          : { ok: false, code: 'compile-error', message: diagnostics };
      }
      if (!outcome.stdout.subarray(0, 5).equals(Buffer.from('%PDF-', 'latin1'))) {
        return { ok: false, code: 'failed', message: 'La salida de Typst no es un PDF' };
      }
      return { ok: true, pdf: outcome.stdout };
  }
}

/* ───────────────────────────────── versión ───────────────────────────────── */

/** `typst 0.15.1 (9dfd3a08)` → `0.15.1`. */
export function parseTypstVersion(output: string): string | undefined {
  return /^typst (\d+\.\d+\.\d+)/.exec(output.trim())?.[1];
}

export type VersionResult = { readonly ok: true; readonly version: string } | { readonly ok: false; readonly message: string };

export async function typstVersion(binary: string, runner: ProcessRunner = runProcess, env: NodeJS.ProcessEnv = containedEnvironment()): Promise<VersionResult> {
  const outcome = await runner({ file: binary, args: ['--version'], env, timeoutMs: TYPST_LIMITS.versionTimeoutMs, maxOutputBytes: 64 * 1024 });
  if (outcome.kind !== 'exited' || outcome.status !== 0) {
    return { ok: false, message: outcome.kind === 'failed' ? outcome.message : `«${binary} --version» no respondió correctamente` };
  }
  const version = parseTypstVersion(outcome.stdout.toString('utf8'));
  return version === undefined ? { ok: false, message: `«${binary} --version» no devolvió una versión reconocible` } : { ok: true, version };
}

/* ─────────────────────────────── localización ─────────────────────────────── */

export type TypstSource = 'option' | 'env' | 'cache' | 'path';

export interface TypstLocation {
  readonly path: string;
  readonly source: TypstSource;
}

export interface LocateOptions {
  /** `--typst-path`. */
  readonly explicitPath?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly platform?: NodeJS.Platform | undefined;
  readonly home?: string | undefined;
  readonly isExecutable?: ((path: string) => Promise<boolean>) | undefined;
}

/** Directorio de caché de usuario donde `cv typst install` (T-3.3) deja el binario. */
export function cacheDirectory(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string {
  if (platform === 'win32') {
    return join(env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local'), 'chameleon-cv');
  }
  if (platform === 'darwin') {
    return join(home, 'Library', 'Caches', 'chameleon-cv');
  }
  return join(env['XDG_CACHE_HOME'] ?? join(home, '.cache'), 'chameleon-cv');
}

export function cachedBinaryPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string, version: string = TYPST_VERSION): string {
  return join(cacheDirectory(env, platform, home), 'typst', version, platform === 'win32' ? 'typst.exe' : 'typst');
}

/** Fichero regular y ejecutable (en Windows basta con que exista). */
export async function isExecutableFile(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) {
      return false;
    }
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Candidatos en orden de prioridad: `--typst-path`, `CHAMELEON_TYPST`, caché de usuario, `PATH`. */
export function typstCandidates(options: LocateOptions = {}): ReadonlyArray<TypstLocation> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const candidates: TypstLocation[] = [];
  if (options.explicitPath !== undefined) {
    candidates.push({ path: options.explicitPath, source: 'option' });
  }
  const fromEnv = env[TYPST_ENV_VARIABLE];
  if (fromEnv !== undefined && fromEnv !== '') {
    candidates.push({ path: fromEnv, source: 'env' });
  }
  candidates.push({ path: cachedBinaryPath(env, platform, home), source: 'cache' });
  const names = platform === 'win32' ? ['typst.exe', 'typst'] : ['typst'];
  const separator = platform === 'win32' ? ';' : ':';
  for (const directory of (env['PATH'] ?? '').split(separator).filter((entry) => entry !== '')) {
    for (const name of names) {
      candidates.push({ path: join(directory, name), source: 'path' });
    }
  }
  return candidates;
}

export async function locateTypst(options: LocateOptions = {}): Promise<TypstLocation | undefined> {
  const isExecutable = options.isExecutable ?? isExecutableFile;
  for (const candidate of typstCandidates(options)) {
    if (await isExecutable(candidate.path)) {
      return candidate;
    }
  }
  return undefined;
}
