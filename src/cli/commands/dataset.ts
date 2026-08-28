/**
 * Paso común de `build-profile` y `validate`: cargar el dataset y, si hay problemas,
 * imprimirlos todos en stderr con el formato `fichero:línea: mensaje`.
 */
import { resolve } from 'node:path';

import type { MasterProfile } from '../../core/schema';
import { loadDataset } from '../../parsers';
import type { CliContext } from '../context';
import { formatDatasetError, pluralize } from '../output';

export interface LoadedDataset {
  readonly profile: MasterProfile;
  readonly files: readonly string[];
  readonly root: string;
}

/** Devuelve el perfil cargado o `undefined` tras haber reportado los errores. */
export async function loadDatasetOrReport(context: CliContext, data: string): Promise<LoadedDataset | undefined> {
  const root = resolve(context.cwd, data);
  const result = await loadDataset(root, { fileSystem: context.datasetFileSystem, parsers: context.parsers });
  if (result.ok) {
    return { profile: result.profile, files: result.files, root };
  }
  for (const error of result.errors) {
    context.stderr(`${formatDatasetError(error)}\n`);
  }
  context.stderr(`${pluralize(result.errors.length, 'problema', 'problemas')} en ${root}\n`);
  return undefined;
}
