import type { SchemaPath } from '../../core/schema';
import type { Provenance } from './types';

function isPrefix(prefix: SchemaPath, path: SchemaPath): boolean {
  return prefix.length <= path.length && prefix.every((segment, index) => segment === path[index]);
}

/** Devuelve la procedencia más específica (prefijo más largo) que cubre la ruta indicada. */
export function resolveProvenance(path: SchemaPath, entries: readonly Provenance[]): Provenance | undefined {
  let best: Provenance | undefined;
  for (const entry of entries) {
    if (isPrefix(entry.path, path) && (best === undefined || entry.path.length > best.path.length)) {
      best = entry;
    }
  }
  return best;
}
