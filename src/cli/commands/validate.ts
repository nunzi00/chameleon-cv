/**
 * `cv validate`: comprueba las fuentes sin escribir nada.
 */
import type { CliContext } from '../context';
import { EXIT_DATA_ERROR, EXIT_OK, pluralize, profileSummary } from '../output';
import { loadDatasetOrReport } from './dataset';

export interface ValidateOptions {
  readonly data: string;
}

export async function runValidate(context: CliContext, options: ValidateOptions): Promise<number> {
  const loaded = await loadDatasetOrReport(context, options.data);
  if (loaded === undefined) {
    return EXIT_DATA_ERROR;
  }
  context.stdout(`Dataset válido: ${pluralize(loaded.files.length, 'fichero', 'ficheros')} en ${loaded.root} (${profileSummary(loaded.profile)})\n`);
  return EXIT_OK;
}
