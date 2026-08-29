import { describe, expect, it } from 'vitest';

import { changelogSections, releaseNotes } from '../../src/release/changelog';

const CHANGELOG = `# Registro de cambios

Preámbulo.

## [Unreleased]

## [1.0.0] - 2026-08-29

Primera versión.

### Añadido

- Una cosa.

## [0.9.0] - 2026-08-20
### Corregido
- Otra.

[Unreleased]: https://example.test/compare/v1.0.0...HEAD
[1.0.0]: https://example.test/releases/tag/v1.0.0
`;

describe('changelogSections', () => {
  it('separa las secciones «## [versión] - fecha», sin el preámbulo ni las definiciones de enlace del pie', () => {
    expect(changelogSections(CHANGELOG)).toEqual([
      { version: 'Unreleased', date: undefined, body: '' },
      { version: '1.0.0', date: '2026-08-29', body: 'Primera versión.\n\n### Añadido\n\n- Una cosa.' },
      { version: '0.9.0', date: '2026-08-20', body: '### Corregido\n- Otra.' },
    ]);
  });

  it('admite finales de línea CRLF y un fichero sin secciones', () => {
    expect(changelogSections('# Título\r\n\r\n## [1.0.0] - 2026-01-01\r\n\r\nCuerpo.\r\n')).toEqual([{ version: '1.0.0', date: '2026-01-01', body: 'Cuerpo.' }]);
    expect(changelogSections('# Título\n')).toEqual([]);
  });
});

describe('releaseNotes', () => {
  it('devuelve el cuerpo y la fecha de la versión pedida', () => {
    expect(releaseNotes(CHANGELOG, '1.0.0')).toEqual({ ok: true, date: '2026-08-29', notes: 'Primera versión.\n\n### Añadido\n\n- Una cosa.' });
  });

  it('falla si la sección no existe (y enumera las presentes), si no lleva fecha ISO o si está vacía', () => {
    expect(releaseNotes(CHANGELOG, '2.0.0')).toEqual({ ok: false, message: 'CHANGELOG.md no tiene la sección «## [2.0.0]» (secciones presentes: Unreleased, 1.0.0, 0.9.0)' });
    expect(releaseNotes('# Nada\n', '1.0.0')).toEqual({ ok: false, message: 'CHANGELOG.md no tiene la sección «## [1.0.0]»' });
    expect(releaseNotes(CHANGELOG, 'Unreleased')).toEqual({ ok: false, message: 'la sección «## [Unreleased]» de CHANGELOG.md no lleva fecha: se espera «## [Unreleased] - AAAA-MM-DD»' });
    expect(releaseNotes('## [1.0.0] - mañana\n\nCuerpo.\n', '1.0.0')).toEqual({ ok: false, message: 'la sección «## [1.0.0]» de CHANGELOG.md no lleva fecha: se espera «## [1.0.0] - AAAA-MM-DD»' });
    expect(releaseNotes('## [1.0.0] - 2026-08-29\n\n[1.0.0]: https://example.test\n', '1.0.0')).toEqual({ ok: false, message: 'la sección «## [1.0.0]» de CHANGELOG.md está vacía' });
  });
});
