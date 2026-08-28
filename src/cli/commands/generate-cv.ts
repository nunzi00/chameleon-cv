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
import { renderMarkdownCv, renderPdfCv, type TypstRenderErrorCode } from '../../renderers';
import { describeError } from '../../shared/errors';
import { DEFAULT_THEME, applyThemeOverrides, loadProjectConfig, loadTheme, overriddenKeys, themeRoots } from '../../themes';
import type { CliContext } from '../context';
import { DEFAULT_OUTPUT_DIR } from '../defaults';
import { formatMatchReport, formatSelectionReport, formatTrimReport } from '../explain';
import type { CvEngine, CvFormat } from '../format';
import { warnIfStale } from '../freshness';
import { hasLimits, resolveLimits, type LimitOptions } from '../limits';
import { readOfferText } from '../offer';
import { buildBeforeUse } from './build';
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
  /** Motor de `--format pdf` (T-3.2). */
  readonly engine: CvEngine;
  readonly typstPath?: string | undefined;
  readonly typstAnyVersion: boolean;
  /** `--theme`: tema de diseño de Typst (T-5.1); por defecto `default`. */
  readonly theme?: string | undefined;
  readonly explain: boolean;
  readonly stdout: boolean;
  readonly build: boolean;
}

/** `output/cv-<nombre>[-<especialidad>][-<oferta>].<formato>`, relativo al directorio de trabajo. */
export function defaultOutputPath(profile: MasterProfile, specialty: string | undefined, offer?: string, format: CvFormat = 'md'): string {
  const name = slugify(profile.personal.fullName) || 'perfil';
  const specialtySuffix = specialty === undefined ? '' : `-${specialty}`;
  const offerSuffix = offer === undefined ? '' : `-${offer}`;
  return `${DEFAULT_OUTPUT_DIR}/cv-${name}${specialtySuffix}${offerSuffix}.${format}`;
}

type ConflictOptions = Pick<GenerateCvOptions, 'format' | 'stdout' | 'template' | 'engine' | 'typstPath' | 'typstAnyVersion' | 'theme'>;

/** Incompatibilidades de `--format pdf` y `--engine` (`docs/pdf-integration.md` §3.4, `docs/typst-integration.md` §6.2); se comprueban antes de leer nada. */
export function formatConflict(options: ConflictOptions): string | undefined {
  if (options.engine !== 'typst' && (options.typstPath !== undefined || options.typstAnyVersion)) {
    return '«--typst-path» y «--typst-any-version» solo aplican a «--engine typst»';
  }
  if (options.engine !== 'typst' && options.theme !== undefined) {
    return '«--theme» solo aplica a «--engine typst» (con --format pdf)';
  }
  if (options.format !== 'pdf') {
    return options.engine === 'typst' ? '«--engine» solo aplica a «--format pdf»' : undefined;
  }
  if (options.stdout) {
    return '«--stdout» solo admite «--format md»: el PDF es binario y se escribe siempre en un fichero (--output)';
  }
  if (options.engine === 'pdfkit' && options.template !== undefined) {
    return '«--template» solo aplica a «--format md» o a «--engine typst»: pdfkit no usa plantilla';
  }
  return undefined;
}

/** La plantilla Typst que no compila es un problema de datos (1); binario ausente, versión, tiempo o proceso, del entorno (2). */
export function typstExitCode(code: TypstRenderErrorCode): number {
  return code === 'compile-error' || code === 'theme-invalid' ? EXIT_DATA_ERROR : EXIT_FAILURE;
}

/** PDF con el motor elegido; un número es un código de salida ya explicado en stderr. */
function renderPdf(context: CliContext, profile: MasterProfile, options: GenerateCvOptions): Promise<Buffer | number> {
  return options.engine === 'typst' ? renderWithTypst(context, profile, options) : renderPdfCv(profile, { locale: options.locale });
}

async function renderWithTypst(context: CliContext, profile: MasterProfile, options: GenerateCvOptions): Promise<Buffer | number> {
  // Tema (T-5.1) y anulaciones de cv.toml (T-5.2): --theme > cv.toml [theme].name > default; theme.toml + [theme] de cv.toml, revalidado.
  const project = await loadProjectConfig(context.cwd, context.datasetFileSystem);
  if (!project.ok) {
    context.stderr(`${project.message}\n`);
    return EXIT_DATA_ERROR;
  }
  const overrides = project.config?.theme;
  const loaded = await loadTheme(options.theme ?? overrides?.name ?? DEFAULT_THEME, themeRoots(context.cwd, context.datasetFileSystem));
  if (!loaded.ok) {
    context.stderr(`${loaded.message}\n`);
    return EXIT_DATA_ERROR;
  }
  const theme = applyThemeOverrides(loaded.theme, overrides);
  if (options.explain) {
    const keys = overriddenKeys(overrides);
    context.stderr(`Tema: ${theme.name} (${theme.builtin ? 'distribuido' : 'del proyecto'})${keys.length === 0 ? '' : `; cv.toml anula ${keys.join(', ')}`}\n`);
  }
  const result = await context.typstRenderer(profile, {
    locale: options.locale,
    template: options.template === undefined ? undefined : resolve(context.cwd, options.template),
    explicitPath: options.typstPath === undefined ? undefined : resolve(context.cwd, options.typstPath),
    allowAnyVersion: options.typstAnyVersion,
    theme,
  });
  if (result.ok) {
    return result.pdf;
  }
  context.stderr(result.error.code === 'compile-error' ? `La plantilla Typst no compiló:\n${result.error.message}\n` : `${result.error.message}\n`);
  return typstExitCode(result.error.code);
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
  if (options.build) {
    const built = await buildBeforeUse(context, options);
    if (built !== EXIT_OK) {
      return built;
    }
  }
  const artifact = await readProfileArtifact(context.artifactFileSystem, artifactPath);
  if (!artifact.ok) {
    for (const error of artifact.errors) {
      context.stderr(`${error}\n`);
    }
    return EXIT_DATA_ERROR;
  }
  if (!options.build) {
    await warnIfStale(context, artifactPath, resolve(context.cwd, options.data));
  }

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
    const pdf = await renderPdf(context, trimmed.profile, options);
    if (typeof pdf === 'number') {
      return pdf;
    }
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
