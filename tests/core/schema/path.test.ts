import { describe, expect, it } from 'vitest';

import { formatPath } from '../../../src/core/schema/path';

describe('formatPath', () => {
  it.each<[PropertyKey[], string]>([
    [[], ''],
    [['personal', 'email'], 'personal.email'],
    [['experience', 0, 'dates', 'end'], 'experience[0].dates.end'],
    [[0, 'x'], '[0].x'],
    [[Symbol('s')], 'Symbol(s)'],
  ])('formatea la ruta %#', (path, expected) => {
    expect(formatPath(path)).toBe(expected);
  });
});
