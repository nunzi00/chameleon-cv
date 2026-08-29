/**
 * `cv analyze-offer <oferta>`: cliente del caso de uso `analyzeOffer` (`docs/trimming-cli.md` §4.5).
 * Resumen legible por defecto, `--explain` para la auditoría por ítem y `--json` para máquinas. Nunca
 * escribe ficheros.
 */
import { analysisPayload, analyzeOffer } from '../../app/analyze';
import type { CliContext } from '../context';
import { formatMatchReport, formatMatchSummary, formatSelectionReport } from '../explain';
import { offerInput } from '../offer';
import { EXIT_OK, reportError, reportWarnings } from '../output';

export interface AnalyzeOfferOptions {
  readonly profile: string;
  readonly data: string;
  readonly specialty?: string | undefined;
  readonly explain: boolean;
  readonly json: boolean;
  readonly build: boolean;
}

export async function runAnalyzeOffer(context: CliContext, source: string, options: AnalyzeOfferOptions): Promise<number> {
  const result = await analyzeOffer(context, { profile: options.profile, data: options.data, specialty: options.specialty, offer: offerInput(context, source), build: options.build });
  reportWarnings(context, result.warnings);
  if (!result.ok) {
    return reportError(context, result.error);
  }
  const { analysis } = result;
  if (options.json) {
    context.stdout(`${JSON.stringify(analysisPayload(analysis), null, 2)}\n`);
    return EXIT_OK;
  }
  context.stdout(formatMatchSummary(analysis.summary, analysis.offerName));
  if (options.explain) {
    context.stdout(`\n${formatSelectionReport(analysis.scored.selection.report)}${formatMatchReport(analysis.scored.report)}`);
  }
  return EXIT_OK;
}
