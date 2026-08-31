/**
 * Fusión de las contribuciones de los ficheros (`docs/arquitectura.md` §2.3): los arrays
 * se concatenan en orden de documento, los objetos se fusionan en profundidad y que dos
 * fuentes fijen el mismo escalar con valores distintos es un conflicto, nunca «gana la última».
 */
import { formatPath, type SchemaPath } from '../../core/schema';
import { isPlainObject } from '../shared/objects';
import type { DatasetError, ProfileContribution, Provenance } from './types';

export interface ContributionSource {
  readonly file: string;
  readonly contribution: ProfileContribution;
  readonly provenance: readonly Provenance[];
}

export type MergeResult =
  | { readonly ok: true; readonly profile: ProfileContribution; readonly provenance: readonly Provenance[] }
  | { readonly ok: false; readonly errors: readonly DatasetError[] };

function mergeInto(
  target: Record<string, unknown>,
  incoming: Record<string, unknown>,
  path: SchemaPath,
  targetFile: string,
  incomingFile: string,
  errors: DatasetError[],
): void {
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) {
      continue;
    }
    const current = target[key];
    const keyPath = [...path, key];
    if (current === undefined) {
      target[key] = value;
    } else if (Array.isArray(current) && Array.isArray(value)) {
      target[key] = [...current, ...value];
    } else if (isPlainObject(current) && isPlainObject(value)) {
      mergeInto(current, value, keyPath, targetFile, incomingFile, errors);
    } else if (!Object.is(current, value)) {
      errors.push({
        file: incomingFile,
        message: `${formatPath(keyPath)}: valor ya definido en ${targetFile} con otro contenido`,
      });
    }
  }
}

/** Reubica la procedencia de un fichero según la posición que ocupan sus arrays en el perfil fusionado. */
function rebaseProvenance(provenance: readonly Provenance[], offsets: ReadonlyMap<string, number>): Provenance[] {
  return provenance.map((entry) => {
    const [head, index, ...rest] = entry.path;
    if (typeof index !== 'number') {
      return entry;
    }
    const offset = offsets.get(String(head)) ?? 0;
    return { ...entry, path: [head as PropertyKey, index + offset, ...rest] };
  });
}

/** Primer fichero que aportó una clave de nivel superior; lo reclama si nadie lo hizo antes. */
function claimOwner(owners: Map<string, string>, key: string, file: string): string {
  const existing = owners.get(key);
  if (existing !== undefined) {
    return existing;
  }
  owners.set(key, file);
  return file;
}

export function mergeContributions(sources: readonly ContributionSource[]): MergeResult {
  const merged: Record<string, unknown> = {};
  const owners = new Map<string, string>();
  const provenance: Provenance[] = [];
  const errors: DatasetError[] = [];

  for (const source of sources) {
    const offsets = new Map<string, number>();
    for (const [key, value] of Object.entries(source.contribution)) {
      const current = merged[key];
      offsets.set(key, Array.isArray(current) ? current.length : 0);
      const owner = claimOwner(owners, key, source.file);
      mergeInto(merged, { [key]: value }, [], owner, source.file, errors);
    }
    provenance.push(...rebaseProvenance(source.provenance, offsets));
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, profile: merged, provenance };
}
