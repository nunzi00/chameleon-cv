import { describe, expect, it } from 'vitest';

import { resolveProvenance } from '../../../src/parsers/dataset/provenance';
import type { Provenance } from '../../../src/parsers/dataset/types';

const entries: readonly Provenance[] = [
  { path: ['experience', 0, 'achievements', 2], file: 'acme.md', line: 20 },
  { path: ['experience', 0], file: 'acme.md', line: 1 },
  { path: ['experience', 1], file: 'startup.md', line: 1 },
  { path: ['personal'], file: 'profile.md', line: 1 },
];

describe('resolveProvenance', () => {
  it('elige el prefijo más largo, independientemente del orden', () => {
    expect(resolveProvenance(['experience', 0, 'achievements', 2, 'id'], entries)?.line).toBe(20);
    expect(resolveProvenance(['experience', 0, 'company'], entries)?.line).toBe(1);
    expect(resolveProvenance(['experience', 1], entries)?.file).toBe('startup.md');
    expect(resolveProvenance(['personal', 'email'], entries)?.file).toBe('profile.md');
  });

  it('devuelve undefined si nada cubre la ruta', () => {
    expect(resolveProvenance(['skills', 0], entries)).toBeUndefined();
    expect(resolveProvenance([], entries)).toBeUndefined();
  });
});
