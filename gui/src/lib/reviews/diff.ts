/**
 * Diff por líneas (T-8.6 S3): el «antes y después» completo de cada fuente que una revisión va a modificar.
 * Subsecuencia común más larga sobre líneas, acotada para no cuadrar textos enormes (entonces se muestran
 * enteros, uno junto a otro, sin marcar).
 */
export type DiffKind = 'same' | 'removed' | 'added';

export interface DiffRow {
  readonly kind: DiffKind;
  readonly text: string;
  /** Número de línea en el «antes» (same/removed) o en el «después» (added). */
  readonly line: number;
}

/** Límite de líneas por lado para calcular la matriz (más allá, se devuelve sin diff). */
export const DIFF_MAX_LINES = 1500;

export function lineDiff(before: string, after: string): readonly DiffRow[] | undefined {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length > DIFF_MAX_LINES || b.length > DIFF_MAX_LINES) {
    return undefined;
  }
  const rows = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    const row = rows[i] as Uint32Array;
    const next = rows[i + 1] as Uint32Array;
    for (let j = b.length - 1; j >= 0; j -= 1) {
      row[j] = a[i] === b[j] ? (next[j + 1] as number) + 1 : Math.max(next[j] as number, row[j + 1] as number);
    }
  }
  const result: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push({ kind: 'same', text: a[i] as string, line: i + 1 });
      i += 1;
      j += 1;
    } else if (((rows[i + 1] as Uint32Array)[j] as number) >= ((rows[i] as Uint32Array)[j + 1] as number)) {
      result.push({ kind: 'removed', text: a[i] as string, line: i + 1 });
      i += 1;
    } else {
      result.push({ kind: 'added', text: b[j] as string, line: j + 1 });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) {
    result.push({ kind: 'removed', text: a[i] as string, line: i + 1 });
  }
  for (; j < b.length; j += 1) {
    result.push({ kind: 'added', text: b[j] as string, line: j + 1 });
  }
  return result;
}

export interface DiffSummary {
  readonly removed: number;
  readonly added: number;
}

export function diffSummary(rows: readonly DiffRow[]): DiffSummary {
  return { removed: rows.filter((row) => row.kind === 'removed').length, added: rows.filter((row) => row.kind === 'added').length };
}
