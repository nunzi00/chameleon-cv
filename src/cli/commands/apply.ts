/**
 * `cv improve apply <revisión>` (T-4.7): cliente del caso de uso `applyReview`. Aplica a las fuentes las
 * propuestas marcadas `[x]` en un fichero de revisión de `improve` o `summarize`: la única orden que escribe
 * en `data/sources` (canon C9: acción explícita y deliberada del usuario), con cuatro garantías: solo lo
 * marcado; cambio mínimo y localizado; copia de seguridad previa (`<fichero>.bak`, nunca sobrescrita); y
 * comprobación por huella: si el original ya no está tal cual en la fuente, no se escribe nada.
 */
import { applyReview } from '../../app/review';
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
}

export async function runApplyCommand(context: CliContext, options: ApplyOptions): Promise<number> {
  const result = await applyReview(context, { review: options.review, data: options.data, dryRun: options.dryRun, deleteReview: options.deleteReview });
  for (const file of result.ok ? result.outcome.written : result.written) {
    context.stdout(`Aplicado en ${file.path} (copia de seguridad: ${file.backup}): ${file.ids.join(', ')}\n`);
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
  context.stderr(`${pluralize(outcome.changes, 'cambio aplicado', 'cambios aplicados')} en ${pluralize(outcome.written.length, 'fichero', 'ficheros')} · recompila el artefacto con «cv build»\n`);
  return EXIT_OK;
}
