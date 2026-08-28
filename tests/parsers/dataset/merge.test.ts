import { describe, expect, it } from 'vitest';

import { mergeContributions } from '../../../src/parsers/dataset/merge';
import type { ProfileContribution } from '../../../src/parsers/dataset/types';

describe('mergeContributions', () => {
  it('concatena los arrays en orden y reubica la procedencia', () => {
    const result = mergeContributions([
      {
        file: 'a.md',
        contribution: { experience: [{ id: 'a', company: 'A', role: 'R', dates: { start: '2020' } }] },
        provenance: [{ path: ['experience', 0], file: 'a.md', line: 1 }],
      },
      {
        file: 'b.md',
        contribution: { experience: [{ id: 'b', company: 'B', role: 'R', dates: { start: '2021' } }] },
        provenance: [
          { path: ['experience', 0], file: 'b.md', line: 1 },
          { path: ['experience', 0, 'achievements', 1], file: 'b.md', line: 9 },
        ],
      },
    ]);
    expect(result.ok && result.profile.experience?.map((item) => item.id)).toEqual(['a', 'b']);
    expect(result.ok && result.provenance).toEqual([
      { path: ['experience', 0], file: 'a.md', line: 1 },
      { path: ['experience', 1], file: 'b.md', line: 1 },
      { path: ['experience', 1, 'achievements', 1], file: 'b.md', line: 9 },
    ]);
  });

  it('fusiona los objetos en profundidad, acepta escalares iguales y concatena arrays anidados', () => {
    const result = mergeContributions([
      {
        file: 'a.md',
        contribution: { meta: { schemaVersion: 1, locale: 'es-ES' }, personal: { fullName: 'Ada', links: [{ label: 'A', url: 'https://a' }] } },
        provenance: [{ path: ['personal'], file: 'a.md', line: 1 }],
      },
      {
        file: 'b.md',
        contribution: { meta: { schemaVersion: 1, updatedAt: '2026' }, personal: { fullName: 'Ada', links: [{ label: 'B', url: 'https://b' }] } },
        provenance: [{ path: ['personal', 'fullName'], file: 'b.md', line: 2 }],
      },
    ]);
    expect(result).toEqual({
      ok: true,
      profile: {
        meta: { schemaVersion: 1, locale: 'es-ES', updatedAt: '2026' },
        personal: {
          fullName: 'Ada',
          links: [
            { label: 'A', url: 'https://a' },
            { label: 'B', url: 'https://b' },
          ],
        },
      },
      provenance: [
        { path: ['personal'], file: 'a.md', line: 1 },
        { path: ['personal', 'fullName'], file: 'b.md', line: 2 },
      ],
    });
  });

  it('señala como conflicto un escalar definido con otro valor, citando el fichero original', () => {
    const result = mergeContributions([
      { file: 'a.md', contribution: { meta: { schemaVersion: 1, locale: 'es-ES' } }, provenance: [] },
      { file: 'b.md', contribution: { meta: { schemaVersion: 1, locale: 'en' } }, provenance: [] },
    ]);
    expect(result).toEqual({
      ok: false,
      errors: [{ file: 'b.md', message: 'meta.locale: valor ya definido en a.md con otro contenido' }],
    });
  });

  it('deja intacta la procedencia que apunta a una clave que el fichero no aporta', () => {
    const result = mergeContributions([
      { file: 'a.md', contribution: { achievements: [] }, provenance: [{ path: ['skills', 3], file: 'a.md', line: 2 }] },
    ]);
    expect(result.ok && result.provenance).toEqual([{ path: ['skills', 3], file: 'a.md', line: 2 }]);
  });

  it('ignora las claves con valor undefined', () => {
    const contribution = { experience: undefined } as unknown as ProfileContribution;
    const result = mergeContributions([{ file: 'a.md', contribution, provenance: [] }]);
    expect(result).toEqual({ ok: true, profile: {}, provenance: [] });
  });
});
