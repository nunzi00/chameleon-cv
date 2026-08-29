/**
 * Fuentes y artefacto (docs/api-headless.md §3): cargar y validar el dataset, compilar el artefacto
 * canónico (la puerta de calidad del perfil, el «tsc» de las fuentes) y leerlo re-validado.
 */
import { resolve } from 'node:path';

import { isMissingFile, readProfileArtifact, serializeProfile, writeProfileArtifact } from '../artifact';
import type { MasterProfile } from '../core/schema';
import { loadDataset, type DatasetError, type Provenance } from '../parsers';
import { describeError } from '../shared/errors';
import type { AppContext } from './context';
import { conflictError, dataError, environmentError, type AppError } from './errors';
import { formatDatasetError, pluralize } from './text';

export interface LoadedDataset {
  readonly profile: MasterProfile;
  readonly files: readonly string[];
  readonly root: string;
  readonly provenance: readonly Provenance[];
}

export type DatasetLoadResult =
  | { readonly ok: true; readonly dataset: LoadedDataset }
  | { readonly ok: false; readonly error: AppError; readonly issues: readonly DatasetError[] };

/** Carga y valida las fuentes; con problemas, todos a la vez (`fichero:línea: mensaje` y el recuento). */
export async function loadSources(context: AppContext, options: { readonly data: string }): Promise<DatasetLoadResult> {
  const root = resolve(context.cwd, options.data);
  const result = await loadDataset(root, { fileSystem: context.datasetFileSystem, parsers: context.parsers });
  if (result.ok) {
    return { ok: true, dataset: { profile: result.profile, files: result.files, root, provenance: result.provenance } };
  }
  const lines = [...result.errors.map(formatDatasetError), `${pluralize(result.errors.length, 'problema', 'problemas')} en ${root}`];
  return { ok: false, error: dataError(`${pluralize(result.errors.length, 'problema', 'problemas')} en ${root}`, lines), issues: result.errors };
}

export type ArtifactStatus = { readonly status: 'current' | 'missing' | 'outdated' } | { readonly status: 'unreadable'; readonly reason: string };

/** Compara el artefacto en disco con la serialización del perfil recién compilado. */
export async function artifactStatus(context: Pick<AppContext, 'artifactFileSystem'>, path: string, expected: string): Promise<ArtifactStatus> {
  let content: string;
  try {
    content = await context.artifactFileSystem.readFile(path);
  } catch (error) {
    return isMissingFile(error) ? { status: 'missing' } : { status: 'unreadable', reason: describeError(error) };
  }
  return { status: content === expected ? 'current' : 'outdated' };
}

export interface BuildOptions {
  readonly data: string;
  readonly out: string;
  /** No escribe: falla si las fuentes tienen problemas o si el artefacto falta o no está al día. */
  readonly check: boolean;
}

export type BuildResult =
  | { readonly ok: true; readonly artifactPath: string; readonly dataset: LoadedDataset; readonly written: boolean }
  | { readonly ok: false; readonly error: AppError; readonly issues: readonly DatasetError[] };

export async function buildProfile(context: AppContext, options: BuildOptions): Promise<BuildResult> {
  const loaded = await loadSources(context, options);
  if (!loaded.ok) {
    return loaded;
  }
  const out = resolve(context.cwd, options.out);
  if (options.check) {
    const artifact = await artifactStatus(context, out, serializeProfile(loaded.dataset.profile));
    switch (artifact.status) {
      case 'missing':
        return { ok: false, error: conflictError(`Falta el artefacto «${out}»: ejecuta «cv build»`), issues: [] };
      case 'outdated':
        return { ok: false, error: conflictError(`El artefacto «${out}» no está al día con las fuentes: ejecuta «cv build»`), issues: [] };
      case 'unreadable':
        return { ok: false, error: environmentError(`No se pudo leer el artefacto «${out}»: ${artifact.reason}`), issues: [] };
      case 'current':
        return { ok: true, artifactPath: out, dataset: loaded.dataset, written: false };
    }
  }
  try {
    await writeProfileArtifact(context.artifactFileSystem, out, loaded.dataset.profile);
  } catch (error) {
    return { ok: false, error: environmentError(`No se pudo escribir el artefacto «${out}»: ${describeError(error)}`), issues: [] };
  }
  return { ok: true, artifactPath: out, dataset: loaded.dataset, written: true };
}

export type ProfileLoadResult =
  | { readonly ok: true; readonly profile: MasterProfile; readonly artifactPath: string }
  | { readonly ok: false; readonly error: AppError };

/** Lee el artefacto re-validándolo: no se confía en un fichero de disco aunque lo hayamos escrito nosotros. */
export async function loadProfile(context: AppContext, options: { readonly profile: string }): Promise<ProfileLoadResult> {
  const artifactPath = resolve(context.cwd, options.profile);
  const artifact = await readProfileArtifact(context.artifactFileSystem, artifactPath);
  if (!artifact.ok) {
    return { ok: false, error: dataError(artifact.errors.join('\n'), artifact.errors) };
  }
  return { ok: true, profile: artifact.profile, artifactPath };
}
