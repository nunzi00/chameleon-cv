/**
 * Extracción del archivo del release (T-3.3) con el `tar` del sistema (GNU tar o bsdtar, que
 * leen `.tar.xz` y `.zip`): otro proceso hijo con `argv` fijo, entorno mínimo y tiempo acotado.
 * Solo se extrae un archivo cuyo SHA-256 ya coincide con el manifiesto.
 */
import { join } from 'node:path';

import { isExecutableFile, runProcess, type ProcessRunner } from '../renderers/typst/engine';

export const EXTRACT_LIMITS = { timeoutMs: 60_000, maxOutputBytes: 1024 * 1024 } as const;

/** Primer ejecutable llamado `name` en el `PATH` de `env` (con `.exe` en Windows). */
export async function findInPath(
  name: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  isExecutable: (path: string) => Promise<boolean> = isExecutableFile,
): Promise<string | undefined> {
  const names = platform === 'win32' ? [`${name}.exe`, name] : [name];
  const separator = platform === 'win32' ? ';' : ':';
  for (const directory of (env['PATH'] ?? '').split(separator).filter((entry) => entry !== '')) {
    for (const candidate of names) {
      const path = join(directory, candidate);
      if (await isExecutable(path)) {
        return path;
      }
    }
  }
  return undefined;
}

export interface ExtractOptions {
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly platform?: NodeJS.Platform | undefined;
  readonly runner?: ProcessRunner | undefined;
  /** Ruta de `tar`; por defecto se busca en el `PATH`. */
  readonly tar?: string | undefined;
  readonly isExecutable?: ((path: string) => Promise<boolean>) | undefined;
}

export type ExtractResult = { readonly ok: true; readonly tar: string } | { readonly ok: false; readonly message: string };

/** Entorno para `tar`: solo `PATH` (GNU tar necesita encontrar `xz`) y `SystemRoot` en Windows. */
export function extractionEnvironment(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { PATH: env['PATH'] ?? '' };
  if (platform === 'win32' && env['SystemRoot'] !== undefined) {
    result['SystemRoot'] = env['SystemRoot'];
  }
  return result;
}

export async function extractArchive(archive: string, target: string, options: ExtractOptions = {}): Promise<ExtractResult> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const tar = options.tar ?? (await findInPath('tar', env, platform, options.isExecutable));
  if (tar === undefined) {
    return { ok: false, message: 'No se encontró «tar» en el PATH: instálalo (en Linux necesita también «xz») y repite «cv typst install»' };
  }
  const outcome = await (options.runner ?? runProcess)({
    file: tar,
    args: ['-xf', archive, '-C', target],
    env: extractionEnvironment(env, platform),
    cwd: target,
    timeoutMs: EXTRACT_LIMITS.timeoutMs,
    maxOutputBytes: EXTRACT_LIMITS.maxOutputBytes,
  });
  switch (outcome.kind) {
    case 'exited':
      return outcome.status === 0 ? { ok: true, tar } : { ok: false, message: `«tar» terminó con código ${outcome.status}: ${outcome.stderr.trim()}` };
    case 'timeout':
      return { ok: false, message: `«tar» superó los ${EXTRACT_LIMITS.timeoutMs} ms permitidos` };
    case 'failed':
      return { ok: false, message: `No se pudo ejecutar «tar»: ${outcome.message}` };
  }
}
