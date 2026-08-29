/**
 * Comparación de artefactos para el arnés de aceptación determinista (T-5.5.2): coincidencia
 * perfecta o una explicación legible de la diferencia. Texto y JSON se comparan byte a byte y,
 * si difieren, se muestra un diff por líneas; los PDF se comparan byte a byte y, si difieren, se
 * extrae su texto para enseñar qué cambió (además de tamaño y páginas). Sin dependencias.
 */
import { extractPdfText } from '../../src/pdf';

export interface Mismatch {
  readonly what: string;
  readonly detail: string;
}

type Operation = readonly [kind: ' ' | '-' | '+', line: string];

/** Operaciones de un diff por líneas (LCS clásico; para textos grandes, solo la primera diferencia). */
export function diffOperations(expected: readonly string[], actual: readonly string[]): Operation[] {
  const n = expected.length;
  const m = actual.length;
  if (n * m > 4_000_000) {
    const first = expected.findIndex((line, index) => line !== actual[index]);
    const at = first === -1 ? Math.min(n, m) : first;
    return [
      [' ', `… (textos demasiado largos para un diff completo; primera diferencia en la línea ${at + 1})`],
      ['-', expected[at] ?? '<fin>'],
      ['+', actual[at] ?? '<fin>'],
    ];
  }
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] = expected[i] === actual[j] ? (table[(i + 1) * width + j + 1] ?? 0) + 1 : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }
  const operations: Operation[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (expected[i] === actual[j]) {
      operations.push([' ', expected[i] ?? '']);
      i += 1;
      j += 1;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      operations.push(['-', expected[i] ?? '']);
      i += 1;
    } else {
      operations.push(['+', actual[j] ?? '']);
      j += 1;
    }
  }
  for (; i < n; i += 1) {
    operations.push(['-', expected[i] ?? '']);
  }
  for (; j < m; j += 1) {
    operations.push(['+', actual[j] ?? '']);
  }
  return operations;
}

/** Diff por líneas con contexto (`-` esperado, `+` obtenido), acotado a `maxLines` líneas. */
export function lineDiff(expected: string, actual: string, context = 2, maxLines = 60): string {
  const operations = diffOperations(expected.split('\n'), actual.split('\n'));
  const keep = new Set<number>();
  operations.forEach(([kind], index) => {
    if (kind !== ' ') {
      for (let k = Math.max(0, index - context); k <= Math.min(operations.length - 1, index + context); k += 1) {
        keep.add(k);
      }
    }
  });
  const lines: string[] = [];
  let previous = -1;
  for (const index of [...keep].sort((a, b) => a - b)) {
    if (previous !== -1 && index !== previous + 1) {
      lines.push('  …');
    }
    const [kind, line] = operations[index] ?? [' ', ''];
    lines.push(`${kind} ${line}`);
    previous = index;
  }
  if (lines.length > maxLines) {
    return `${lines.slice(0, maxLines).join('\n')}\n  … (${lines.length - maxLines} líneas más)`;
  }
  return lines.join('\n');
}

export function compareText(what: string, expected: string, actual: string): Mismatch | undefined {
  if (expected === actual) {
    return undefined;
  }
  return { what, detail: lineDiff(expected, actual) };
}

export function compareBytes(what: string, expected: Uint8Array, actual: Uint8Array): Mismatch | undefined {
  if (expected.byteLength === actual.byteLength && Buffer.from(expected).equals(Buffer.from(actual))) {
    return undefined;
  }
  return { what, detail: `${expected.byteLength} bytes esperados, ${actual.byteLength} obtenidos` };
}

/** PDF: bytes idénticos o, si no, la diferencia en texto, páginas y tamaño. */
export async function comparePdf(what: string, expected: Uint8Array, actual: Uint8Array): Promise<Mismatch | undefined> {
  const bytes = compareBytes(what, expected, actual);
  if (bytes === undefined) {
    return undefined;
  }
  const [before, after] = await Promise.all([extractPdfText(Buffer.from(expected)), extractPdfText(Buffer.from(actual))]);
  const describe = (result: Awaited<ReturnType<typeof extractPdfText>>, size: number): string => (result.ok ? `${result.pages} página(s), ${size} bytes` : `texto ilegible (${result.message}), ${size} bytes`);
  const header = `${bytes.detail}; esperado: ${describe(before, expected.byteLength)}; obtenido: ${describe(after, actual.byteLength)}`;
  if (before.ok && after.ok) {
    return { what, detail: before.text === after.text ? `${header}\n  (el texto extraído es idéntico: difieren solo los bytes)` : `${header}\n${lineDiff(before.text, after.text)}` };
  }
  return { what, detail: header };
}
