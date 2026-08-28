/**
 * `cv generate-cv`: `profile.json` → (oferta) → selección → puntuación → recorte → renderer →
 * `output/<cv>.md` (`docs/trimming-cli.md` §4). Regla práctica: `--specialty` elige la versión
 * del CV, `--from-job-offer` la afina y los límites la condensan. Nunca lee las fuentes para
 * generar (solo para avisar si el artefacto está obsoleto) y solo escribe en el destino.
 */
import { dirname, resolve } from 'node:path';

import { readProfileArtifact } from '../../artifact';
import { buildVocabulary, extractJobRequirements } from '../../core/keywords';
import type { MasterProfile } from '../../core/schema';
import { NO_SCORES, applyLimits, scoresFromReport, tailorToOffer, type MatchReport, type ScoreLookup } from '../../core/scoring';
import { selectForSpecialty, type SelectionReport } from '../../core/selection';
import { renderMarkdownCv, renderPdfCv } from '../../renderers';
import { describeError } from '../../shared/errors';
import type { CliContext } from '../context';
import { DEFAULT_OUTPUT_DIR } from '../defaults';
import { formatMatchReport, formatSelectionReport, formatTrimReport } from '../explain';
import type { CvFormat } from '../format';
import { checkArtifactFreshness } from '../freshness';
import { hasLimits, resolveLimits, type LimitOptions } from '../limits';
import { readOfferText } from '../offer';
import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK } from '../output';
import { slugify } from '../slug';

/** El CV contiene datos personales: solo el propietario puede leerlo. */
export const OUTPUT_MODE = 0o600;

export interface GenerateCvOptions extends LimitOptions {
  readonly profile: string;
  readonly data: string;
  readonly specialty?: string | undefined;
  readonly fromJobOffer?: string | undefined;
  readonly output?: string | undefined;
  readonly template?: string | undefined;
  readonly locale?: string | undefined;
  readonly format: CvFormat;
  readonly explain: boolean;
  readonly stdout: boolean;
}

/** `output/cv-<nombre>[-<especialidad>][-<oferta>].<formato>`, relativo al directorio de trabajo. */
export function defaultOutputPath(profile: MasterProfile, specialty: string | undefined, offer?: string, format: CvFormat = 'md'): string {
  const name = slugify(profile.personal.fullName) || 'perfil';
  const specialtySuffix = specialty === undefined ? '' : `-${specialty}`;
  const offerSuffix = offer === undefined ? '' : `-${offer}`;
  return `${DEFAULT_OUTPUT_DIR}/cv-${name}${specialtySuffix}${offerSuffix}.${format}`;
}

/** Incompatibilidades de `--format pdf` (`docs/pdf-integration.md` §3.4); se comprueban antes de leer nada. */
export function formatConflict(options: Pick<GenerateCvOptions, 'format' | 'stdout' | 'template'>): string | undefined {
  if (options.format !== 'pdf') {
    return undefined;
  }
  if (options.stdout) {
    return '«--stdout» solo admite «--format md»: el PDF es binario y se escribe siempre en un fichero (--output)';
  }
  return options.template === undefined ? undefined : '«--template» solo aplica a «--format md»: el PDF no usa plantilla';
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

interface Prepared {
  readonly profile: MasterProfile;
  readonly selection: SelectionReport | undefined;
  readonly match: MatchReport | undefined;
  readonly scoreOf: ScoreLookup;
  readonly offerName: string | undefined;
}

export async function runGenerateCv(context: CliContext, options: GenerateCvOptions): Promise<number> {
  const conflict = formatConflict(options);
  if (conflict !== undefined) {
    context.stderr(`${conflict}\n`);
    return EXIT_FAILURE;
  }
  const artifactPath = resolve(context.cwd, options.profile);
  const artifact = await readProfileArtifact(context.artifactFileSystem, artifactPath);
  if (!artifact.ok) {
    for (const error of artifact.errors) {
      context.stderr(`${error}\n`);
    }
    return EXIT_DATA_ERROR;
  }
  await warnIfStale(context, artifactPath, resolve(context.cwd, options.data));

  let prepared: Prepared = { profile: artifact.profile, selection: undefined, match: undefined, scoreOf: NO_SCORES, offerName: undefined };
  if (options.fromJobOffer !== undefined) {
    const offer = await readOfferText(context, options.fromJobOffer);
    if (!offer.ok) {
      context.stderr(`${offer.message}\n`);
      return offer.exitCode;
    }
    const requirements = extractJobRequirements(offer.offer.text, buildVocabulary(artifact.profile));
    const tailored = tailorToOffer(artifact.profile, requirements, { specialtyId: options.specialty });
    if (!tailored.ok) {
      context.stderr(`${tailored.error.message}\n`);
      return EXIT_DATA_ERROR;
    }
    prepared = {
      profile: tailored.scored.profile,
      selection: tailored.scored.selection.report,
      match: tailored.scored.report,
      scoreOf: scoresFromReport(tailored.scored.report),
      offerName: offer.offer.name,
    };
  } else if (options.specialty !== undefined) {
    const selection = selectForSpecialty(artifact.profile, options.specialty);
    if (!selection.ok) {
      context.stderr(`${selection.error.message}\n`);
      return EXIT_DATA_ERROR;
    }
    prepared = { ...prepared, profile: selection.selection.profile, selection: selection.selection.report };
  }

  const limits = resolveLimits(options);
  const trimmed = applyLimits(prepared.profile, limits, prepared.scoreOf);

  if (options.explain) {
    context.stderr(prepared.selection === undefined ? 'Sin especialidad: se genera el CV completo, sin selección\n' : formatSelectionReport(prepared.selection));
    if (prepared.match !== undefined) {
      context.stderr(formatMatchReport(prepared.match));
    }
    if (hasLimits(limits)) {
      context.stderr(formatTrimReport(trimmed.removed, limits, prepared.profile));
    }
  }

  const outputPath = resolve(context.cwd, options.output ?? defaultOutputPath(trimmed.profile, options.specialty, prepared.offerName, options.format));
  if (options.format === 'pdf') {
    const pdf = await renderPdfCv(trimmed.profile, { locale: options.locale });
    return writeCv(context, outputPath, () => context.artifactFileSystem.writeBinaryFile(outputPath, pdf, OUTPUT_MODE));
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
  const markdown = renderMarkdownCv(trimmed.profile, { locale: options.locale, template });

  if (options.stdout) {
    context.stdout(markdown);
    return EXIT_OK;
  }
  return writeCv(context, outputPath, () => context.artifactFileSystem.writeFile(outputPath, markdown, OUTPUT_MODE));
}

async function writeCv(context: CliContext, outputPath: string, write: () => Promise<void>): Promise<number> {
  try {
    await context.artifactFileSystem.mkdir(dirname(outputPath));
    await write();
  } catch (error) {
    context.stderr(`No se pudo escribir el CV en «${outputPath}»: ${describeError(error)}\n`);
    return EXIT_FAILURE;
  }
  context.stdout(`CV escrito en ${outputPath}\n`);
  return EXIT_OK;
}
