/**
 * Casos de uso del co-piloto (T-7.4b, docs/api-headless.md §3): planificar sin red (qué saldría y a dónde),
 * elegir el proveedor y comprobarlo, estimar el coste de un remoto (C11), ejecutar con progreso y
 * cancelación, y producir la revisión con la procedencia de cada original (T-4.7). Ningún caso de uso
 * escribe en las fuentes (C1, C9); la revisión se escribe con `writeReview` donde el cliente decida.
 */
import { dirname, resolve } from 'node:path';

import { closedDictionary, normalizeTag } from '../core/llm/tags';
import { applyLimits } from '../core/scoring';
import type { MasterProfile } from '../core/schema';
import {
  DEFAULT_SEED,
  DEFAULT_TEMPERATURE,
  IMPROVE_LIMITS,
  IMPROVE_PROMPT_VERSION,
  SUGGEST_TAGS_LIMITS,
  SUMMARIZE_LIMITS,
  SUMMARIZE_PROMPT_VERSION,
  buildImproveFragment,
  buildSuggestTagsFragment,
  buildSummarizeFragment,
  estimateBatch,
  formatReview,
  loadPrompt,
  loadSuggestTagsPrompt,
  loadSummarizePrompt,
  locateAchievement,
  reviewStats,
  runImproveBatch,
  runSuggestTagsBatch,
  runSummarizeTask,
  suggestTagsMessages,
  tagStats,
  type CostEstimate,
  type FragmentOptions,
  type ImproveFragment,
  type LlmProvider,
  type ProviderSelection,
  type ReviewItem,
  type ReviewStats,
  type SuggestTagsFragment,
  type SuggestTagsFragmentOptions,
  type SummarizeFragment,
  type SummarizeFragmentOptions,
  type TagSuggestionItem,
  type TagStats,
  type TagTarget,
} from '../llm';
import { splitTrailingHashtags } from '../parsers';
import { describeError } from '../shared/errors';
import type { AppContext } from './context';
import { buildProfile, loadProfile } from './dataset';
import { DEFAULT_OUTPUT_DIR } from './defaults';
import { dataError, environmentError, type AppError } from './errors';
import { checkArtifactFreshness, freshnessWarning, type AppWarning } from './freshness';
import { OUTPUT_MODE } from './generate';
import { hasLimits, resolveLimits, type LimitOptions } from './limits';
import { readOffer, type OfferInput, type OfferText } from './offer';
import { indexSources, summarySource, withAchievementSources } from './provenance';
import { tailorProfile } from './tailor';
import { pluralize } from './text';

/* ---------- Común ---------- */

/** Logros por ejecución si no se indica otro presupuesto (`--max-items`). */
export const DEFAULT_MAX_ITEMS = 20;

export interface CopilotBase {
  readonly profile: string;
  readonly data: string;
  readonly build: boolean;
}

export interface CopilotRequest extends CopilotBase, LimitOptions {
  readonly specialty?: string | undefined;
  readonly offer?: OfferInput | undefined;
}

export interface CopilotSelection {
  /** Perfil completo (vocabulario del verificador, fragmentos). */
  readonly fullProfile: MasterProfile;
  /** Perfil ya seleccionado, puntuado y recortado: los mismos ítems que vería el CV. */
  readonly profile: MasterProfile;
  readonly offerName: string | undefined;
  readonly offerTerms: readonly string[];
}

export type PlanOutcome<P> = { readonly ok: true; readonly plan: P; readonly warnings: readonly AppWarning[] } | { readonly ok: false; readonly error: AppError; readonly warnings: readonly AppWarning[] };

type Loaded = { readonly ok: true; readonly profile: MasterProfile; readonly warnings: AppWarning[] } | { readonly ok: false; readonly error: AppError; readonly warnings: AppWarning[] };

/** Artefacto (recompilado con `build`) y aviso de frescura: el arranque común de todas las tareas. */
async function loadForCopilot(context: AppContext, request: CopilotBase): Promise<Loaded> {
  const warnings: AppWarning[] = [];
  if (request.build) {
    const built = await buildProfile(context, { data: request.data, out: request.profile, check: false });
    if (!built.ok) {
      return { ok: false, error: built.error, warnings };
    }
  }
  const loaded = await loadProfile(context, request);
  if (!loaded.ok) {
    return { ok: false, error: loaded.error, warnings };
  }
  if (!request.build) {
    const warning = freshnessWarning(await checkArtifactFreshness(context.datasetFileSystem, loaded.artifactPath, resolve(context.cwd, request.data)));
    if (warning !== undefined) {
      warnings.push(warning);
    }
  }
  return { ok: true, profile: loaded.profile, warnings };
}

export type CopilotPrepared = { readonly ok: true; readonly selection: CopilotSelection; readonly warnings: readonly AppWarning[] } | { readonly ok: false; readonly error: AppError; readonly warnings: readonly AppWarning[] };

/** La misma selección determinista que vería el CV (especialidad, oferta con sus términos, límites). */
export async function prepareCopilot(context: AppContext, request: CopilotRequest): Promise<CopilotPrepared> {
  const loaded = await loadForCopilot(context, request);
  if (!loaded.ok) {
    return loaded;
  }
  let offer: OfferText | undefined;
  if (request.offer !== undefined) {
    const read = await readOffer(context, request.offer);
    if (!read.ok) {
      return { ok: false, error: read.error, warnings: loaded.warnings };
    }
    offer = read.offer;
  }
  const tailored = tailorProfile(loaded.profile, { specialty: request.specialty, offer });
  if (!tailored.ok) {
    return { ok: false, error: tailored.error, warnings: loaded.warnings };
  }
  const { profile, scoreOf, offerName, requirements } = tailored.tailored;
  const limits = resolveLimits(request);
  return {
    ok: true,
    selection: {
      fullProfile: loaded.profile,
      profile: hasLimits(limits) ? applyLimits(profile, limits, scoreOf).profile : profile,
      offerName,
      offerTerms: requirements === undefined ? [] : requirements.terms.map((term) => term.term),
    },
    warnings: loaded.warnings,
  };
}

/** Ids de todos los logros del perfil (experiencias, proyectos y transversales) en orden de documento. */
export function achievementIds(profile: MasterProfile): string[] {
  return [
    ...profile.experience.flatMap((item) => item.achievements.map((achievement) => achievement.id)),
    ...profile.projects.flatMap((item) => item.achievements.map((achievement) => achievement.id)),
    ...profile.achievements.map((achievement) => achievement.id),
  ];
}

/* ---------- Proveedor ---------- */

export type ProviderOutcome = { readonly ok: true; readonly provider: LlmProvider } | { readonly ok: false; readonly error: AppError };

/** Local por defecto; un remoto solo con selección explícita (C3). El mensaje de fallo es el del selector. */
export async function selectCopilotProvider(context: AppContext, selection: ProviderSelection): Promise<ProviderOutcome> {
  const result = await context.llmProvider(selection);
  return result.ok ? { ok: true, provider: result.provider } : { ok: false, error: environmentError(result.message) };
}

export function describeProvider(provider: LlmProvider): string {
  return `${provider.id} (${provider.baseUrl}, ${provider.kind}; modelo ${provider.model})`;
}

export type ProviderHealth = { readonly ok: true } | { readonly ok: false; readonly reason: 'unreachable'; readonly message: string } | { readonly ok: false; readonly reason: 'model-missing'; readonly models: readonly string[] };

/** Un proveedor local debe responder y servir el modelo configurado; los remotos se comprueban al enviar. */
export async function checkLocalProvider(provider: LlmProvider): Promise<ProviderHealth> {
  if (provider.kind !== 'local') {
    return { ok: true };
  }
  const health = await provider.health();
  if (!health.ok) {
    return { ok: false, reason: 'unreachable', message: health.message };
  }
  return health.modelAvailable ? { ok: true } : { ok: false, reason: 'model-missing', models: health.models };
}

export interface ExecuteOptions {
  readonly provider: LlmProvider;
  /** Leer y guardar la caché local de respuestas. */
  readonly cache: boolean;
  readonly progress?: ((line: string) => void) | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface ReviewOutcome {
  readonly outputPath: string;
  readonly text: string;
  readonly items: readonly ReviewItem[];
  readonly stats: ReviewStats;
  /** Avisos de procedencia (qué ítems no podrán aplicarse). */
  readonly notes: readonly string[];
  readonly cancelled: boolean;
}

/** Escribe la revisión (0600) creando el directorio; `undefined` si todo fue bien. */
export async function writeReview(context: Pick<AppContext, 'artifactFileSystem'>, outputPath: string, text: string): Promise<AppError | undefined> {
  try {
    await context.artifactFileSystem.mkdir(dirname(outputPath));
    await context.artifactFileSystem.writeFile(outputPath, text, OUTPUT_MODE);
  } catch (error) {
    return environmentError(`No se pudo escribir la revisión en «${outputPath}»: ${describeError(error)}`);
  }
  return undefined;
}

/* ---------- improve ---------- */

export interface ImproveRequest extends CopilotRequest {
  readonly only?: readonly string[] | undefined;
  readonly proposals: number;
  readonly maxLength: number;
  readonly maxItems: number;
  readonly redactCompanies: boolean;
  readonly locale?: string | undefined;
  readonly output?: string | undefined;
}

export interface ImprovePlan {
  readonly kind: 'improve';
  readonly request: ImproveRequest;
  readonly selection: CopilotSelection;
  readonly ids: readonly string[];
  readonly fragments: readonly ImproveFragment[];
  readonly fragmentOptions: FragmentOptions;
  readonly words: number;
}

/** `output/revision-improve-<fecha>[-<especialidad>][-<oferta>].md`. */
export function defaultReviewPath(date: Date, specialty: string | undefined, offer: string | undefined): string {
  const day = date.toISOString().slice(0, 10);
  return `${DEFAULT_OUTPUT_DIR}/revision-improve-${day}${specialty === undefined ? '' : `-${specialty}`}${offer === undefined ? '' : `-${offer}`}.md`;
}

export async function planImprove(context: AppContext, request: ImproveRequest): Promise<PlanOutcome<ImprovePlan>> {
  const prepared = await prepareCopilot(context, request);
  if (!prepared.ok) {
    return prepared;
  }
  const warnings = [...prepared.warnings];
  let ids = request.only ?? achievementIds(prepared.selection.profile);
  if (ids.length === 0) {
    return { ok: false, error: dataError('No hay logros que mejorar con esta selección'), warnings };
  }
  if (ids.length > request.maxItems) {
    warnings.push({ kind: 'items-truncated', total: ids.length, kept: request.maxItems });
    ids = ids.slice(0, request.maxItems);
  }
  const fragmentOptions: FragmentOptions = { locale: request.locale, offerTerms: prepared.selection.offerTerms, proposals: request.proposals, maxLength: request.maxLength, redactCompanies: request.redactCompanies };
  const fragments = ids.map((id) => buildImproveFragment(prepared.selection.fullProfile, id, fragmentOptions)).filter((fragment) => fragment !== undefined);
  const words = fragments.reduce((sum, fragment) => sum + fragment.input.text.split(/\s+/).length, 0);
  return { ok: true, plan: { kind: 'improve', request, selection: prepared.selection, ids, fragments, fragmentOptions, words }, warnings };
}

/** Lo que saldría hacia el modelo: los fragmentos seudonimizados (C4, `--show-payload`). */
export function improvePayload(plan: ImprovePlan): readonly unknown[] {
  return plan.fragments.map((fragment) => fragment.input);
}

export async function improveEstimate(context: AppContext, plan: ImprovePlan): Promise<CostEstimate> {
  const prompt = await loadPrompt(IMPROVE_PROMPT_VERSION, context.assets);
  return estimateBatch(
    plan.fragments.map((fragment) => [
      { role: 'system' as const, content: prompt },
      { role: 'user' as const, content: JSON.stringify(fragment.input) },
    ]),
    IMPROVE_LIMITS.maxTokens,
  );
}

export async function executeImprove(context: AppContext, plan: ImprovePlan, options: ExecuteOptions): Promise<ReviewOutcome> {
  const prompt = await loadPrompt(IMPROVE_PROMPT_VERSION, context.assets);
  const now = context.now ?? (() => new Date());
  const items = await runImproveBatch({
    profile: plan.selection.fullProfile,
    ids: plan.ids,
    provider: options.provider,
    prompt,
    fragment: plan.fragmentOptions,
    cache: options.cache ? context.llmCache : undefined,
    now,
    progress: options.progress,
    signal: options.signal,
  });
  const notes: string[] = [];
  const warn = (line: string): void => {
    notes.push(line);
  };
  const sources = await indexSources(context, resolve(context.cwd, plan.request.data));
  const located = sources.ok ? withAchievementSources(items, sources.index, warn) : items;
  if (!sources.ok) {
    warn(`Aviso: no se registrará la fuente de los logros (${sources.message}); «cv improve apply» no podrá aplicar esta revisión`);
  }
  const { provider } = options;
  const text = formatReview(
    { task: 'improve', generatedAt: now().toISOString(), specialty: plan.request.specialty, offer: plan.selection.offerName, dataDir: plan.request.data, provider: { id: provider.id, baseUrl: provider.baseUrl, model: provider.model }, promptVersion: IMPROVE_PROMPT_VERSION, temperature: DEFAULT_TEMPERATURE, seed: DEFAULT_SEED },
    located,
  );
  const outputPath = resolve(context.cwd, plan.request.output ?? defaultReviewPath(now(), plan.request.specialty, plan.selection.offerName));
  return { outputPath, text, items, stats: reviewStats(items), notes, cancelled: options.signal?.aborted === true };
}

/* ---------- summarize ---------- */

export interface SummarizeRequest extends CopilotRequest {
  readonly paragraphs: number;
  readonly proposals: number;
  readonly maxLength: number;
  readonly redactCompanies: boolean;
  readonly locale?: string | undefined;
  readonly output?: string | undefined;
}

export interface SummarizePlan {
  readonly kind: 'summarize';
  readonly request: SummarizeRequest;
  readonly selection: CopilotSelection;
  readonly fragment: SummarizeFragment;
  readonly words: number;
  readonly location: string;
}

/** `output/revision-summarize-<fecha>[-<especialidad>][-<oferta>].md`. */
export function defaultSummaryReviewPath(date: Date, specialty: string | undefined, offer: string | undefined): string {
  const day = date.toISOString().slice(0, 10);
  return `${DEFAULT_OUTPUT_DIR}/revision-summarize-${day}${specialty === undefined ? '' : `-${specialty}`}${offer === undefined ? '' : `-${offer}`}.md`;
}

export async function planSummarize(context: AppContext, request: SummarizeRequest): Promise<PlanOutcome<SummarizePlan>> {
  const prepared = await prepareCopilot(context, request);
  if (!prepared.ok) {
    return prepared;
  }
  const { selection } = prepared;
  const { profile } = selection;
  if (profile.experience.length === 0 && profile.projects.length === 0 && profile.achievements.length === 0 && profile.skills.length === 0) {
    return { ok: false, error: dataError('No hay contenido que resumir con esta selección'), warnings: prepared.warnings };
  }
  const now = context.now ?? (() => new Date());
  const fragmentOptions: SummarizeFragmentOptions = { locale: request.locale, offerTerms: selection.offerTerms, proposals: request.proposals, paragraphs: request.paragraphs, maxLength: request.maxLength, redactCompanies: request.redactCompanies, now: now() };
  const fragment = buildSummarizeFragment(profile, fragmentOptions);
  const words = fragment.corpus.split(/\s+/).filter((word) => word !== '').length;
  const location = `Resumen profesional${request.specialty === undefined ? '' : ` · ${request.specialty}`}${selection.offerName === undefined ? '' : ` · oferta ${selection.offerName}`}`;
  return { ok: true, plan: { kind: 'summarize', request, selection, fragment, words, location }, warnings: prepared.warnings };
}

export function summarizePayload(plan: SummarizePlan): unknown {
  return plan.fragment.input;
}

export async function summarizeEstimate(context: AppContext, plan: SummarizePlan): Promise<CostEstimate> {
  const prompt = await loadSummarizePrompt(context.assets);
  return estimateBatch([[{ role: 'system', content: prompt }, { role: 'user', content: JSON.stringify(plan.fragment.input) }]], SUMMARIZE_LIMITS.maxTokens);
}

export interface SummarizeOutcome extends ReviewOutcome {
  /** El único ítem de la revisión (con `error` si el modelo falló). */
  readonly item: ReviewItem;
}

export async function executeSummarize(context: AppContext, plan: SummarizePlan, options: ExecuteOptions): Promise<SummarizeOutcome> {
  const prompt = await loadSummarizePrompt(context.assets);
  const now = context.now ?? (() => new Date());
  const item = await runSummarizeTask({ profile: plan.selection.fullProfile, fragment: plan.fragment, provider: options.provider, prompt, location: plan.location, cache: options.cache ? context.llmCache : undefined, now, signal: options.signal });
  const notes: string[] = [];
  const warn = (line: string): void => {
    notes.push(line);
  };
  const sources = await indexSources(context, resolve(context.cwd, plan.request.data));
  const source = sources.ok ? summarySource(sources.index, plan.request.specialty, plan.selection.offerName, warn) : undefined;
  if (!sources.ok) {
    warn(`Aviso: no se registrará la fuente del resumen (${sources.message}); «cv improve apply» no podrá aplicar esta revisión`);
  }
  const { provider } = options;
  const text = formatReview(
    { task: 'summarize', generatedAt: now().toISOString(), specialty: plan.request.specialty, offer: plan.selection.offerName, dataDir: plan.request.data, provider: { id: provider.id, baseUrl: provider.baseUrl, model: provider.model }, promptVersion: SUMMARIZE_PROMPT_VERSION, temperature: DEFAULT_TEMPERATURE, seed: DEFAULT_SEED },
    [{ ...item, source }],
  );
  const outputPath = resolve(context.cwd, plan.request.output ?? defaultSummaryReviewPath(now(), plan.request.specialty, plan.selection.offerName));
  return { outputPath, text, items: [item], item, stats: reviewStats([item]), notes, cancelled: options.signal?.aborted === true };
}

/* ---------- suggest tags ---------- */

export interface SuggestTagsRequest extends CopilotBase {
  /** Texto suelto ya leído; sin él se etiquetan logros del perfil. */
  readonly text?: string | undefined;
  /** Restringe el diccionario a las tags de esa especialidad. */
  readonly specialty?: string | undefined;
  readonly only?: readonly string[] | undefined;
  readonly untagged: boolean;
  readonly maxTags: number;
  readonly maxItems: number;
  readonly redactCompanies: boolean;
  readonly locale?: string | undefined;
}

export interface SuggestTagsPlan {
  readonly kind: 'suggest-tags';
  readonly request: SuggestTagsRequest;
  readonly profile: MasterProfile;
  readonly fragments: readonly SuggestTagsFragment[];
  readonly words: number;
  /** «diccionario cerrado de N etiquetas de M especialidades». */
  readonly scope: string;
}

export type TextTargetOutcome = { readonly ok: true; readonly target: TagTarget } | { readonly ok: false; readonly error: AppError };

/** Texto suelto: admite la propia sintaxis de las fuentes (`… #tag1 #tag2`), cuyas tags pasan a ser las actuales. */
export function resolveTextTarget(raw: string): TextTargetOutcome {
  const { text, tags } = splitTrailingHashtags(raw);
  if (text === '') {
    return { ok: false, error: dataError('No hay texto que etiquetar: pasa el texto del logro como argumento (o «-» para leerlo de stdin), o usa --only/--untagged para etiquetar logros del perfil') };
  }
  if (text.length > SUGGEST_TAGS_LIMITS.maxText) {
    return { ok: false, error: dataError(`El texto supera los ${SUGGEST_TAGS_LIMITS.maxText} caracteres (${text.length}): etiqueta un logro cada vez`) };
  }
  return { ok: true, target: { text, currentTags: tags.map(normalizeTag) } };
}

type TargetsOutcome = { readonly ok: true; readonly targets: readonly TagTarget[]; readonly warning: AppWarning | undefined } | { readonly ok: false; readonly error: AppError };

/** Logros del perfil: `only` o todos, opcionalmente solo los que no tienen etiquetas, con presupuesto `maxItems`. */
function resolveTargets(profile: MasterProfile, request: SuggestTagsRequest): TargetsOutcome {
  let ids = request.only ?? achievementIds(profile);
  const unknown = ids.filter((id) => locateAchievement(profile, id) === undefined);
  if (unknown.length > 0) {
    return { ok: false, error: dataError(`No ${unknown.length === 1 ? 'existe el logro' : 'existen los logros'} «${unknown.join('», «')}»`) };
  }
  if (request.untagged) {
    ids = ids.filter((id) => locateAchievement(profile, id)?.achievement.tags.length === 0);
    if (ids.length === 0) {
      return { ok: false, error: dataError('Todos los logros considerados tienen etiquetas: nada que sugerir (sin --untagged se revisan también los etiquetados)') };
    }
  }
  if (ids.length === 0) {
    return { ok: false, error: dataError('No hay logros que etiquetar') };
  }
  let warning: AppWarning | undefined;
  if (ids.length > request.maxItems) {
    warning = { kind: 'items-truncated', total: ids.length, kept: request.maxItems };
    ids = ids.slice(0, request.maxItems);
  }
  return { ok: true, targets: ids.map((id) => ({ id })), warning };
}

export async function planSuggestTags(context: AppContext, request: SuggestTagsRequest): Promise<PlanOutcome<SuggestTagsPlan>> {
  let textTarget: TagTarget | undefined;
  if (request.text !== undefined) {
    const resolved = resolveTextTarget(request.text);
    if (!resolved.ok) {
      return { ok: false, error: resolved.error, warnings: [] };
    }
    textTarget = resolved.target;
  }
  const loaded = await loadForCopilot(context, request);
  if (!loaded.ok) {
    return loaded;
  }
  const { profile, warnings } = loaded;
  // El perfil es el diccionario: solo las tags de las especialidades (o de la pedida con -s).
  const dictionaryResult = closedDictionary(profile, request.specialty);
  if (!dictionaryResult.ok) {
    return { ok: false, error: dataError(dictionaryResult.message), warnings };
  }
  const { dictionary } = dictionaryResult;
  let targets: readonly TagTarget[];
  if (textTarget === undefined) {
    const resolved = resolveTargets(profile, request);
    if (!resolved.ok) {
      return { ok: false, error: resolved.error, warnings };
    }
    if (resolved.warning !== undefined) {
      warnings.push(resolved.warning);
    }
    targets = resolved.targets;
  } else {
    targets = [textTarget];
  }
  const fragmentOptions: SuggestTagsFragmentOptions = { locale: request.locale, maxTags: request.maxTags, redactCompanies: request.redactCompanies };
  const fragments = targets.map((target) => buildSuggestTagsFragment(profile, target, dictionary, fragmentOptions)).filter((fragment) => fragment !== undefined);
  const words = fragments.reduce((sum, fragment) => sum + fragment.input.text.split(/\s+/).length, 0);
  const scope = `diccionario cerrado de ${pluralize(dictionary.tags.length, 'etiqueta', 'etiquetas')} de ${pluralize(dictionary.specialties.length, 'especialidad', 'especialidades')}`;
  return { ok: true, plan: { kind: 'suggest-tags', request, profile, fragments, words, scope }, warnings };
}

export function suggestTagsPayload(plan: SuggestTagsPlan): readonly unknown[] {
  return plan.fragments.map((fragment) => fragment.input);
}

export async function suggestTagsEstimate(context: AppContext, plan: SuggestTagsPlan): Promise<CostEstimate> {
  const prompt = await loadSuggestTagsPrompt(context.assets);
  return estimateBatch(
    plan.fragments.map((fragment) => suggestTagsMessages(fragment, prompt)),
    SUGGEST_TAGS_LIMITS.maxTokens,
  );
}

export interface SuggestTagsOutcome {
  readonly items: readonly TagSuggestionItem[];
  readonly stats: TagStats;
  readonly cancelled: boolean;
}

export async function executeSuggestTags(context: AppContext, plan: SuggestTagsPlan, options: ExecuteOptions): Promise<SuggestTagsOutcome> {
  const prompt = await loadSuggestTagsPrompt(context.assets);
  const items = await runSuggestTagsBatch({ profile: plan.profile, fragments: plan.fragments, provider: options.provider, prompt, cache: options.cache ? context.llmCache : undefined, now: context.now, progress: options.progress, signal: options.signal });
  return { items, stats: tagStats(items), cancelled: options.signal?.aborted === true };
}
