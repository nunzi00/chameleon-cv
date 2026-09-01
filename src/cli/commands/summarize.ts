/**
 * `cv summarize` (T-4.4, `docs/llm-integration.md` §2.2): cliente de los casos de uso del co-piloto. Resumen
 * profesional a partir del perfil ya filtrado (especialidad, oferta, límites), con la misma cadena segura
 * que `improve`: fragmento seudonimizado → proveedor local o caché → validación → verificador C2 → fichero
 * de revisión (`output/revision-summarize-…`). Nunca escribe en las fuentes (canon C9).
 */
import { describeProvider, executeSummarize, planSummarize, selectCopilotProvider, summarizeEstimate, summarizePayload, writeReview } from '../../app/copilot';
import { SUMMARIZE_LIMITS, loadSummarizePrompt } from '../../llm';
import type { CliContext } from '../context';
import { offerInput } from '../offer';
import { EXIT_FAILURE, EXIT_OK, reportError, reportWarnings, reportQuota } from '../output';
import { ensureProviderReady } from './remote';
import type { SelectionOptions } from './selection';

export { defaultSummaryReviewPath } from '../../app/copilot';

export interface SummarizeOptions extends SelectionOptions {
  readonly profile: string;
  readonly data: string;
  readonly build: boolean;
  readonly paragraphs: number;
  readonly proposals: number;
  readonly maxLength: number;
  readonly redactCompanies: boolean;
  /** Admite cifras que no estén en la fuente; se avisan una a una. Por defecto, no. */
  readonly allowNewNumbers?: boolean | undefined;
  readonly locale?: string | undefined;
  readonly output?: string | undefined;
  readonly cache: boolean;
  /** T-9.16: si el proveedor dice cuánto esperar tras un 429, esperar y reintentar. Por defecto, sí. */
  readonly waitQuota?: boolean | undefined;
  readonly showPrompt: boolean;
  readonly showPayload: boolean;
  readonly dryRun: boolean;
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  readonly yes: boolean;
}

export const SUMMARIZE_DEFAULTS = { paragraphs: SUMMARIZE_LIMITS.paragraphs, proposals: SUMMARIZE_LIMITS.proposals, maxLength: SUMMARIZE_LIMITS.maxLength } as const;

export async function runSummarizeCommand(context: CliContext, options: SummarizeOptions): Promise<number> {
  if (options.showPrompt) {
    context.stdout(`${await loadSummarizePrompt(context.assets)}\n`);
    return EXIT_OK;
  }
  const planned = await planSummarize(context, {
    profile: options.profile,
    data: options.data,
    build: options.build,
    specialty: options.specialty,
    offer: options.fromJobOffer === undefined ? undefined : offerInput(context, options.fromJobOffer),
    topN: options.topN,
    maxSkills: options.maxSkills,
    maxProjects: options.maxProjects,
    maxCertifications: options.maxCertifications,
    compact: options.compact,
    paragraphs: options.paragraphs,
    proposals: options.proposals,
    maxLength: options.maxLength,
    redactCompanies: options.redactCompanies,
    locale: options.locale,
    output: options.output,
  });
  reportWarnings(context, planned.warnings);
  if (!planned.ok) {
    return reportError(context, planned.error);
  }
  const { plan } = planned;
  const selected = await selectCopilotProvider(context, { provider: options.provider, model: options.model });
  if (!selected.ok) {
    return reportError(context, selected.error);
  }
  const { provider } = selected;
  const { input } = plan.fragment;
  context.stderr(
    `Saldrá el perfil filtrado seudonimizado (${input.experience.length} experiencias, ${input.projects.length} proyectos, ${input.skills.length} grupos de skills; ${plan.words} palabras; sin nombre ni datos de contacto${options.redactCompanies ? ', sin empresas' : ''}) hacia ${describeProvider(provider)}\n`,
  );
  if (options.showPayload) {
    context.stdout(`${JSON.stringify(summarizePayload(plan), null, 2)}\n`);
  }
  if (options.dryRun) {
    context.stderr('Ejecución en seco: no se ha enviado nada\n');
    return EXIT_OK;
  }
  const ready = await ensureProviderReady(context, provider, () => summarizeEstimate(context, plan, provider.outputTokensFloor ?? 0), options.yes, false);
  if (ready !== EXIT_OK) {
    return ready;
  }
  const outcome = await executeSummarize(context, plan, { provider, cache: options.cache, allowNewNumbers: options.allowNewNumbers === true, ...(options.waitQuota === false ? { quotaRetry: { attempts: 0 } } : {}) });
  for (const note of outcome.notes) {
    context.stderr(`${note}\n`);
  }
  const failure = await writeReview(context, outcome.outputPath, outcome.text);
  if (failure !== undefined) {
    return reportError(context, failure);
  }
  const { item } = outcome;
  if (item.error !== undefined) {
    context.stderr(`${item.error}\n`);
    context.stdout(`Revisión escrita en ${outcome.outputPath} (sin propuestas)\n`);
    return EXIT_FAILURE;
  }
  const { stats } = outcome;
  context.stdout(`Revisión escrita en ${outcome.outputPath}: ${stats.proposals} propuestas · ${stats.accepted} aceptadas · ${stats.rejected} rechazadas (C2)${item.fromCache ? ' · desde caché' : ` · ${item.elapsedMs} ms`}\n`);
  reportQuota(context, provider);
  return EXIT_OK;
}
