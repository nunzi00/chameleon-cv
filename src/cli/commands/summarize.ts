/**
 * `cv summarize` (T-4.4, `docs/llm-integration.md` §2.2): resumen profesional a partir del perfil
 * ya filtrado (especialidad, oferta, límites), con la misma cadena segura que `improve`:
 * fragmento seudonimizado → proveedor local o caché → validación → verificador C2 → fichero de
 * revisión (`output/revision-summarize-…`). Nunca escribe en las fuentes (canon C9).
 */
import { dirname, resolve } from 'node:path';

import { readProfileArtifact } from '../../artifact';
import {
  DEFAULT_SEED,
  DEFAULT_TEMPERATURE,
  SUMMARIZE_LIMITS,
  SUMMARIZE_PROMPT_VERSION,
  buildSummarizeFragment,
  estimateBatch,
  formatReview,
  loadSummarizePrompt,
  reviewStats,
  runSummarizeTask,
  type SummarizeFragmentOptions,
} from '../../llm';
import { describeError } from '../../shared/errors';
import type { CliContext } from '../context';
import { DEFAULT_OUTPUT_DIR } from '../defaults';
import { warnIfStale } from '../freshness';
import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK } from '../output';
import { buildBeforeUse } from './build';
import { OUTPUT_MODE } from './generate-cv';
import { consentToRemote } from './remote';
import { prepareSelection, type SelectionOptions } from './selection';

export interface SummarizeOptions extends SelectionOptions {
  readonly profile: string;
  readonly data: string;
  readonly build: boolean;
  readonly paragraphs: number;
  readonly proposals: number;
  readonly maxLength: number;
  readonly redactCompanies: boolean;
  readonly locale?: string | undefined;
  readonly output?: string | undefined;
  readonly cache: boolean;
  readonly showPrompt: boolean;
  readonly showPayload: boolean;
  readonly dryRun: boolean;
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  readonly yes: boolean;
}

export const SUMMARIZE_DEFAULTS = { paragraphs: SUMMARIZE_LIMITS.paragraphs, proposals: SUMMARIZE_LIMITS.proposals, maxLength: SUMMARIZE_LIMITS.maxLength } as const;

/** `output/revision-summarize-<fecha>[-<especialidad>][-<oferta>].md`. */
export function defaultSummaryReviewPath(date: Date, specialty: string | undefined, offer: string | undefined): string {
  const day = date.toISOString().slice(0, 10);
  return `${DEFAULT_OUTPUT_DIR}/revision-summarize-${day}${specialty === undefined ? '' : `-${specialty}`}${offer === undefined ? '' : `-${offer}`}.md`;
}

export async function runSummarizeCommand(context: CliContext, options: SummarizeOptions): Promise<number> {
  if (options.showPrompt) {
    context.stdout(`${await loadSummarizePrompt()}\n`);
    return EXIT_OK;
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
  const prepared = await prepareSelection(context, artifact.profile, options);
  if (!prepared.ok) {
    return prepared.exitCode;
  }
  const { profile, offerName, offerTerms } = prepared.prepared;
  if (profile.experience.length === 0 && profile.projects.length === 0 && profile.achievements.length === 0 && profile.skills.length === 0) {
    context.stderr('No hay contenido que resumir con esta selección\n');
    return EXIT_DATA_ERROR;
  }

  const now = context.now ?? (() => new Date());
  const fragmentOptions: SummarizeFragmentOptions = {
    locale: options.locale,
    offerTerms,
    proposals: options.proposals,
    paragraphs: options.paragraphs,
    maxLength: options.maxLength,
    redactCompanies: options.redactCompanies,
    now: now(),
  };
  const fragment = buildSummarizeFragment(profile, fragmentOptions);
  const words = fragment.corpus.split(/\s+/).filter((word) => word !== '').length;

  const providerResult = await context.llmProvider({ provider: options.provider, model: options.model });
  if (!providerResult.ok) {
    context.stderr(`${providerResult.message}\n`);
    return EXIT_FAILURE;
  }
  const provider = providerResult.provider;
  context.stderr(
    `Saldrá el perfil filtrado seudonimizado (${fragment.input.experience.length} experiencias, ${fragment.input.projects.length} proyectos, ${fragment.input.skills.length} grupos de skills; ${words} palabras; sin nombre ni datos de contacto${options.redactCompanies ? ', sin empresas' : ''}) hacia ${provider.id} (${provider.baseUrl}, ${provider.kind}; modelo ${provider.model})\n`,
  );
  if (options.showPayload) {
    context.stdout(`${JSON.stringify(fragment.input, null, 2)}\n`);
  }
  if (options.dryRun) {
    context.stderr('Ejecución en seco: no se ha enviado nada\n');
    return EXIT_OK;
  }

  const prompt = await loadSummarizePrompt();
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
    const estimate = estimateBatch([[{ role: 'system', content: prompt }, { role: 'user', content: JSON.stringify(fragment.input) }]], SUMMARIZE_LIMITS.maxTokens);
    if (!(await consentToRemote(context, provider, estimate, options.yes))) {
      return EXIT_FAILURE;
    }
  }

  const location = `Resumen profesional${options.specialty === undefined ? '' : ` · ${options.specialty}`}${offerName === undefined ? '' : ` · oferta ${offerName}`}`;
  const item = await runSummarizeTask({ profile: artifact.profile, fragment, provider, prompt, location, cache: options.cache ? context.llmCache : undefined, now });
  const review = formatReview(
    { task: 'summarize', generatedAt: now().toISOString(), specialty: options.specialty, offer: offerName, provider: { id: provider.id, baseUrl: provider.baseUrl, model: provider.model }, promptVersion: SUMMARIZE_PROMPT_VERSION, temperature: DEFAULT_TEMPERATURE, seed: DEFAULT_SEED },
    [item],
  );
  const outputPath = resolve(context.cwd, options.output ?? defaultSummaryReviewPath(now(), options.specialty, offerName));
  try {
    await context.artifactFileSystem.mkdir(dirname(outputPath));
    await context.artifactFileSystem.writeFile(outputPath, review, OUTPUT_MODE);
  } catch (error) {
    context.stderr(`No se pudo escribir la revisión en «${outputPath}»: ${describeError(error)}\n`);
    return EXIT_FAILURE;
  }
  if (item.error !== undefined) {
    context.stderr(`${item.error}\n`);
    context.stdout(`Revisión escrita en ${outputPath} (sin propuestas)\n`);
    return EXIT_FAILURE;
  }
  const stats = reviewStats([item]);
  context.stdout(`Revisión escrita en ${outputPath}: ${stats.proposals} propuestas · ${stats.accepted} aceptadas · ${stats.rejected} rechazadas (C2)${item.fromCache ? ' · desde caché' : ` · ${item.elapsedMs} ms`}\n`);
  return EXIT_OK;
}
