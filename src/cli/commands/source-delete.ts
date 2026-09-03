/**
 * `cv sources delete <ruta>` (T-9.25): cliente del caso de uso `deleteSource`. Borra un fichero de
 * `data/sources/` diciendo antes qué entradas del perfil desaparecen con él, negándose si lo que queda no
 * carga y dejando el fichero entero en el histórico, de donde `cv history restore` lo devuelve.
 */
import { resolve } from 'node:path';

import { dataError } from '../../app/errors';
import { deleteSource, describeRemoved } from '../../app/source-delete';
import type { CliContext } from '../context';
import { EXIT_OK, reportError } from '../output';

export interface DeleteSourceOptions {
  /** Directorio de fuentes; commander siempre lo da (su valor por defecto es `data/sources`). */
  readonly data: string;
  readonly dryRun?: boolean | undefined;
  /** Acepta por adelantado; sin terminal es obligatorio, porque borrar no se supone. */
  readonly yes?: boolean | undefined;
}

export async function runSourceDelete(context: CliContext, path: string, options: DeleteSourceOptions): Promise<number> {
  const root = resolve(context.cwd, options.data);
  const plan = await deleteSource(context, root, { path, dryRun: true });
  if (!plan.ok) {
    return reportError(context, plan.error);
  }
  context.stdout(`Borrar ${path} quita ${describeRemoved(plan.outcome.removed)}\n`);
  if (options.dryRun === true) {
    context.stderr('Ejecución en seco: no se ha borrado nada\n');
    return EXIT_OK;
  }
  // Borrar es la escritura menos reversible del producto: se pregunta siempre, y sin terminal NO se supone que
  // sí —al revés que en `suggest tags --apply`, donde lo que se decide es añadir—: hay que decirlo con --yes.
  if (options.yes !== true) {
    if (context.confirm === undefined) {
      return reportError(context, dataError(`Sin terminal interactiva, borrar exige «--yes»: no se ha borrado «${path}»`));
    }
    if (!(await context.confirm(`¿Borrar «${path}»?`))) {
      context.stderr('Cancelado: no se ha borrado nada\n');
      return EXIT_OK;
    }
  }
  const result = await deleteSource(context, root, { path });
  if (!result.ok) {
    return reportError(context, result.error);
  }
  context.stdout(`Borrada ${path} (${result.outcome.bytes} bytes)\n`);
  context.stderr(`La versión anterior queda en el histórico: «cv history restore latest ${path}» la devuelve · recompila el artefacto con «cv build»\n`);
  return EXIT_OK;
}
