/**
 * Deshacer lo que una revisión escribió en las fuentes (T-9.24, encargo del PO: «restaurar los cambios
 * aplicados»). No hay estado nuevo que inventar: `cv improve apply` ya deja en el histórico de fuentes
 * (T-8.10) una entrada `apply` con el fichero entero de cada fuente **tal como estaba antes**, y su `origin`
 * es el nombre de la revisión. Deshacer es, por tanto, encontrar esa entrada y devolver sus ficheros.
 *
 * Tres decisiones que hacen que esto sea seguro y no un botón de pánico:
 * 1. **Se deshace la última aplicación de esa revisión**, no «lo último que pasó»: si entre medias se aplicó
 *    otra revisión a otro fichero, esa se queda como está.
 * 2. **Devolver también se guarda**: la versión que había justo antes de deshacer entra en el histórico como
 *    una entrada `restore`, así que deshacer el deshacer es posible. Nunca se pierde nada (C9).
 * 3. **La revisión vuelve de las archivadas**: si sus cambios ya no están en las fuentes, vuelve a estar
 *    pendiente, y esconderla en el archivo diría lo contrario.
 */
import type { AppContext } from './context';
import { dataError, unsafePathError, type AppError } from './errors';
import { REVIEW_NAME, setReviewArchived } from './review';
import { readSourceHistory, restoreSourceEntry, type SourceHistoryEntry } from './source-history';

export interface UndoRequest {
  /** Directorio de las revisiones (`output`), no el de las archivadas. */
  readonly directory: string;
  /** Nombre del fichero de revisión (`revision-improve-….md`). */
  readonly name: string;
  readonly at?: Date | undefined;
}

export interface UndoOutcome {
  readonly name: string;
  /** La aplicación que se deshace. */
  readonly applied: SourceHistoryEntry;
  /** Fuentes devueltas a como estaban antes de aplicarla (rutas relativas al directorio de fuentes). */
  readonly restored: readonly string[];
  /** Fuentes que ya estaban como antes: no se han tocado (deshacer dos veces no cambia nada). */
  readonly unchanged: readonly string[];
  /** La entrada nueva del histórico con lo que había justo antes de deshacer; ausente si no había nada que devolver. */
  readonly entry: SourceHistoryEntry | undefined;
  /** Dónde ha vuelto la revisión si estaba archivada; ausente si no lo estaba o si ya no existe el fichero. */
  readonly unarchived: string | undefined;
}

export type UndoResult = { readonly ok: true; readonly outcome: UndoOutcome } | { readonly ok: false; readonly error: AppError };

/** La última aplicación de esa revisión que guarda el histórico. */
export function findApplyEntry(entries: readonly SourceHistoryEntry[], name: string): SourceHistoryEntry | undefined {
  return entries.find((entry) => entry.action === 'apply' && entry.origin === name);
}

export async function undoReviewApply(context: AppContext, request: UndoRequest): Promise<UndoResult> {
  if (!REVIEW_NAME.test(request.name)) {
    return { ok: false, error: unsafePathError(`Nombre de revisión no válido «${request.name}»: se espera revision-<…>.md, sin directorios`) };
  }
  const applied = findApplyEntry(await readSourceHistory(context), request.name);
  if (applied === undefined) {
    return { ok: false, error: dataError(`El histórico no guarda ninguna aplicación de «${request.name}»: no hay nada que deshacer`) };
  }
  const restored = await restoreSourceEntry(context, applied.id, request.at ?? context.now?.());
  if (!restored.ok) {
    return { ok: false, error: restored.error };
  }
  // La revisión vuelve a la vista aunque no hubiera nada que devolver: lo que se afirma es que está pendiente.
  const moved = await setReviewArchived(context, request.directory, request.name, false);
  return {
    ok: true,
    outcome: {
      name: request.name,
      applied,
      restored: restored.restored,
      unchanged: restored.unchanged,
      entry: restored.entry,
      // Si la revisión ya no existe (se eliminó tras aplicarla), deshacer sigue valiendo: lo que importa son las fuentes.
      unarchived: moved.ok && moved.moved ? moved.path : undefined,
    },
  };
}
