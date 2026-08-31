/**
 * Refinar un borrador de importación con el co-piloto (T-8.18, docs/cv-import.md §2.2): plan, estimación y
 * ejecución del trabajo `import-map` de la API. Relee el informe del borrador (`import/<nombre>/README.md`),
 * envía SOLO sus líneas sin situar —seudonimizadas— y actualiza ese mismo informe con las propuestas que el
 * código haya verificado. Nunca escribe en las fuentes ni aplica nada: la revisión sigue siendo humana (C2).
 */
import { resolve } from 'node:path';

import { unplacedFromReport, withProposals } from '../import';
import { IMPORT_MAP_LIMITS, importMapFragment, importMapMessages, loadImportMapPrompt, runImportMap, type ImportMapFragment, type ImportMapLine, type ImportMapProposal } from '../llm/tasks/import-map';
import { estimateBatch, type CostEstimate } from '../llm';
import { SOURCE_FILE_MODE } from './sources';
import { describeError } from '../shared/errors';
import type { AppContext } from './context';
import type { ExecuteOptions } from './copilot';
import { dataError, environmentError, notFoundError, type AppError } from './errors';
import { slugify } from './slug';

export interface ImportMapRequest {
  /** Carpeta del borrador dentro de `import/`. */
  readonly name: string;
  readonly locale?: string | undefined;
}

export interface ImportMapPlan {
  readonly name: string;
  /** Ruta absoluta del informe que se releerá y actualizará. */
  readonly report: string;
  readonly lines: readonly ImportMapLine[];
  readonly fragment: ImportMapFragment;
  /** Líneas sin situar que no caben en el lote (el límite de la tarea). */
  readonly skipped: number;
}

export type ImportMapPlanOutcome = { readonly ok: true; readonly plan: ImportMapPlan } | { readonly ok: false; readonly error: AppError };

/** Lee el informe del borrador y prepara el fragmento; falla con un `AppError` si no hay nada que refinar. */
export async function planImportMap(context: AppContext, request: ImportMapRequest): Promise<ImportMapPlanOutcome> {
  // slugify reduce a [a-z0-9-]: el nombre no puede escaparse de import/.
  const name = slugify(request.name);
  if (name === '') {
    return { ok: false, error: dataError(`«${request.name}» no es un nombre de borrador válido`) };
  }
  const report = resolve(context.cwd, 'import', name, 'README.md');
  let text: string;
  try {
    text = await context.datasetFileSystem.readTextFile(report);
  } catch {
    return { ok: false, error: notFoundError(`No existe el informe del borrador import/${name} (README.md); impórtalo primero`) };
  }
  const unplaced: ImportMapLine[] = unplacedFromReport(text).filter((line) => line.text.trim() !== '').map((line) => ({ n: line.line, text: line.text }));
  if (unplaced.length === 0) {
    return { ok: false, error: dataError(`El borrador import/${name} no tiene líneas sin situar: no hay nada que refinar`) };
  }
  const lines = unplaced.slice(0, IMPORT_MAP_LIMITS.maxLines);
  // Con líneas no vacías el fragmento siempre existe (solo devuelve `undefined` cuando no queda texto que enviar).
  const fragment = importMapFragment(lines, { locale: request.locale })!;
  return { ok: true, plan: { name, report, lines, fragment, skipped: unplaced.length - lines.length } };
}

export async function importMapEstimate(context: AppContext, plan: ImportMapPlan, outputTokensFloor = 0): Promise<CostEstimate> {
  const prompt = await loadImportMapPrompt(context.assets);
  return estimateBatch([importMapMessages(plan.fragment, prompt)], Math.max(IMPORT_MAP_LIMITS.maxTokens, outputTokensFloor));
}

export interface ImportMapOutcome {
  readonly name: string;
  readonly proposals: readonly ImportMapProposal[];
  /** Propuestas que el código rechazó (sección desconocida, línea inexistente o repetida). */
  readonly rejected: number;
  /** Líneas sin situar que no cupieron en el lote. */
  readonly skipped: number;
  /** El informe actualizado, tal como quedó en el borrador. */
  readonly report: string;
}

export type ImportMapResult = { readonly ok: true; readonly outcome: ImportMapOutcome } | { readonly ok: false; readonly error: AppError };

/** Envía el lote, verifica cada propuesta y deja el informe del borrador al día. */
export async function executeImportMap(context: AppContext, plan: ImportMapPlan, options: ExecuteOptions): Promise<ImportMapResult> {
  const prompt = await loadImportMapPrompt(context.assets);
  options.progress?.(`Enviando ${plan.lines.length} línea(s) sin situar a ${options.provider.id} (${options.provider.model})`);
  const mapped = await runImportMap(options.provider, plan.fragment, plan.lines, prompt, undefined, options.signal);
  if (!mapped.ok) {
    return { ok: false, error: mapped.code === 'invalid-output' ? dataError(mapped.message) : environmentError(mapped.message) };
  }
  options.progress?.(`${mapped.proposals.length} propuesta(s) verificadas${mapped.rejected === 0 ? '' : `, ${mapped.rejected} rechazada(s) por el código`}`);
  let current: string;
  try {
    current = await context.datasetFileSystem.readTextFile(plan.report);
  } catch (error) {
    return { ok: false, error: environmentError(`No se pudo releer ${plan.report}: ${describeError(error)}`) };
  }
  const report = withProposals(current, mapped.proposals);
  try {
    await context.artifactFileSystem.writeFile(plan.report, report, SOURCE_FILE_MODE);
  } catch (error) {
    return { ok: false, error: environmentError(`No se pudo actualizar ${plan.report}: ${describeError(error)}`) };
  }
  return { ok: true, outcome: { name: plan.name, proposals: mapped.proposals, rejected: mapped.rejected, skipped: plan.skipped, report } };
}
