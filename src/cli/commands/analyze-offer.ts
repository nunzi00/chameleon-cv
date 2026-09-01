/**
 * `cv analyze-offer <oferta>`: cliente del caso de uso `analyzeOffer` (`docs/trimming-cli.md` §4.5).
 * Resumen legible por defecto, `--explain` para la auditoría por ítem y `--json` para máquinas. Nunca
 * escribe ficheros.
 */
import type { OfferInput } from '../../app/offer';
import { analysisPayload, analyzeOffer, type OfferCopilotOptions } from '../../app/analyze';
import { selectCopilotProvider } from '../../app/copilot';
import { ensureProviderReady } from './remote';
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
  /** T-9.10: el co-piloto lee también la oferta y propone etiquetas del perfil que el matcher literal no vio. */
  readonly copilot?: boolean | undefined;
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
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
  let copilot: OfferCopilotOptions | undefined;
  if (options.copilot === true) {
    const selected = await selectCopilotProvider(context, { provider: options.provider, model: options.model });
    if (!selected.ok) {
      context.stderr(`${selected.error.message}\n`);
      return selected.error.exitCode;
    }
    const { provider } = selected;
    copilot = {
      provider,
      // El consentimiento se pide con la estimación ya hecha, que es cuando se sabe qué sale y cuánto cuesta.
      consent: async (estimate) => (await ensureProviderReady(context, provider, () => Promise.resolve(estimate), options.yes, false)) === EXIT_OK,
      progress: (line) => context.stderr(`${line}\n`),
    };
  }
  const result = await analyzeOffer(context, { profile: options.profile, data: options.data, specialty: options.specialty, offer, build: options.build, copilot });
  reportWarnings(context, result.warnings);
  if (!result.ok) {
    return reportError(context, result.error);
  }
  const contributed = result.analysis.copilot;
  if (contributed !== undefined) {
    // Se enseña SIEMPRE lo que aportó el modelo, con la frase de la oferta que lo justifica: quien lee el informe
    // tiene que poder juzgarlo sin creerse nada, y saber qué parte de la adecuación descansa en él.
    const { unknownTag, unverifiedEvidence, alreadyKnown, duplicate } = contributed.rejected;
    const descartadas = unknownTag + unverifiedEvidence + alreadyKnown + duplicate;
    context.stderr(
      contributed.mappings.length === 0
        ? `El co-piloto no añadió ninguna etiqueta${descartadas === 0 ? '' : ` (${descartadas} propuesta(s) descartadas por el código)`}\n`
        : `El co-piloto añadió ${contributed.mappings.length} etiqueta(s) que el emparejado literal no vio${descartadas === 0 ? '' : `, y el código descartó ${descartadas}`}:\n${contributed.mappings.map((mapping) => `  ${mapping.tag} (${mapping.emphasis}) ← «${mapping.evidence}»\n`).join('')}`,
    );
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
