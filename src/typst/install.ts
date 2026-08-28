/**
 * `cv typst install` (T-3.3, `docs/typst-integration.md` §2.3): instalación atómica del binario
 * oficial en la caché de usuario. Descarga verificada → extracción en un directorio temporal →
 * comprobación de `--version` → renombrado atómico. Si algo falla, no queda nada a medias y el
 * binario anterior (si lo había) sigue intacto. Cada paso se cuenta al usuario.
 */
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readdir, rename, rm, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { cachedBinaryPath, containedEnvironment, isExecutableFile, runProcess, typstVersion, type ProcessRunner } from '../renderers/typst/engine';
import { describeError } from '../shared/errors';
import { DownloadError, downloadToFile, type Fetcher } from './download';
import { extractArchive } from './extract';
import { assetUrl, formatMegabytes, loadManifest, platformKey, type ReleaseManifest } from './manifest';

export interface InstallOptions {
  readonly platform?: NodeJS.Platform | undefined;
  readonly arch?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly home?: string | undefined;
  /** Reinstala aunque ya exista un binario correcto. */
  readonly force?: boolean | undefined;
  readonly manifest?: ReleaseManifest | undefined;
  readonly fetcher?: Fetcher | undefined;
  readonly runner?: ProcessRunner | undefined;
  readonly tar?: string | undefined;
  readonly isExecutable?: ((path: string) => Promise<boolean>) | undefined;
}

export type InstallErrorCode = 'unsupported-platform' | 'download-failed' | 'integrity' | 'extract-failed' | 'verify-failed' | 'io';

export type InstallResult =
  | { readonly ok: true; readonly path: string; readonly version: string; readonly alreadyInstalled: boolean }
  | { readonly ok: false; readonly code: InstallErrorCode; readonly message: string };

export type Reporter = (line: string) => void;

/** Nombre del binario dentro del archivo del release. */
export function binaryName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'typst.exe' : 'typst';
}

/** Busca el binario en el árbol extraído (los releases lo dejan en `typst-<target>/`). */
export async function findExtractedBinary(root: string, name: string): Promise<string | undefined> {
  const entries = [...(await readdir(root, { withFileTypes: true }))].sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name === name) {
      return path;
    }
    if (entry.isDirectory()) {
      const found = await findExtractedBinary(path, name);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}

async function removeQuietly(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch {
    // Limpieza de temporales: un resto huérfano es un daño menor y el resultado real ya está decidido.
  }
}

function downloadFailure(error: unknown): InstallResult {
  if (error instanceof DownloadError) {
    return { ok: false, code: error.code === 'integrity' ? 'integrity' : 'download-failed', message: error.message };
  }
  return { ok: false, code: 'io', message: `No se pudo guardar la descarga: ${describeError(error)}` };
}

export async function installTypst(options: InstallOptions = {}, report: Reporter = () => undefined): Promise<InstallResult> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const runner = options.runner ?? runProcess;
  const isExecutable = options.isExecutable ?? isExecutableFile;
  const manifest = options.manifest ?? loadManifest();
  const childEnvironment = containedEnvironment(platform, env);

  const key = platformKey(platform, arch);
  if (key === undefined) {
    return {
      ok: false,
      code: 'unsupported-platform',
      message: `No hay binario oficial de Typst para ${platform}-${arch} (plataformas: ${Object.keys(manifest.assets).join(', ')}); instálalo por otra vía e indícalo con --typst-path`,
    };
  }
  const asset = manifest.assets[key];
  const target = cachedBinaryPath(env, platform, home, manifest.version);
  const directory = dirname(target);

  if (options.force !== true && (await isExecutable(target))) {
    const current = await typstVersion(target, runner, childEnvironment);
    if (current.ok && current.version === manifest.version) {
      report(`Typst ${manifest.version} ya está instalado en ${target} (usa --force para reinstalar)`);
      return { ok: true, path: target, version: current.version, alreadyInstalled: true };
    }
  }

  const url = assetUrl(manifest, key);
  report(`Typst ${manifest.version} para ${key}: ${asset.file} (${formatMegabytes(asset.size)}) desde ${url}`);
  report('Descargando… (la única operación de red de cv; la has pedido tú)');

  const suffix = randomBytes(6).toString('hex');
  const archive = join(directory, `.download-${suffix}.tmp`);
  const staging = join(directory, `.extract-${suffix}`);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  } catch (error) {
    return { ok: false, code: 'io', message: `No se pudo crear «${directory}»: ${describeError(error)}` };
  }

  try {
    const downloaded = await downloadToFile(url, archive, { expectedSha256: asset.sha256, fetcher: options.fetcher });
    report(`Descargado: ${formatMegabytes(downloaded.bytes)} · SHA-256 verificado (${downloaded.sha256.slice(0, 16)}…)`);
  } catch (error) {
    return downloadFailure(error);
  }

  try {
    await mkdir(staging, { mode: 0o700 });
    const extracted = await extractArchive(archive, staging, { env, platform, runner, tar: options.tar, isExecutable: options.isExecutable });
    if (!extracted.ok) {
      return { ok: false, code: 'extract-failed', message: extracted.message };
    }
    const binary = await findExtractedBinary(staging, binaryName(platform));
    if (binary === undefined) {
      return { ok: false, code: 'extract-failed', message: `El archivo ${asset.file} no contiene «${binaryName(platform)}»` };
    }
    await chmod(binary, 0o700);
    const version = await typstVersion(binary, runner, childEnvironment);
    if (!version.ok) {
      return { ok: false, code: 'verify-failed', message: `El binario extraído no responde a --version: ${version.message}` };
    }
    if (version.version !== manifest.version) {
      return { ok: false, code: 'verify-failed', message: `El binario extraído es typst ${version.version}, no ${manifest.version}` };
    }
    report(`Extraído y comprobado: typst ${version.version}`);
    await unlink(target).catch(() => undefined);
    await rename(binary, target);
    report(`Instalado en ${target}`);
    return { ok: true, path: target, version: version.version, alreadyInstalled: false };
  } catch (error) {
    return { ok: false, code: 'io', message: `No se pudo instalar el binario: ${describeError(error)}` };
  } finally {
    await removeQuietly(archive);
    await removeQuietly(staging);
  }
}
