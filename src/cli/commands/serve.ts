/**
 * `cv serve` (T-7.4a): arranca el servidor local de la API sobre el espacio de trabajo y se queda en marcha
 * hasta Ctrl-C o `POST /api/v1/shutdown`. Imprime la URL con el token de sesión (en el fragmento, que
 * nunca viaja) y, con --open, abre el navegador.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { InvalidArgumentError } from 'commander';

import { loadServeSettings } from '../../app/settings';
import { readVersion } from '../../app/workspace';
import { describeError } from '../../shared/errors';
import { startServer, type ServeOptions as StartOptions, type ServerHandle } from '../../serve/server';
import type { CliContext } from '../context';
import { EXIT_FAILURE, EXIT_OK } from '../output';

export interface ServeCommandOptions {
  readonly port: number;
  readonly host: string;
  readonly workspace?: string | undefined;
  readonly data: string;
  readonly profile: string;
  readonly apiOnly: boolean;
  readonly open: boolean;
  readonly allowedHosts?: string | undefined;
  /**
   * `--allow-remote` / `--no-allow-remote`: los trabajos del co-piloto pueden usar proveedores remotos (con
   * consentimiento de coste). Sin bandera (`undefined`) manda `[serve] allow_remote` de `cv.toml`; sin clave, no.
   */
  readonly allowRemote?: boolean | undefined;
}

export interface ServeDeps {
  readonly start: (options: StartOptions) => Promise<ServerHandle>;
  readonly openBrowser: (url: string) => void;
  /** Registra el cierre ordenado con Ctrl-C (inyectable para no tocar `process` en las pruebas). */
  readonly onInterrupt: (handler: () => void) => void;
}

export type Spawner = (command: string, args: readonly string[]) => { on(event: 'error', handler: () => void): unknown; unref(): void };

const defaultSpawner: Spawner = (command, args) => spawn(command, [...args], { stdio: 'ignore', detached: true });

/** Abre la URL con el navegador del sistema sin esperar ni fallar si no hay ninguno. */
export function openBrowser(url: string, platform: NodeJS.Platform = process.platform, spawner: Spawner = defaultSpawner): void {
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawner(command, args);
  child.on('error', () => undefined);
  child.unref();
}

export const DEFAULT_DEPS: ServeDeps = {
  start: startServer,
  openBrowser,
  onInterrupt: (handler) => {
    process.once('SIGINT', handler);
    process.once('SIGTERM', handler);
  },
};

/** Puerto: entero entre 0 (efímero) y 65535. */
export function parsePort(value: string): number {
  const port = Number(value);
  if (!/^\d+$/.test(value.trim()) || port > 65535) {
    throw new InvalidArgumentError('el puerto debe ser un entero entre 0 y 65535');
  }
  return port;
}

export async function runServe(context: CliContext, options: ServeCommandOptions, deps: ServeDeps = DEFAULT_DEPS): Promise<number> {
  const workspace = resolve(context.cwd, options.workspace ?? '.');
  try {
    if ((await context.datasetFileSystem.stat(workspace)).kind !== 'directory') {
      context.stderr(`El espacio de trabajo «${workspace}» no es un directorio\n`);
      return EXIT_FAILURE;
    }
  } catch (error) {
    context.stderr(`No se puede usar el espacio de trabajo «${workspace}»: ${describeError(error)}\n`);
    return EXIT_FAILURE;
  }
  // El permiso de salida a remotos: la bandera de la CLI manda; sin ella, `[serve] allow_remote` de cv.toml (T-8.17).
  let allowRemote = options.allowRemote ?? false;
  let allowRemoteOrigin = options.allowRemote === undefined ? 'por defecto' : '--allow-remote';
  if (options.allowRemote === undefined) {
    const settings = await loadServeSettings(workspace, context.datasetFileSystem);
    if (settings.error !== undefined) {
      context.stderr(`Aviso: no se pudo leer ${settings.path} (${settings.error}); los proveedores remotos quedan prohibidos\n`);
    } else if (settings.settings?.allow_remote === true) {
      allowRemote = true;
      allowRemoteOrigin = `[serve] allow_remote de ${settings.path}`;
    }
  }
  const version = readVersion(await context.assets.text('package.json'));
  let handle: ServerHandle;
  try {
    handle = await deps.start({
      context: { ...context, cwd: workspace },
      host: options.host,
      port: options.port,
      data: options.data,
      profile: options.profile,
      version,
      apiOnly: options.apiOnly,
      allowedHosts: options.allowedHosts === undefined ? [] : options.allowedHosts.split(','),
      allowRemote,
    });
  } catch (error) {
    context.stderr(`No se pudo arrancar el servidor en ${options.host}:${options.port}: ${describeError(error)}\n`);
    return EXIT_FAILURE;
  }
  context.stderr(`Chameleon CV ${version} · espacio de trabajo ${workspace}\n`);
  context.stderr(`API: ${handle.url}api/v1/ (Authorization: Bearer <token>)\n`);
  if (allowRemote) {
    context.stderr(`Proveedores remotos permitidos (${allowRemoteOrigin}): cada trabajo exigirá confirmar el coste estimado\n`);
  }
  context.stderr(`${options.apiOnly ? 'Token' : 'Interfaz'}: ${handle.url}#token=${handle.token}\n`);
  context.stderr('Ctrl-C para parar (o POST /api/v1/shutdown)\n');
  if (options.open) {
    deps.openBrowser(`${handle.url}#token=${handle.token}`);
  }
  deps.onInterrupt(() => void handle.close());
  await handle.closed;
  context.stderr('Servidor detenido\n');
  return EXIT_OK;
}
