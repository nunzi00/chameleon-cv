/**
 * `cv analyze-offer <oferta>`: cliente del caso de uso `analyzeOffer` (`docs/trimming-cli.md` §4.5).
 * Resumen legible por defecto, `--explain` para la auditoría por ítem y `--json` para máquinas. Nunca
 * escribe ficheros.
 */
import type { OfferInput } from '../../app/offer';
import { analysisPayload, analyzeOffer } from '../../app/analyze';
import { describeHistory } from '../../app/history';
import type { CliContext } from '../context';
import { formatMatchReport, formatMatchSummary, formatSelectionReport } from '../explain';
import { isUrlSource, listOffers, offerInput, resolveOfferSource } from '../offer';
import { EXIT_FAILURE, EXIT_OK, reportError, reportWarnings } from '../output';

export interface AnalyzeOfferOptions {
  readonly profile: string;
  readonly data: string;
  readonly specialty?: string | undefined;
  readonly explain: boolean;
  readonly json: boolean;
  readonly build: boolean;
  /** T-8.5: URL como origen (§4.3). */
  readonly allowRemote: boolean;
  readonly yes: boolean;
  readonly saveOffer?: string | boolean | undefined;
  readonly replace: boolean;
  readonly list: boolean;
}

/** Sin origen: la lista de `offers/**` para elegir (con `--list`, código 0; sin él, 2 porque falta el argumento). */
async function printOfferList(context: CliContext, explicit: boolean): Promise<number> {
  const offers = await listOffers(context);
  if (offers.length === 0) {
    context.stderr('No hay ofertas en offers/ (guarda una con --save-offer, o pasa un fichero, «-» o una URL https)\n');
    return explicit ? EXIT_OK : EXIT_FAILURE;
  }
  const width = offers.reduce((max, offer) => Math.max(max, offer.path.length), 0);
  for (const offer of offers) {
    context.stdout(`${offer.path.padEnd(width)}  ${String(offer.bytes).padStart(8)} B  ${offer.modifiedAt}\n`);
  }
  context.stderr(`${offers.length === 1 ? '1 oferta' : `${offers.length} ofertas`} en offers/; analiza una con «cv analyze-offer <ruta>»\n`);
  return explicit ? EXIT_OK : EXIT_FAILURE;
}

export async function runAnalyzeOffer(context: CliContext, source: string | undefined, options: AnalyzeOfferOptions): Promise<number> {
  if (source === undefined || options.list) {
    return printOfferList(context, options.list);
  }
  let offer: OfferInput;
  if (isUrlSource(source)) {
    const resolved = await resolveOfferSource(context, source, options);
    if (!resolved.ok) {
      context.stderr(`${resolved.message}\n`);
      return resolved.exit;
    }
    offer = resolved.input;
  } else {
    offer = offerInput(context, source);
  }
  const result = await analyzeOffer(context, { profile: options.profile, data: options.data, specialty: options.specialty, offer, build: options.build });
  reportWarnings(context, result.warnings);
  if (!result.ok) {
    return reportError(context, result.error);
  }
  const { analysis, history } = result;
  if (options.json) {
    context.stdout(`${JSON.stringify(analysisPayload(analysis, history), null, 2)}\n`);
    return EXIT_OK;
  }
  context.stdout(describeHistory(history));
  context.stdout(formatMatchSummary(analysis.summary, analysis.offerName, analysis.suggestedSpecialty));
  if (options.explain) {
    context.stdout(`\n${formatSelectionReport(analysis.scored.selection.report)}${formatMatchReport(analysis.scored.report)}`);
  }
  return EXIT_OK;
}
