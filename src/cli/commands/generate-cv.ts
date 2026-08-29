/**
 * `cv generate-cv`: cliente del caso de uso `generateCv` (`src/app/generate.ts`). Regla práctica:
 * `--specialty` elige la versión del CV, `--from-job-offer` la afina y los límites la condensan. La
 * CLI comprueba las incompatibilidades de sus opciones, formatea los informes de `--explain` y decide
 * entre escribir el fichero o imprimir por stdout.
 */
import { generateCv, writeCvFile, type GenerateReport } from '../../app/generate';
import type { CliContext } from '../context';
import { formatMatchReport, formatSelectionReport, formatTrimReport } from '../explain';
import type { CvEngine, CvFormat } from '../format';
import { hasLimits, type LimitOptions } from '../limits';
import { offerInput } from '../offer';
import { EXIT_FAILURE, EXIT_OK, reportError, reportWarnings } from '../output';

export { OUTPUT_MODE, defaultOutputPath, typstExitCode } from '../../app/generate';

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

/** Los informes de `--explain`, en el orden en que se decidieron: selección, oferta, recortes y tema. */
function explain(context: CliContext, report: GenerateReport): void {
  context.stderr(report.selection === undefined ? 'Sin especialidad: se genera el CV completo, sin selección\n' : formatSelectionReport(report.selection));
  if (report.match !== undefined) {
    context.stderr(formatMatchReport(report.match));
  }
  if (hasLimits(report.limits)) {
    context.stderr(formatTrimReport(report.removed, report.limits, report.profileBeforeTrim));
  }
  if (report.theme !== undefined) {
    context.stderr(`Tema: ${report.theme.name} (${report.theme.builtin ? 'distribuido' : 'del proyecto'})${report.theme.overridden.length === 0 ? '' : `; cv.toml anula ${report.theme.overridden.join(', ')}`}\n`);
  }
}

export async function runGenerateCv(context: CliContext, options: GenerateCvOptions): Promise<number> {
  const conflict = formatConflict(options);
  if (conflict !== undefined) {
    context.stderr(`${conflict}\n`);
    return EXIT_FAILURE;
  }
  const result = await generateCv(context, {
    profile: options.profile,
    data: options.data,
    specialty: options.specialty,
    offer: options.fromJobOffer === undefined ? undefined : offerInput(context, options.fromJobOffer),
    output: options.output,
    templatePath: options.template,
    locale: options.locale,
    format: options.format,
    engine: options.engine,
    typstPath: options.typstPath,
    typstAnyVersion: options.typstAnyVersion,
    theme: options.theme,
    build: options.build,
    topN: options.topN,
    maxSkills: options.maxSkills,
    maxProjects: options.maxProjects,
    maxCertifications: options.maxCertifications,
    compact: options.compact,
  });
  reportWarnings(context, result.warnings);
  if (options.explain && result.report !== undefined) {
    explain(context, result.report);
  }
  if (!result.ok) {
    return reportError(context, result.error);
  }
  if (result.cv.kind === 'md' && options.stdout) {
    context.stdout(result.cv.markdown);
    return EXIT_OK;
  }
  const failure = await writeCvFile(context, result.cv);
  if (failure !== undefined) {
    return reportError(context, failure);
  }
  context.stdout(`CV escrito en ${result.cv.outputPath}\n`);
  return EXIT_OK;
}
