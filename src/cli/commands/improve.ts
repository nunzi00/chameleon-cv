/**
 * `cv improve` (T-4.3, `docs/llm-integration.md` §4.1): cliente de los casos de uso del co-piloto. Logros →
 * fragmentos seudonimizados → proveedor local (o caché) → validación → verificador C2 → fichero de revisión.
 * Nunca escribe en las fuentes ni en el artefacto (canon C1); antes de enviar dice qué sale y a dónde (C3);
 * `--dry-run` y `--show-payload` lo muestran sin enviar; `--show-prompt` imprime el prompt (C5).
 */
import { DEFAULT_MAX_ITEMS, describeProvider, executeImprove, improveEstimate, improvePayload, planImprove, selectCopilotProvider, writeReview } from '../../app/copilot';
import { IMPROVE_LIMITS, IMPROVE_PROMPT_VERSION, loadPrompt } from '../../llm';
import type { CliContext } from '../context';
import { offerInput } from '../offer';
import { EXIT_FAILURE, EXIT_OK, pluralize, reportError, reportQuota, reportWarnings } from '../output';
import { ensureProviderReady } from './remote';
import type { SelectionOptions } from './selection';

export { achievementIds, defaultReviewPath } from '../../app/copilot';

export interface ImproveOptions extends SelectionOptions {
  readonly profile: string;
  readonly data: string;
  readonly build: boolean;
  readonly only?: string | undefined;
  readonly proposals: number;
  readonly maxLength: number;
  readonly maxItems: number;
  readonly redactCompanies: boolean;
  readonly locale?: string | undefined;
  readonly output?: string | undefined;
  readonly cache: boolean;
  readonly showPrompt: boolean;
  readonly showPayload: boolean;
  readonly dryRun: boolean;
  /** `--provider`: selección explícita; un remoto es el consentimiento de red de esta orden. */
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  /** `--yes`: acepta por adelantado el aviso de coste de un proveedor remoto. */
  readonly yes: boolean;
}

export const IMPROVE_DEFAULTS = { proposals: IMPROVE_LIMITS.proposals, maxLength: IMPROVE_LIMITS.maxLength, maxItems: DEFAULT_MAX_ITEMS } as const;

/** `--only a,b` → ids únicos y sin espacios; `undefined` si no se pasó. */
export function parseOnly(only: string | undefined): string[] | undefined {
  if (only === undefined) {
    return undefined;
  }
  return [...new Set(only.split(',').map((id) => id.trim()).filter((id) => id !== ''))];
}

export async function runImproveCommand(context: CliContext, options: ImproveOptions): Promise<number> {
  if (options.showPrompt) {
    context.stdout(`${await loadPrompt(IMPROVE_PROMPT_VERSION, context.assets)}\n`);
    return EXIT_OK;
  }
  const planned = await planImprove(context, {
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
    only: parseOnly(options.only),
    proposals: options.proposals,
    maxLength: options.maxLength,
    maxItems: options.maxItems,
    redactCompanies: options.redactCompanies,
    locale: options.locale,
    output: options.output,
  });
  reportWarnings(context, planned.warnings);
  if (!planned.ok) {
    return reportError(context, planned.error);
  }
  const { plan } = planned;

  // Consentimiento visible (C3): qué sale y a dónde, antes de enviar nada.
  const selected = await selectCopilotProvider(context, { provider: options.provider, model: options.model });
  if (!selected.ok) {
    return reportError(context, selected.error);
  }
  const { provider } = selected;
  context.stderr(`Saldrán ${pluralize(plan.fragments.length, 'logro seudonimizado', 'logros seudonimizados')} (${plan.words} palabras; sin nombre ni datos de contacto${options.redactCompanies ? ', sin empresas' : ''}) hacia ${describeProvider(provider)}\n`);
  if (options.showPayload) {
    context.stdout(`${JSON.stringify(improvePayload(plan), null, 2)}\n`);
  }
  if (options.dryRun) {
    context.stderr('Ejecución en seco: no se ha enviado nada\n');
    return EXIT_OK;
  }
  const ready = await ensureProviderReady(context, provider, () => improveEstimate(context, plan), options.yes, true);
  if (ready !== EXIT_OK) {
    return ready;
  }
  const outcome = await executeImprove(context, plan, {
    provider,
    cache: options.cache,
    progress: (line) => {
      context.stderr(`${line}\n`);
    },
  });
  for (const note of outcome.notes) {
    context.stderr(`${note}\n`);
  }
  const failure = await writeReview(context, outcome.outputPath, outcome.text);
  if (failure !== undefined) {
    return reportError(context, failure);
  }
  const { stats } = outcome;
  context.stdout(
    `Revisión escrita en ${outcome.outputPath}: ${pluralize(stats.items, 'logro', 'logros')} · ${pluralize(stats.proposals, 'propuesta', 'propuestas')} · ${stats.accepted} aceptadas · ${stats.rejected} rechazadas (C2) · ${stats.failed} fallidos · ${stats.fromCache} desde caché\n`,
  );
  reportQuota(context, provider);
  return stats.failed === stats.items ? EXIT_FAILURE : EXIT_OK;
}

export async function runLlmCacheClear(context: CliContext): Promise<number> {
  const removed = await context.llmCache.clear();
  context.stdout(`Caché de respuestas vaciada: ${pluralize(removed, 'entrada', 'entradas')}\n`);
  return EXIT_OK;
}
