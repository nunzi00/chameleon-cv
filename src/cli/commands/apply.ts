/**
 * `cv improve apply <revisión>` (T-4.7): cliente del caso de uso `applyReview`. Aplica a las fuentes las
 * propuestas marcadas `[x]` en un fichero de revisión de `improve` o `summarize`: la única orden que escribe
 * en `data/sources` (canon C9: acción explícita y deliberada del usuario), con cuatro garantías: solo lo
 * marcado; cambio mínimo y localizado; la versión anterior completa guardada en el histórico de fuentes
 * (`output/historial-fuentes/<entrada>/<ruta>`, T-8.10); y comprobación por huella: si el original ya no está tal
 * cual en la fuente, no se escribe nada.
 *
 * Y qué hacer con la revisión después (T-9.24): `cv improve archive|unarchive` la aparta o la devuelve a la
 * vista —la que ya no deja nada pendiente se archiva sola al aplicarla, salvo `--no-archive`— y
 * `cv improve undo` deshace lo que escribió, devolviendo cada fuente a como estaba.
 */
import { resolve } from 'node:path';

import { applyReview, reviewDirectoryOf, setReviewArchived } from '../../app/review';
import { undoReviewApply } from '../../app/review-undo';
import type { CliContext } from '../context';
import { EXIT_OK, pluralize, reportError } from '../output';

export { backupPath } from '../../app/review';
export { isSafeSourcePath } from '../../app/paths';

export interface ApplyOptions {
  readonly review: string;
  /** Directorio de fuentes; por defecto el registrado en la revisión o `data/sources`. */
  readonly data?: string | undefined;
  readonly deleteReview: boolean;
  readonly dryRun: boolean;
  /** `--no-archive`: deja la revisión donde está aunque ya no quede nada pendiente. */
  readonly archive: boolean;
}

export async function runApplyCommand(context: CliContext, options: ApplyOptions): Promise<number> {
  const result = await applyReview(context, { review: options.review, data: options.data, dryRun: options.dryRun, deleteReview: options.deleteReview, archive: options.archive });
  for (const file of result.ok ? result.outcome.written : result.written) {
    context.stdout(`Aplicado en ${file.path} (versión anterior guardada en ${file.backup}): ${file.ids.join(', ')}\n`);
  }
  if (!result.ok) {
    return reportError(context, result.error);
  }
  const { outcome } = result;
  if (options.dryRun) {
    for (const file of outcome.plan) {
      for (const edit of file.edits) {
        context.stdout(`${file.path}: ${edit.id} → ${edit.text.replace(/\n+/g, ' ')}\n`);
      }
    }
    context.stderr('Ejecución en seco: no se ha modificado nada\n');
    return EXIT_OK;
  }
  if (outcome.deleted) {
    context.stdout(`Revisión eliminada: ${outcome.reviewPath}\n`);
  }
  if (outcome.archived !== undefined) {
    context.stdout(`Revisión archivada (ya no deja nada pendiente): ${outcome.archived}\n`);
  }
  // Lo que ya estaba puesto se dice como lo que es —aplicado— y con la vía para deshacerlo, que existe desde
  // T-8.10 y nadie tiene por qué adivinar.
  if (outcome.already.length > 0) {
    context.stderr(`${pluralize(outcome.already.length, 'propuesta ya aplicada', 'propuestas ya aplicadas')} (${outcome.already.join(', ')}): la fuente ya tiene ese texto, no se ha vuelto a escribir\n`);
    context.stderr(`Para deshacerlo: «cv improve undo ${options.review}» devuelve las fuentes a como estaban antes de aplicarla (y la versión de ahora queda a su vez en el histórico)\n`);
  }
  if (outcome.changes === 0 && outcome.written.length === 0) {
    return EXIT_OK;
  }
  context.stderr(`${pluralize(outcome.changes, 'cambio aplicado', 'cambios aplicados')} en ${pluralize(outcome.written.length, 'fichero', 'ficheros')} · recompila el artefacto con «cv build»\n`);
  return EXIT_OK;
}

/**
 * `cv improve archive|unarchive <revisión>` (T-9.24): aparta una revisión a `revisiones-archivadas/` o la
 * devuelve a la vista. Mover, no borrar: lo que se archivó se puede volver a leer, aplicar y desarchivar.
 */
export async function runArchiveCommand(context: CliContext, review: string, archived: boolean): Promise<number> {
  const { directory, name } = reviewDirectoryOf(resolve(context.cwd, review));
  const result = await setReviewArchived(context, directory, name, archived);
  if (!result.ok) {
    return reportError(context, result.error);
  }
  if (!result.moved) {
    context.stderr(`«${name}» ya estaba ${archived ? 'archivada' : 'a la vista'}: ${result.path}\n`);
    return EXIT_OK;
  }
  context.stdout(`${archived ? 'Archivada' : 'Desarchivada'}: ${result.path}\n`);
  return EXIT_OK;
}

/**
 * `cv improve undo <revisión>` (T-9.24): deshace la última aplicación de esa revisión devolviendo cada fuente
 * a como estaba, con la versión de ahora guardada a su vez en el histórico.
 */
export async function runUndoCommand(context: CliContext, review: string): Promise<number> {
  const { directory, name } = reviewDirectoryOf(resolve(context.cwd, review));
  const result = await undoReviewApply(context, { directory, name });
  if (!result.ok) {
    return reportError(context, result.error);
  }
  const { outcome } = result;
  for (const path of outcome.restored) {
    context.stdout(`Restaurado ${path} a como estaba antes de aplicar «${name}»\n`);
  }
  if (outcome.unarchived !== undefined) {
    context.stdout(`Revisión desarchivada: ${outcome.unarchived}\n`);
  }
  if (outcome.entry === undefined) {
    context.stderr(`Las fuentes ya estaban como antes de aplicar «${name}» (entrada ${outcome.applied.id}): no se ha cambiado nada\n`);
    return EXIT_OK;
  }
  context.stderr(`${pluralize(outcome.restored.length, 'fuente restaurada', 'fuentes restauradas')} · la versión que había queda en el histórico como ${outcome.entry.id} · recompila el artefacto con «cv build»\n`);
  return EXIT_OK;
}
