/**
 * `cv suggest tags [texto]` (T-4.6): etiquetas para un texto («-» = stdin) o para los logros del
 * perfil, elegidas SOLO del diccionario cerrado —las tags de las especialidades—. La salida
 * limpia va por stdout, lista para copiarla en la fuente (`#tag1 #tag2`); todo lo demás, por
 * stderr. Nunca escribe en las fuentes (C9); consentimiento visible y de coste como en
 * `improve` (C3, C11); cada etiqueta se verifica en código contra el diccionario (C10).
 */
import { resolve } from 'node:path';

import { InvalidArgumentError } from 'commander';

import { readProfileArtifact } from '../../artifact';
import { closedDictionary, normalizeTag } from '../../core/llm/tags';
import type { MasterProfile } from '../../core/schema';
import { SUGGEST_TAGS_LIMITS, buildSuggestTagsFragment, estimateBatch, formatTagLine, loadSuggestTagsPrompt, locateAchievement, runSuggestTagsBatch, suggestTagsMessages, tagStats, type SuggestTagsFragmentOptions, type TagTarget } from '../../llm';
import { splitTrailingHashtags } from '../../parsers';
import type { CliContext } from '../context';
import { warnIfStale } from '../freshness';
import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK, pluralize } from '../output';
import { buildBeforeUse } from './build';
import { achievementIds, parseOnly } from './improve';
import { consentToRemote } from './remote';

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
  readonly showPrompt: boolean;
  readonly showPayload: boolean;
  readonly dryRun: boolean;
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  readonly yes: boolean;
}

export const SUGGEST_TAGS_DEFAULTS = { maxTags: SUGGEST_TAGS_LIMITS.maxTags, maxItems: 20 } as const;

export function parseMaxTags(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > SUGGEST_TAGS_LIMITS.maxTagsCeiling) {
    throw new InvalidArgumentError(`debe ser un entero entre 1 y ${SUGGEST_TAGS_LIMITS.maxTagsCeiling}`);
  }
  return parsed;
}

type TextResolution = { readonly ok: true; readonly target: TagTarget } | { readonly ok: false; readonly message: string };

/** Texto suelto: admite la propia sintaxis de las fuentes (`… #tag1 #tag2`), cuyas tags pasan a ser las actuales. */
async function resolveText(context: CliContext, raw: string): Promise<TextResolution> {
  const source = raw === '-' ? await context.stdin() : raw;
  const { text, tags } = splitTrailingHashtags(source);
  if (text === '') {
    return { ok: false, message: 'No hay texto que etiquetar: pasa el texto del logro como argumento (o «-» para leerlo de stdin), o usa --only/--untagged para etiquetar logros del perfil' };
  }
  if (text.length > SUGGEST_TAGS_LIMITS.maxText) {
    return { ok: false, message: `El texto supera los ${SUGGEST_TAGS_LIMITS.maxText} caracteres (${text.length}): etiqueta un logro cada vez` };
  }
  return { ok: true, target: { text, currentTags: tags.map(normalizeTag) } };
}

type TargetResolution = { readonly ok: true; readonly targets: readonly TagTarget[] } | { readonly ok: false; readonly message: string };

/** Logros del perfil: `--only` o todos, opcionalmente solo los que no tienen etiquetas, con presupuesto `--max-items`. */
function resolveTargets(context: CliContext, profile: MasterProfile, options: SuggestTagsOptions): TargetResolution {
  let ids = parseOnly(options.only) ?? achievementIds(profile);
  const unknown = ids.filter((id) => locateAchievement(profile, id) === undefined);
  if (unknown.length > 0) {
    return { ok: false, message: `No ${unknown.length === 1 ? 'existe el logro' : 'existen los logros'} «${unknown.join('», «')}»` };
  }
  if (options.untagged) {
    ids = ids.filter((id) => locateAchievement(profile, id)?.achievement.tags.length === 0);
    if (ids.length === 0) {
      return { ok: false, message: 'Todos los logros considerados tienen etiquetas: nada que sugerir (sin --untagged se revisan también los etiquetados)' };
    }
  }
  if (ids.length === 0) {
    return { ok: false, message: 'No hay logros que etiquetar' };
  }
  if (ids.length > options.maxItems) {
    context.stderr(`Aviso: ${ids.length} logros superan el máximo por ejecución (${options.maxItems}); se procesan los ${options.maxItems} primeros (--max-items o --only para elegir)\n`);
    ids = ids.slice(0, options.maxItems);
  }
  return { ok: true, targets: ids.map((id) => ({ id })) };
}

export async function runSuggestTagsCommand(context: CliContext, options: SuggestTagsOptions): Promise<number> {
  if (options.showPrompt) {
    context.stdout(`${await loadSuggestTagsPrompt()}\n`);
    return EXIT_OK;
  }
  let textTarget: TagTarget | undefined;
  if (options.text !== undefined) {
    const resolved = await resolveText(context, options.text);
    if (!resolved.ok) {
      context.stderr(`${resolved.message}\n`);
      return EXIT_DATA_ERROR;
    }
    textTarget = resolved.target;
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
  const profile = artifact.profile;

  // El perfil es el diccionario: solo las tags de las especialidades (o de la pedida con -s).
  const dictionaryResult = closedDictionary(profile, options.specialty);
  if (!dictionaryResult.ok) {
    context.stderr(`${dictionaryResult.message}\n`);
    return EXIT_DATA_ERROR;
  }
  const dictionary = dictionaryResult.dictionary;

  let targets: readonly TagTarget[];
  if (textTarget === undefined) {
    const resolved = resolveTargets(context, profile, options);
    if (!resolved.ok) {
      context.stderr(`${resolved.message}\n`);
      return EXIT_DATA_ERROR;
    }
    targets = resolved.targets;
  } else {
    targets = [textTarget];
  }
  const fragmentOptions: SuggestTagsFragmentOptions = { locale: options.locale, maxTags: options.maxTags, redactCompanies: options.redactCompanies };
  const fragments = targets.map((target) => buildSuggestTagsFragment(profile, target, dictionary, fragmentOptions)).filter((fragment) => fragment !== undefined);

  // Consentimiento visible (C3): qué sale y a dónde, antes de enviar nada.
  const words = fragments.reduce((sum, fragment) => sum + fragment.input.text.split(/\s+/).length, 0);
  const providerResult = await context.llmProvider({ provider: options.provider, model: options.model });
  if (!providerResult.ok) {
    context.stderr(`${providerResult.message}\n`);
    return EXIT_FAILURE;
  }
  const provider = providerResult.provider;
  const destination = `${provider.id} (${provider.baseUrl}, ${provider.kind}; modelo ${provider.model})`;
  const scope = `diccionario cerrado de ${pluralize(dictionary.tags.length, 'etiqueta', 'etiquetas')} de ${pluralize(dictionary.specialties.length, 'especialidad', 'especialidades')}`;
  context.stderr(
    `Saldrá${fragments.length === 1 ? '' : 'n'} ${pluralize(fragments.length, 'fragmento seudonimizado', 'fragmentos seudonimizados')} (${words} palabras; sin nombre ni datos de contacto${options.redactCompanies ? ', sin empresas' : ''}; ${scope}) hacia ${destination}\n`,
  );
  if (options.showPayload) {
    context.stdout(`${JSON.stringify(fragments.map((fragment) => fragment.input), null, 2)}\n`);
  }
  if (options.dryRun) {
    context.stderr('Ejecución en seco: no se ha enviado nada\n');
    return EXIT_OK;
  }

  const prompt = await loadSuggestTagsPrompt();
  if (provider.kind === 'local') {
    const health = await provider.health();
    if (!health.ok) {
      context.stderr(`${health.message}\nComprueba el proveedor con «cv llm status»\n`);
      return EXIT_FAILURE;
    }
    if (!health.modelAvailable) {
      context.stderr(`El modelo «${provider.model}» no está disponible en ${provider.baseUrl}; comprueba «cv llm status»\n`);
      return EXIT_FAILURE;
    }
  } else {
    const estimate = estimateBatch(
      fragments.map((fragment) => suggestTagsMessages(fragment, prompt)),
      SUGGEST_TAGS_LIMITS.maxTokens,
    );
    if (!(await consentToRemote(context, provider, estimate, options.yes))) {
      return EXIT_FAILURE;
    }
  }

  const items = await runSuggestTagsBatch({
    profile,
    fragments,
    provider,
    prompt,
    cache: options.cache ? context.llmCache : undefined,
    now: context.now,
    progress: (line) => {
      context.stderr(`${line}\n`);
    },
  });

  // Salida limpia (stdout): una línea por ítem, en la sintaxis de las fuentes; detalles por stderr.
  for (const item of items) {
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
  const stats = tagStats(items);
  context.stderr(
    `${pluralize(stats.items, 'fragmento', 'fragmentos')} · ${pluralize(stats.suggested, 'etiqueta sugerida', 'etiquetas sugeridas')} (${stats.fresh} nuevas) · ${stats.rejected} rechazadas · ${stats.failed} fallidos · ${stats.fromCache} desde caché\n`,
  );
  return stats.failed === stats.items ? EXIT_FAILURE : EXIT_OK;
}
