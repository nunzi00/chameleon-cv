/**
 * `cv analyze-offer <oferta>`: cliente del caso de uso `analyzeOffer` (`docs/trimming-cli.md` §4.5).
 * Resumen legible por defecto, `--explain` para la auditoría por ítem y `--json` para máquinas. Nunca
 * escribe ficheros.
 */
import type { OfferInput } from '../../app/offer';
import { planAliases, saveAliases } from '../../app/aliases';
import { rankOffers, type RankResult, type RankedOffer } from '../../app/rank';
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
  /** T-9.12: guardar como alias en skills.csv lo que el co-piloto tuvo que tender, para no volver a necesitarlo. */
  readonly saveAliases?: boolean | undefined;
  /** T-9.13: compara varias ofertas en una tabla en vez de analizar una. */
  readonly rank?: boolean | undefined;
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

/** «9/10 (90 %)» o «—» cuando la oferta no declara ni un requisito reconocible. */
function ratioCell(offer: RankedOffer): string {
  return offer.ratio === undefined ? '—' : `${offer.demonstrated}/${offer.recognized} (${Math.round(offer.ratio * 100)} %)`;
}

/**
 * La tabla de comparación (T-9.13): una fila por oferta, ordenadas por imprescindibles cubiertos y después por
 * adecuación. No hay ninguna métrica nueva: son las mismas que ves al analizar una sola.
 */
function printRanking(context: CliContext, result: RankResult, sources: readonly string[]): void {
  const rows = result.ranked.map((offer) => [offer.name, ratioCell(offer), `${offer.requiredDemonstrated}/${offer.requiredTotal}`, offer.suggestedSpecialty ?? '—', offer.gaps.join(', ') || '—']);
  const header = ['Oferta', 'Adecuación', 'Imprescindibles', 'Especialidad', 'Carencias'];
  const widths = header.map((title, column) => rows.reduce((max, row) => Math.max(max, row[column]!.length), title.length));
  const line = (cells: readonly string[]): string => cells.map((cell, column) => (column === cells.length - 1 ? cell : cell.padEnd(widths[column]!))).join('  ');
  context.stdout(`${line(header)}\n`);
  for (const row of rows) {
    context.stdout(`${line(row)}\n`);
  }
  for (const failure of result.failed) {
    // El índice viene de la misma lista que se pasó: siempre hay origen que nombrar.
    context.stderr(`No se pudo analizar ${sources[failure.offer]!}: ${failure.message}\n`);
  }
}

async function runRanking(context: CliContext, sources: readonly string[], options: AnalyzeOfferOptions): Promise<number> {
  if (options.copilot === true) {
    context.stderr('--rank y --copilot no se combinan todavía: el co-piloto se pide oferta a oferta, con su coste y su confirmación. Analiza primero, y refina la que te interese.\n');
    return EXIT_FAILURE;
  }
  // Se guarda la ruta tal como se escribió para poder nombrarla igual en los fallos: `offerInput` la resuelve.
  const offers = sources.map((source) => offerInput(context, source));
  const ranked = await rankOffers(context, { profile: options.profile, data: options.data, specialty: options.specialty, build: options.build }, offers);
  if (!ranked.ok) {
    return reportError(context, ranked.error);
  }
  // Con varias ofertas, un aviso sin decir de cuál es no sirve de nada: se antepone el origen.
  for (const { offer, warning } of ranked.result.warnings) {
    context.stderr(`${sources[offer]!}: `);
    reportWarnings(context, [warning]);
  }
  if (options.json) {
    // En JSON el fallo se nombra como lo escribió quien llama, no por su posición.
    const failed = ranked.result.failed.map((failure) => ({ source: sources[failure.offer]!, message: failure.message }));
    const warnings = ranked.result.warnings.map((entry) => ({ source: sources[entry.offer]!, ...entry.warning }));
    context.stdout(`${JSON.stringify({ ...ranked.result, failed, warnings }, null, 2)}\n`);
    return ranked.result.ranked.length === 0 ? EXIT_FAILURE : EXIT_OK;
  }
  if (ranked.result.ranked.length === 0) {
    context.stderr('Ninguna oferta se pudo analizar.\n');
    return EXIT_FAILURE;
  }
  printRanking(context, ranked.result, sources);
  return EXIT_OK;
}

export async function runAnalyzeOffer(context: CliContext, source: string | undefined, extra: readonly string[], options: AnalyzeOfferOptions): Promise<number> {
  if (source === undefined || options.list) {
    return printOfferList(context, options.list);
  }
  if (options.rank === true) {
    return runRanking(context, [source, ...extra], options);
  }
  if (extra.length > 0) {
    context.stderr('Varias ofertas solo se admiten con --rank, que las compara; sin él, pasa una sola.\n');
    return EXIT_FAILURE;
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
    // Cerrar el bucle (T-9.12): lo que el modelo tuvo que tender puede dejar de necesitarlo. Solo con
    // --save-aliases, solo lo verificado, y solo cuando la etiqueta es de UNA skill; lo demás se explica.
    if (options.saveAliases === true && contributed.mappings.length > 0) {
      // Con terminal, se pregunta UNA A UNA: el modelo propone y eliges tú cuáles entran en tus fuentes. Sin
      // terminal (o con --yes) entran todas las que el código dio por buenas, que es lo que espera un script.
      const chosen: Array<(typeof contributed.mappings)[number]> = [];
      for (const mapping of contributed.mappings) {
        const ask = options.yes || context.confirm === undefined ? undefined : context.confirm;
        if (ask === undefined || (await ask(`¿Guardar «${mapping.evidence}» como alias de tu etiqueta «${mapping.tag}»?`))) {
          chosen.push(mapping);
        }
      }
      if (chosen.length === 0) {
        context.stderr('No se guardó ningún alias.\n');
      } else {
        const plan = planAliases(result.analysis.profile, chosen);
        const saved = await saveAliases(context, options.data, plan);
        if (!saved.ok) {
          return reportError(context, saved.error);
        }
        for (const entry of plan) {
          context.stderr(entry.ok ? `  alias guardado en ${entry.skill}: «${entry.alias}» (${entry.tag})\n` : `  alias no guardado «${entry.alias}»: ${entry.reason}\n`);
        }
        if (saved.result.written.length > 0) {
          context.stderr(`${saved.result.written.length} alias en data/sources/skills.csv: la próxima oferta que lo diga así se reconocerá sin modelo. Recompila con «cv build».\n`);
        }
      }
    }
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
