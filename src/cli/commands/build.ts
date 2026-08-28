/**
 * `cv build` (T-2.7, `docs/consolidacion.md` §2): el compilador y la puerta de calidad del
 * perfil, el «tsc» de las fuentes. Lee, valida (estricto) y escribe el artefacto canónico;
 * con `--check` no escribe: comprueba que las fuentes son válidas y que el artefacto existe y
 * está al día (comparación semántica del contenido, nunca por fechas). Silencioso si todo va
 * bien; preciso si algo falla. `build-profile` es un alias.
 */
import { resolve } from 'node:path';

import { isMissingFile, serializeProfile, writeProfileArtifact } from '../../artifact';
import { describeError } from '../../shared/errors';
import type { CliContext } from '../context';
import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK, pluralize, profileSummary } from '../output';
import { loadDatasetOrReport } from './dataset';

export interface BuildOptions {
  readonly data: string;
  readonly out: string;
  readonly check: boolean;
  readonly verbose: boolean;
}

export type ArtifactStatus = { readonly status: 'current' | 'missing' | 'outdated' } | { readonly status: 'unreadable'; readonly reason: string };

/** Compara el artefacto en disco con la serialización del perfil recién compilado. */
export async function artifactStatus(context: CliContext, path: string, expected: string): Promise<ArtifactStatus> {
  let content: string;
  try {
    content = await context.artifactFileSystem.readFile(path);
  } catch (error) {
    return isMissingFile(error) ? { status: 'missing' } : { status: 'unreadable', reason: describeError(error) };
  }
  return { status: content === expected ? 'current' : 'outdated' };
}

export async function runBuild(context: CliContext, options: BuildOptions): Promise<number> {
  const loaded = await loadDatasetOrReport(context, options.data);
  if (loaded === undefined) {
    return EXIT_DATA_ERROR;
  }
  const out = resolve(context.cwd, options.out);
  const summary = `${pluralize(loaded.files.length, 'fichero', 'ficheros')}: ${profileSummary(loaded.profile)}`;

  if (options.check) {
    const artifact = await artifactStatus(context, out, serializeProfile(loaded.profile));
    switch (artifact.status) {
      case 'missing':
        context.stderr(`Falta el artefacto «${out}»: ejecuta «cv build»\n`);
        return EXIT_DATA_ERROR;
      case 'outdated':
        context.stderr(`El artefacto «${out}» no está al día con las fuentes: ejecuta «cv build»\n`);
        return EXIT_DATA_ERROR;
      case 'unreadable':
        context.stderr(`No se pudo leer el artefacto «${out}»: ${artifact.reason}\n`);
        return EXIT_FAILURE;
      case 'current':
        if (options.verbose) {
          context.stdout(`Artefacto al día: ${out} (${summary})\n`);
        }
        return EXIT_OK;
    }
  }

  try {
    await writeProfileArtifact(context.artifactFileSystem, out, loaded.profile);
  } catch (error) {
    context.stderr(`No se pudo escribir el artefacto «${out}»: ${describeError(error)}\n`);
    return EXIT_FAILURE;
  }
  if (options.verbose) {
    context.stdout(`Artefacto escrito en ${out} (${summary})\n`);
  }
  return EXIT_OK;
}

/** `--build` de `generate-cv` y `analyze-offer`: recompila el artefacto antes de leerlo. */
export function buildBeforeUse(context: CliContext, options: { readonly data: string; readonly profile: string }): Promise<number> {
  return runBuild(context, { data: options.data, out: options.profile, check: false, verbose: false });
}
