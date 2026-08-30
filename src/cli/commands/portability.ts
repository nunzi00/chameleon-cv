/**
 * `cv export` y `cv import`: clientes delgados de `src/app/portability.ts` (T-8.1, `docs/portability.md`
 * §4.2–4.3). La CLI solo lee el JSON (fichero o «-»), imprime el plan o el resumen y traduce los errores
 * tipificados a códigos de salida; toda la lógica —validación, auto-chequeo, copia y escritura— está en el núcleo.
 */
import { resolve } from 'node:path';

import { isMissingFile, writeProfileArtifact } from '../../artifact';
import { environmentError, notFoundError, type AppError } from '../../app/errors';
import { describePlan, exportProfile, importProfile, parseProfileJson, type ImportOutcome } from '../../app/portability';
import { describeError } from '../../shared/errors';
import type { CliContext } from '../context';
import { EXIT_OK, pluralize, profileSummary, reportError } from '../output';

export interface ExportOptions {
  readonly data: string;
  readonly output?: string | undefined;
}

export async function runExport(context: CliContext, options: ExportOptions): Promise<number> {
  const result = await exportProfile(context, { data: options.data });
  if (!result.ok) {
    return reportError(context, result.error);
  }
  if (options.output === undefined) {
    context.stdout(result.json);
    return EXIT_OK;
  }
  const target = resolve(context.cwd, options.output);
  try {
    await writeProfileArtifact(context.artifactFileSystem, target, result.profile);
  } catch (error) {
    return reportError(context, environmentError(`No se pudo escribir «${target}»: ${describeError(error)}`));
  }
  context.stdout(`Perfil exportado en ${target} (${profileSummary(result.profile)})\n`);
  return EXIT_OK;
}

export interface ImportOptions {
  readonly data: string;
  readonly replace: boolean;
  readonly dryRun: boolean;
}

type InputResult = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: AppError };

/** El JSON del perfil: un fichero del espacio de trabajo o la entrada estándar («-»). */
async function readInput(context: CliContext, file: string): Promise<InputResult> {
  if (file === '-') {
    return { ok: true, text: await context.stdin() };
  }
  const path = resolve(context.cwd, file);
  try {
    return { ok: true, text: await context.datasetFileSystem.readTextFile(path) };
  } catch (error) {
    return {
      ok: false,
      error: isMissingFile(error) ? notFoundError(`No existe el fichero «${path}»`) : environmentError(`No se pudo leer «${path}»: ${describeError(error)}`),
    };
  }
}

/** El plan (`--dry-run`) o el resumen de lo escrito, tal como lo imprime la CLI. */
export function formatImportOutcome(outcome: ImportOutcome): string {
  const { files, counts } = describePlan(outcome.plan);
  const summary = `${pluralize(files.length, 'fichero', 'ficheros')} (${profileSummary(outcome.plan.profile)})`;
  if (outcome.dryRun) {
    return [
      `Plan de importación en ${outcome.root}: ${summary}`,
      ...files.map((file) => `  ${file.path} (${pluralize(file.bytes, 'byte', 'bytes')})`),
      'Auto-chequeo: las fuentes regeneradas reproducen el perfil importado.',
      'No se ha escrito nada (--dry-run).',
      '',
    ].join('\n');
  }
  const lines = [`Perfil importado en ${outcome.root}: ${summary}`];
  if (outcome.backup !== undefined) {
    lines.push(`Copia de seguridad de las fuentes anteriores: ${outcome.backup}`);
  }
  if (counts.skills + counts.certifications + counts.achievements + counts.experience + counts.projects + counts.education + counts.specialties === 0) {
    lines.push('Solo profile.md: el perfil no traía entidades.');
  }
  lines.push('Ejecuta «cv build» para regenerar el artefacto.', '');
  return lines.join('\n');
}

export async function runImport(context: CliContext, file: string, options: ImportOptions): Promise<number> {
  const input = await readInput(context, file);
  if (!input.ok) {
    return reportError(context, input.error);
  }
  const parsed = parseProfileJson(input.text);
  if (!parsed.ok) {
    return reportError(context, parsed.error);
  }
  const result = await importProfile(context, parsed.value, { data: options.data, replace: options.replace, dryRun: options.dryRun });
  if (!result.ok) {
    return reportError(context, result.error);
  }
  for (const warning of result.outcome.plan.warnings) {
    context.stderr(`Aviso: ${warning}\n`);
  }
  context.stdout(formatImportOutcome(result.outcome));
  return EXIT_OK;
}
