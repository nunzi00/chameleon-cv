/**
 * `cv improve` (T-4.3, `docs/llm-integration.md` §4.1): logros → fragmentos seudonimizados →
 * proveedor local (o caché) → validación → verificador C2 → fichero de revisión. Nunca escribe
 * en las fuentes ni en el artefacto (canon C1); antes de enviar dice qué sale y a dónde (C3);
 * `--dry-run` y `--show-payload` lo muestran sin enviar; `--show-prompt` imprime el prompt (C5).
 */
import { dirname, resolve } from 'node:path';

import { readProfileArtifact } from '../../artifact';
import type { MasterProfile } from '../../core/schema';
import { DEFAULT_SEED, DEFAULT_TEMPERATURE, IMPROVE_LIMITS, IMPROVE_PROMPT_VERSION, buildImproveFragment, estimateBatch, formatReview, loadPrompt, reviewStats, runImproveBatch, type FragmentOptions } from '../../llm';
import { describeError } from '../../shared/errors';
import type { CliContext } from '../context';
import { DEFAULT_OUTPUT_DIR } from '../defaults';
import { warnIfStale } from '../freshness';
import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK, pluralize } from '../output';
import { buildBeforeUse } from './build';
import { OUTPUT_MODE } from './generate-cv';
import { consentToRemote } from './remote';
import { prepareSelection, type SelectionOptions } from './selection';

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

export const IMPROVE_DEFAULTS = { proposals: IMPROVE_LIMITS.proposals, maxLength: IMPROVE_LIMITS.maxLength, maxItems: 20 } as const;

/** Ids de todos los logros del perfil (experiencias, proyectos y transversales) en orden de documento. */
export function achievementIds(profile: MasterProfile): string[] {
  return [
    ...profile.experience.flatMap((item) => item.achievements.map((achievement) => achievement.id)),
    ...profile.projects.flatMap((item) => item.achievements.map((achievement) => achievement.id)),
    ...profile.achievements.map((achievement) => achievement.id),
  ];
}

/** `output/revision-improve-<fecha>[-<especialidad>][-<oferta>].md`. */
export function defaultReviewPath(date: Date, specialty: string | undefined, offer: string | undefined): string {
  const day = date.toISOString().slice(0, 10);
  return `${DEFAULT_OUTPUT_DIR}/revision-improve-${day}${specialty === undefined ? '' : `-${specialty}`}${offer === undefined ? '' : `-${offer}`}.md`;
}

/** `--only a,b` → ids únicos y sin espacios; `undefined` si no se pasó. */
export function parseOnly(only: string | undefined): string[] | undefined {
  if (only === undefined) {
    return undefined;
  }
  return [...new Set(only.split(',').map((id) => id.trim()).filter((id) => id !== ''))];
}

export async function runImproveCommand(context: CliContext, options: ImproveOptions): Promise<number> {
  if (options.showPrompt) {
    context.stdout(`${await loadPrompt()}\n`);
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

  // Selección determinista: los mismos logros que verían el CV (especialidad, oferta, límites).
  const prepared = await prepareSelection(context, artifact.profile, options);
  if (!prepared.ok) {
    return prepared.exitCode;
  }
  const { profile, offerName, offerTerms } = prepared.prepared;

  let ids = parseOnly(options.only) ?? achievementIds(profile);
  if (ids.length === 0) {
    context.stderr('No hay logros que mejorar con esta selección\n');
    return EXIT_DATA_ERROR;
  }
  if (ids.length > options.maxItems) {
    context.stderr(`Aviso: ${ids.length} logros superan el máximo por ejecución (${options.maxItems}); se procesan los ${options.maxItems} primeros (--max-items o --only para elegir)\n`);
    ids = ids.slice(0, options.maxItems);
  }

  const fragmentOptions: FragmentOptions = {
    locale: options.locale,
    offerTerms,
    proposals: options.proposals,
    maxLength: options.maxLength,
    redactCompanies: options.redactCompanies,
  };

  // Consentimiento visible (C3): qué sale y a dónde, antes de enviar nada.
  const fragments = ids.map((id) => buildImproveFragment(artifact.profile, id, fragmentOptions)).filter((fragment) => fragment !== undefined);
  const words = fragments.reduce((sum, fragment) => sum + fragment.input.text.split(/\s+/).length, 0);
  const providerResult = await context.llmProvider({ provider: options.provider, model: options.model });
  if (!providerResult.ok) {
    context.stderr(`${providerResult.message}\n`);
    return EXIT_FAILURE;
  }
  const provider = providerResult.provider;
  const destination = `${provider.id} (${provider.baseUrl}, ${provider.kind}; modelo ${provider.model})`;
  context.stderr(`Saldrán ${pluralize(fragments.length, 'logro seudonimizado', 'logros seudonimizados')} (${words} palabras; sin nombre ni datos de contacto${options.redactCompanies ? ', sin empresas' : ''}) hacia ${destination}\n`);
  if (options.showPayload) {
    context.stdout(`${JSON.stringify(fragments.map((fragment) => fragment.input), null, 2)}\n`);
  }
  if (options.dryRun) {
    context.stderr('Ejecución en seco: no se ha enviado nada\n');
    return EXIT_OK;
  }

  const prompt = await loadPrompt();
  if (provider.kind === 'local') {
    const health = await provider.health();
    if (!health.ok) {
      context.stderr(`${health.message}\nComprueba el proveedor con «cv llm status»\n`);
      return EXIT_FAILURE;
    }
    if (!health.modelAvailable) {
      context.stderr(`El modelo «${provider.model}» no está disponible en ${provider.baseUrl} (${health.models.length === 0 ? 'no sirve ningún modelo' : `sirve: ${health.models.join(', ')}`}); comprueba «cv llm status»\n`);
      return EXIT_FAILURE;
    }
  } else {
    // Remoto (T-4.5): coste estimado y confirmación explícita antes de la primera petición.
    const estimate = estimateBatch(
      fragments.map((fragment) => [
        { role: 'system' as const, content: prompt },
        { role: 'user' as const, content: JSON.stringify(fragment.input) },
      ]),
      IMPROVE_LIMITS.maxTokens,
    );
    if (!(await consentToRemote(context, provider, estimate, options.yes))) {
      return EXIT_FAILURE;
    }
  }
  const now = context.now ?? (() => new Date());
  const items = await runImproveBatch({
    profile: artifact.profile,
    ids,
    provider,
    prompt,
    fragment: fragmentOptions,
    cache: options.cache ? context.llmCache : undefined,
    now,
    progress: (line) => {
      context.stderr(`${line}\n`);
    },
  });

  const generatedAt = now().toISOString();
  const review = formatReview(
    { task: 'improve', generatedAt, specialty: options.specialty, offer: offerName, provider: { id: provider.id, baseUrl: provider.baseUrl, model: provider.model }, promptVersion: IMPROVE_PROMPT_VERSION, temperature: DEFAULT_TEMPERATURE, seed: DEFAULT_SEED },
    items,
  );
  const outputPath = resolve(context.cwd, options.output ?? defaultReviewPath(now(), options.specialty, offerName));
  try {
    await context.artifactFileSystem.mkdir(dirname(outputPath));
    await context.artifactFileSystem.writeFile(outputPath, review, OUTPUT_MODE);
  } catch (error) {
    context.stderr(`No se pudo escribir la revisión en «${outputPath}»: ${describeError(error)}\n`);
    return EXIT_FAILURE;
  }
  const stats = reviewStats(items);
  context.stdout(
    `Revisión escrita en ${outputPath}: ${pluralize(stats.items, 'logro', 'logros')} · ${pluralize(stats.proposals, 'propuesta', 'propuestas')} · ${stats.accepted} aceptadas · ${stats.rejected} rechazadas (C2) · ${stats.failed} fallidos · ${stats.fromCache} desde caché\n`,
  );
  return stats.failed === stats.items ? EXIT_FAILURE : EXIT_OK;
}

export async function runLlmCacheClear(context: CliContext): Promise<number> {
  const removed = await context.llmCache.clear();
  context.stdout(`Caché de respuestas vaciada: ${pluralize(removed, 'entrada', 'entradas')}\n`);
  return EXIT_OK;
}
