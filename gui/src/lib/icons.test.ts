import { describe, expect, it } from 'vitest';

import { ICONS } from './icons';

describe('ICONS', () => {
  it('todos los iconos tienen al menos un trazo y solo comandos de path', () => {
    for (const [name, paths] of Object.entries(ICONS)) {
      expect(paths.length, name).toBeGreaterThan(0);
      for (const d of paths) {
        expect(d, name).toMatch(/^[MmLlHhVvAaCcZz0-9 .,-]+$/);
      }
    }
  });
});
