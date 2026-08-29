/**
 * `cv validate`: comprueba las fuentes sin escribir nada.
 */
import { loadSources } from '../../app/dataset';
import type { CliContext } from '../context';
import { EXIT_OK, pluralize, profileSummary, reportError } from '../output';

export interface ValidateOptions {
  readonly data: string;
}

export async function runValidate(context: CliContext, options: ValidateOptions): Promise<number> {
  const result = await loadSources(context, options);
  if (!result.ok) {
    return reportError(context, result.error);
  }
  const { dataset } = result;
  context.stdout(`Dataset válido: ${pluralize(dataset.files.length, 'fichero', 'ficheros')} en ${dataset.root} (${profileSummary(dataset.profile)})\n`);
  return EXIT_OK;
}
