/**
 * `cv suggest tags [texto]` (T-4.6): cliente de los casos de uso del co-piloto. Etiquetas para un texto
 * («-» = stdin) o para los logros del perfil, elegidas SOLO del diccionario cerrado —las tags de las
 * especialidades—. La salida limpia va por stdout, lista para copiarla en la fuente (`#tag1 #tag2`); todo lo
 * demás, por stderr. Nunca escribe en las fuentes (C9); consentimiento visible y de coste como en `improve`
 * (C3, C11); cada etiqueta se verifica en código contra el diccionario (C10).
 */
import { resolve } from 'node:path';

import { InvalidArgumentError } from 'commander';

import { DEFAULT_MAX_ITEMS, describeProvider, executeSuggestTags, planSuggestTags, selectCopilotProvider, suggestTagsEstimate, suggestTagsPayload } from '../../app/copilot';
import { SUGGEST_TAGS_LIMITS, formatTagLine, loadSuggestTagsPrompt } from '../../llm';
import type { TagSuggestionItem } from '../../llm';
import { indexSources } from '../../app/provenance';
import { applyTags, planApplyTags, type TagProposal } from '../../app/tags-apply';
import type { CliContext } from '../context';
import { EXIT_FAILURE, EXIT_OK, pluralize, reportError, reportQuota, reportWarnings } from '../output';
import { parseOnly } from './improve';
import { ensureProviderReady } from './remote';

export interface SuggestTagsOptions {
  /** Texto suelto («-» = stdin); sin él se etiquetan logros del perfil. */
  readonly text?: string | undefined;
  readonly profile: string;
  readonly data: string;
  readonly build: boolean;
  /** Restringe el diccionario a las tags de esa especialidad. */
  readonly specialty?: string | undefined;
  readonly only?: string | undefined;
  readonly untagged: boolean;
  readonly maxTags: number;
  readonly maxItems: number;
  readonly redactCompanies: boolean;
  readonly locale?: string | undefined;
  readonly explain: boolean;
  readonly cache: boolean;
  /** T-9.16: si el proveedor dice cuánto esperar tras un 429, esperar y reintentar. Por defecto, sí. */
  readonly waitQuota?: boolean | undefined;
  /** T-9.15: escribir en las fuentes las etiquetas nuevas que se acepten. */
  readonly apply?: boolean | undefined;
  readonly showPrompt: boolean;
  readonly showPayload: boolean;
  readonly dryRun: boolean;
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  readonly yes: boolean;
}

export const SUGGEST_TAGS_DEFAULTS = { maxTags: SUGGEST_TAGS_LIMITS.maxTags, maxItems: DEFAULT_MAX_ITEMS } as const;

export function parseMaxTags(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > SUGGEST_TAGS_LIMITS.maxTagsCeiling) {
    throw new InvalidArgumentError(`debe ser un entero entre 1 y ${SUGGEST_TAGS_LIMITS.maxTagsCeiling}`);
  }
  return parsed;
}


/**
 * Escribe en las fuentes las etiquetas nuevas que el usuario acepte. Solo los ítems con id (un logro del perfil:
 * un texto suelto no tiene dónde ir) y solo las etiquetas que la viñeta no tuviera ya.
 */
async function applySuggested(context: CliContext, options: SuggestTagsOptions, items: readonly TagSuggestionItem[]): Promise<number> {
  const proposals: TagProposal[] = [];
  for (const item of items) {
    const fresh = item.accepted.filter((tag) => tag.isNew).map((tag) => tag.tag);
    if (item.id === undefined || fresh.length === 0) {
      continue;
    }
    const ask = options.yes || context.confirm === undefined ? undefined : context.confirm;
    if (ask === undefined || (await ask(`¿Añadir ${fresh.map((tag) => `#${tag}`).join(' ')} a «${item.id}»?`))) {
      proposals.push({ id: item.id, tags: fresh });
    }
  }
  if (proposals.length === 0) {
    context.stderr('No se aplicó ninguna etiqueta.\n');
    return EXIT_OK;
  }
  const index = await indexSources(context, resolve(context.cwd, options.data));
  if (!index.ok) {
    context.stderr(`${index.message}\n`);
    return EXIT_FAILURE;
  }
  const plan = planApplyTags(index.index, proposals);
  const written = await applyTags(context, options.data, plan);
  if (!written.ok) {
    return reportError(context, written.error);
  }
  // Lo que no se pudo escribir, viniera del plan o de la propia escritura, se cuenta igual y con su motivo.
  for (const entry of [...plan.flatMap((item) => (item.ok ? [] : [item])), ...written.result.skipped]) {
    context.stderr(`  no se aplicó «${entry.id}»: ${entry.reason}\n`);
  }
  for (const entry of written.result.applied) {
    context.stderr(`  ${entry.id}: ${entry.added.map((tag) => `#${tag}`).join(' ')}\n`);
  }
  if (written.result.written.length > 0) {
    context.stderr(`Escrito en ${written.result.written.map((file) => file.file).join(', ')} (copia .bak al lado) · recompila con «cv build»\n`);
  }
  return EXIT_OK;
}

export async function runSuggestTagsCommand(context: CliContext, options: SuggestTagsOptions): Promise<number> {
  if (options.showPrompt) {
    context.stdout(`${await loadSuggestTagsPrompt(context.assets)}\n`);
    return EXIT_OK;
  }
  const planned = await planSuggestTags(context, {
    profile: options.profile,
    data: options.data,
    build: options.build,
    text: options.text === undefined ? undefined : options.text === '-' ? await context.stdin() : options.text,
    specialty: options.specialty,
    only: parseOnly(options.only),
    untagged: options.untagged,
    maxTags: options.maxTags,
    maxItems: options.maxItems,
    redactCompanies: options.redactCompanies,
    locale: options.locale,
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
  context.stderr(
    `Saldrá${plan.fragments.length === 1 ? '' : 'n'} ${pluralize(plan.fragments.length, 'fragmento seudonimizado', 'fragmentos seudonimizados')} (${plan.words} palabras; sin nombre ni datos de contacto${options.redactCompanies ? ', sin empresas' : ''}; ${plan.scope}) hacia ${describeProvider(provider)}\n`,
  );
  if (options.showPayload) {
    context.stdout(`${JSON.stringify(suggestTagsPayload(plan), null, 2)}\n`);
  }
  if (options.dryRun) {
    context.stderr('Ejecución en seco: no se ha enviado nada\n');
    return EXIT_OK;
  }
  const ready = await ensureProviderReady(context, provider, () => suggestTagsEstimate(context, plan, provider.outputTokensFloor ?? 0), options.yes, false);
  if (ready !== EXIT_OK) {
    return ready;
  }
  const outcome = await executeSuggestTags(context, plan, {
    ...(options.waitQuota === false ? { quotaRetry: { attempts: 0 } } : {}),
    provider,
    cache: options.cache,
    progress: (line) => {
      context.stderr(`${line}\n`);
    },
  });

  // Salida limpia (stdout): una línea por ítem, en la sintaxis de las fuentes; detalles por stderr.
  for (const item of outcome.items) {
    if (item.error !== undefined) {
      continue;
    }
    const line = formatTagLine(item);
    if (line === '') {
      context.stderr(`${item.id ?? 'texto'}: ninguna etiqueta del diccionario encaja\n`);
    } else {
      context.stdout(item.id === undefined ? `${line}\n` : `${item.id}: ${line}\n`);
    }
    if (options.explain) {
      for (const tag of item.accepted) {
        context.stderr(`  #${tag.tag} · evidencia ${tag.evidence} · ${tag.isNew ? 'nueva' : 'ya presente'}${tag.reason === '' ? '' : ` · ${tag.reason}`}\n`);
      }
    }
    for (const rejected of item.rejected) {
      context.stderr(`  ✗ ${rejected.tag}: ${rejected.code}\n`);
    }
  }
  // Cerrar el ciclo (T-9.15): hasta ahora la línea se copiaba y se pegaba a mano. Con --apply se escribe, y con
  // terminal se pregunta logro a logro: propone el modelo, elige la persona (C2, C9).
  if (options.apply === true) {
    const written = await applySuggested(context, options, outcome.items);
    if (written !== EXIT_OK) {
      return written;
    }
  }
  const { stats } = outcome;
  context.stderr(
    `${pluralize(stats.items, 'fragmento', 'fragmentos')} · ${pluralize(stats.suggested, 'etiqueta sugerida', 'etiquetas sugeridas')} (${stats.fresh} nuevas) · ${stats.rejected} rechazadas · ${stats.failed} fallidos · ${stats.fromCache} desde caché\n`,
  );
  reportQuota(context, provider);
  return stats.failed === stats.items ? EXIT_FAILURE : EXIT_OK;
}
