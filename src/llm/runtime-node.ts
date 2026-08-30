/**
 * Adaptador de Node para el runtime de Ollama (T-8.8): procesos sin shell (`execFile`/`spawn` con argv), fichero
 * de pid y registro con permisos 0600, y la salud del proveedor a través del cliente HTTP loopback del producto.
 */
import { execFile, spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import type { Readable } from 'node:stream';

import { createProvider, type LlmConfig } from './config';
import type { LlmHealth } from './provider';
import type { ExecResult, RuntimeSystem } from './runtime';

const MAX_OUTPUT = 4 * 1024 * 1024;

/** Reparte la salida en líneas (`ollama pull` refresca el progreso con retorno de carro). */
export function attachLines(stream: Readable | null, onLine: (line: string) => void): void {
  if (stream === null) {
    return;
  }
  let rest = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    const parts = (rest + chunk).split(/\r?\n|\r/);
    rest = parts.splice(-1, 1).join('');
    for (const part of parts) {
      if (part.trim() !== '') {
        onLine(part.trimEnd());
      }
    }
  });
  stream.on('end', () => {
    if (rest.trim() !== '') {
      onLine(rest.trimEnd());
    }
  });
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

export interface NodeRuntimeOptions {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly platform?: NodeJS.Platform | undefined;
  readonly home?: string | undefined;
  /** Salud del proveedor; por defecto, la del proveedor real (loopback). */
  readonly health?: ((config: LlmConfig) => Promise<LlmHealth>) | undefined;
}

export function createNodeRuntimeSystem(options: NodeRuntimeOptions): RuntimeSystem {
  const env = options.env ?? process.env;
  return {
    exec: (command, args, { timeoutMs, env: extra, onLine, signal }) =>
      new Promise<ExecResult>((resolvePromise) => {
        const child = execFile(
          command,
          [...args],
          { timeout: timeoutMs, maxBuffer: MAX_OUTPUT, windowsHide: true, env: { ...stringEnv(env), ...extra }, ...(signal === undefined ? {} : { signal }) },
          (error, stdout, stderr) => {
            const code = error === null ? 0 : typeof error.code === 'number' ? error.code : null;
            resolvePromise({ ok: error === null, code, stdout, stderr, message: error === null ? undefined : error.message });
          },
        );
        if (onLine !== undefined) {
          attachLines(child.stdout, onLine);
          attachLines(child.stderr, onLine);
        }
      }),
    spawnDetached: async (command, args, { env: childEnv, logPath }) => {
      await mkdir(dirname(logPath), { recursive: true, mode: 0o700 });
      const fd = openSync(logPath, 'a', 0o600);
      return new Promise((resolvePromise) => {
        const child = spawn(command, [...args], { detached: true, stdio: ['ignore', fd, fd], env: { ...childEnv }, windowsHide: true });
        child.once('error', (error) => {
          closeSync(fd);
          resolvePromise({ ok: false, message: error.message });
        });
        child.once('spawn', () => {
          closeSync(fd);
          child.unref();
          resolvePromise({ ok: true, pid: Number(child.pid) });
        });
      });
    },
    files: {
      read: async (path) => {
        try {
          return await readFile(path, 'utf8');
        } catch {
          return undefined;
        }
      },
      write: async (path, content) => {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await writeFile(path, content, { mode: 0o600 });
      },
      remove: (path) => rm(path, { force: true }),
    },
    health: options.health ?? ((config) => createProvider(config).health()),
    processAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },
    terminate: (pid) => {
      try {
        process.kill(pid, 'SIGTERM');
        return true;
      } catch {
        return false;
      }
    },
    sleep: (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)),
    env,
    platform: options.platform ?? process.platform,
    home: options.home ?? homedir(),
    cwd: options.cwd,
  };
}
