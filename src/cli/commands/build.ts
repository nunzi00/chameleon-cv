/**
 * `cv build` (T-2.7, `docs/consolidacion.md` §2): el compilador y la puerta de calidad del perfil, el
 * «tsc» de las fuentes. Lee, valida (estricto) y escribe el artefacto canónico; con `--check` no
 * escribe: comprueba que las fuentes son válidas y que el artefacto existe y está al día (comparación
 * semántica del contenido, nunca por fechas). Silencioso si todo va bien; preciso si algo falla.
 * `build-profile` es un alias.
 */
import { buildProfile } from '../../app/dataset';
import type { CliContext } from '../context';
import { EXIT_OK, pluralize, profileSummary, reportError } from '../output';

export { artifactStatus, type ArtifactStatus } from '../../app/dataset';

export interface BuildOptions {
  readonly data: string;
  readonly out: string;
  readonly check: boolean;
  readonly verbose: boolean;
}

export async function runBuild(context: CliContext, options: BuildOptions): Promise<number> {
  const result = await buildProfile(context, options);
  if (!result.ok) {
    return reportError(context, result.error);
  }
  if (options.verbose) {
    const summary = `${pluralize(result.dataset.files.length, 'fichero', 'ficheros')}: ${profileSummary(result.dataset.profile)}`;
    context.stdout(result.written ? `Artefacto escrito en ${result.artifactPath} (${summary})\n` : `Artefacto al día: ${result.artifactPath} (${summary})\n`);
  }
  return EXIT_OK;
}

/** `--build` de `generate-cv` y `analyze-offer`: recompila el artefacto antes de leerlo. */
export function buildBeforeUse(context: CliContext, options: { readonly data: string; readonly profile: string }): Promise<number> {
  return runBuild(context, { data: options.data, out: options.profile, check: false, verbose: false });
}
