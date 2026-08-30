import { describe, expect, it } from 'vitest';

import { DIFF_MAX_LINES, diffSummary, lineDiff } from './diff';

describe('lineDiff', () => {
  it('marca las líneas cambiadas y conserva las iguales con su número', () => {
    const rows = lineDiff('a\nb\nc\nd', 'a\nB\nc\nd\ne');
    expect(rows).toEqual([
      { kind: 'same', text: 'a', line: 1 },
      { kind: 'removed', text: 'b', line: 2 },
      { kind: 'added', text: 'B', line: 2 },
      { kind: 'same', text: 'c', line: 3 },
      { kind: 'same', text: 'd', line: 4 },
      { kind: 'added', text: 'e', line: 5 },
    ]);
    expect(diffSummary(rows ?? [])).toEqual({ removed: 1, added: 2 });
  });

  it('textos iguales no tienen cambios; un borrado al final y un añadido al principio se ven', () => {
    expect(diffSummary(lineDiff('x\ny', 'x\ny') ?? [])).toEqual({ removed: 0, added: 0 });
    expect(lineDiff('x\ny\nz', 'x\ny')?.map((row) => row.kind)).toEqual(['same', 'same', 'removed']);
    expect(lineDiff('y', 'w\ny')?.map((row) => row.kind)).toEqual(['added', 'same']);
    expect(lineDiff('', 'nuevo')?.map((row) => `${row.kind}:${row.text}`)).toEqual(['removed:', 'added:nuevo']);
  });

  it('por encima del límite de líneas no calcula nada', () => {
    const huge = Array.from({ length: DIFF_MAX_LINES + 1 }, (_, index) => `l${index}`).join('\n');
    expect(lineDiff(huge, 'a')).toBeUndefined();
    expect(lineDiff('a', huge)).toBeUndefined();
  });
});
