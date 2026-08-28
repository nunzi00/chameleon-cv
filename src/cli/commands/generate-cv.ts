/**
 * `cv generate-cv`: la culminación del MVP. `profile.json` → `SelectorEngine` → `MarkdownRenderer`
 * → `output/<cv>.md`. Nunca lee las fuentes para generar (solo para avisar si el artefacto está
 * obsoleto) y solo escribe dentro del destino indicado.
 */
import { dirname, resolve } from 'node:path';

import { readProfileArtifact } from '../../artifact';
import type { MasterProfile } from '../../core/schema';
import { selectForSpecialty, type SelectionReport } from '../../core/selection';
import { renderMarkdownCv } from '../../renderers';
import { describeError } from '../../shared/errors';
import type { CliContext } from '../context';
import { DEFAULT_OUTPUT_DIR } from '../defaults';
import { formatSelectionReport } from '../explain';
import { checkArtifactFreshness } from '../freshness';
import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK } from '../output';
import { slugify } from '../slug';

/** El CV contiene datos personales: solo el propietario puede leerlo. */
export const OUTPUT_MODE = 0o600;

export interface GenerateCvOptions {
  readonly profile: string;
  readonly data: string;
  readonly specialty?: string | undefined;
  readonly output?: string | undefined;
  readonly template?: string | undefined;
  readonly locale?: string | undefined;
  readonly explain: boolean;
  readonly stdout: boolean;
}

/** `output/cv-<nombre>[-<especialidad>].md`, relativo al directorio de trabajo. */
export function defaultOutputPath(profile: MasterProfile, specialty: string | undefined): string {
  const name = slugify(profile.personal.fullName) || 'perfil';
  const suffix = specialty === undefined ? '' : `-${specialty}`;
  return `${DEFAULT_OUTPUT_DIR}/cv-${name}${suffix}.md`;
}

function warnIfStale(context: CliContext, artifactPath: string, sourcesRoot: string): Promise<void> {
  return checkArtifactFreshness(context.datasetFileSystem, artifactPath, sourcesRoot).then((freshness) => {
    if (freshness.status === 'stale') {
      context.stderr(`Aviso: ${freshness.newestSource} es más reciente que el artefacto; ejecuta «cv build-profile» para regenerarlo\n`);
    } else if (freshness.status === 'unknown') {
      context.stderr(`Aviso: no se pudo comprobar si el artefacto está al día (${freshness.reason})\n`);
    }
  });
}

export async function runGenerateCv(context: CliContext, options: GenerateCvOptions): Promise<number> {
  const artifactPath = resolve(context.cwd, options.profile);
  const artifact = await readProfileArtifact(context.artifactFileSystem, artifactPath);
  if (!artifact.ok) {
    for (const error of artifact.errors) {
      context.stderr(`${error}\n`);
    }
    return EXIT_DATA_ERROR;
  }
  await warnIfStale(context, artifactPath, resolve(context.cwd, options.data));

  let profile = artifact.profile;
  let report: SelectionReport | undefined;
  if (options.specialty !== undefined) {
    const selection = selectForSpecialty(profile, options.specialty);
    if (!selection.ok) {
      context.stderr(`${selection.error.message}\n`);
      return EXIT_DATA_ERROR;
    }
    profile = selection.selection.profile;
    report = selection.selection.report;
  }
  if (options.explain) {
    context.stderr(report === undefined ? 'Sin especialidad: se genera el CV completo, sin selección\n' : formatSelectionReport(report));
  }

  let template: string | undefined;
  if (options.template !== undefined) {
    const templatePath = resolve(context.cwd, options.template);
    try {
      template = await context.datasetFileSystem.readTextFile(templatePath);
    } catch (error) {
      context.stderr(`No se pudo leer la plantilla «${templatePath}»: ${describeError(error)}\n`);
      return EXIT_FAILURE;
    }
  }
  const markdown = renderMarkdownCv(profile, { locale: options.locale, template });

  if (options.stdout) {
    context.stdout(markdown);
    return EXIT_OK;
  }
  const outputPath = resolve(context.cwd, options.output ?? defaultOutputPath(profile, options.specialty));
  try {
    await context.artifactFileSystem.mkdir(dirname(outputPath));
    await context.artifactFileSystem.writeFile(outputPath, markdown, OUTPUT_MODE);
  } catch (error) {
    context.stderr(`No se pudo escribir el CV en «${outputPath}»: ${describeError(error)}\n`);
    return EXIT_FAILURE;
  }
  context.stdout(`CV escrito en ${outputPath}\n`);
  return EXIT_OK;
}
