/**
 * `cv build-profile`: el compilador del sistema (`docs/arquitectura.md` §2.3). Lee las fuentes,
 * valida y escribe el artefacto canónico. Silencioso si todo va bien; preciso si algo falla.
 */
import { resolve } from 'node:path';

import { writeProfileArtifact } from '../../artifact';
import { describeError } from '../../shared/errors';
import type { CliContext } from '../context';
import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK, pluralize, profileSummary } from '../output';
import { loadDatasetOrReport } from './dataset';

export interface BuildProfileOptions {
  readonly data: string;
  readonly out: string;
  readonly verbose: boolean;
}

export async function runBuildProfile(context: CliContext, options: BuildProfileOptions): Promise<number> {
  const loaded = await loadDatasetOrReport(context, options.data);
  if (loaded === undefined) {
    return EXIT_DATA_ERROR;
  }
  const out = resolve(context.cwd, options.out);
  try {
    await writeProfileArtifact(context.artifactFileSystem, out, loaded.profile);
  } catch (error) {
    context.stderr(`No se pudo escribir el artefacto «${out}»: ${describeError(error)}\n`);
    return EXIT_FAILURE;
  }
  if (options.verbose) {
    context.stdout(`Artefacto escrito en ${out} (${pluralize(loaded.files.length, 'fichero', 'ficheros')}: ${profileSummary(loaded.profile)})\n`);
  }
  return EXIT_OK;
}
