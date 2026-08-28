import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { DatasetError } from '../../../src/parsers/dataset/types';
import { coerceInteger, parseProfileFile } from '../../../src/parsers/markdown/profile';

const FIXTURE = readFileSync(join(__dirname, '../../fixtures/dataset/profile.md'), 'utf8');

function expectErrors(source: string): readonly DatasetError[] {
  const result = parseProfileFile(source, 'profile.md');
  if (result.ok) {
    throw new Error('Se esperaban errores');
  }
  return result.errors;
}

describe('parseProfileFile', () => {
  it('reparte el frontmatter plano entre meta, personal e idiomas y toma el resumen del cuerpo', () => {
    const result = parseProfileFile(FIXTURE, 'profile.md');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.contribution).toEqual({
      meta: { schemaVersion: 1, locale: 'es-ES', updatedAt: '2026-08-28' },
      personal: {
        fullName: 'Ada Ejemplo',
        headline: 'Ingeniera de software',
        email: 'ada@example.com',
        phone: '+34 600 000 000',
        location: { city: 'Madrid', region: 'Comunidad de Madrid', country: 'España' },
        links: [
          { label: 'GitHub', url: 'https://github.com/ada-ejemplo' },
          { label: 'LinkedIn', url: 'https://www.linkedin.com/in/ada-ejemplo' },
        ],
        summary: 'Ingeniera de software con **10 años** construyendo plataformas de pago.\n\nResumen por defecto en dos párrafos.',
      },
      languages: [
        { name: 'Español', level: 'native' },
        { name: 'Inglés', level: 'C1' },
      ],
    });
    expect(result.provenance).toEqual(
      expect.arrayContaining([
        { path: ['meta'], file: 'profile.md', line: 1 },
        { path: ['personal'], file: 'profile.md', line: 1 },
        { path: ['personal', 'email'], file: 'profile.md', line: 7 },
        { path: ['personal', 'summary'], file: 'profile.md', line: 23 },
        { path: ['languages', 1], file: 'profile.md', line: 20 },
      ]),
    );
  });

  it('aplica los valores por defecto con el mínimo imprescindible', () => {
    const result = parseProfileFile('---\nfullName: Ada\n---\n', 'profile.md');
    expect(result.ok && result.contribution).toEqual({
      meta: { schemaVersion: 1 },
      personal: { fullName: 'Ada', links: [] },
      languages: [],
    });
  });

  it('convierte schemaVersion a entero y rechaza versiones no soportadas', () => {
    expect(expectErrors('---\nschemaVersion: 2\nfullName: Ada\n---\n')).toEqual([
      { file: 'profile.md', line: 2, message: expect.stringMatching(/^schemaVersion: Versión de esquema no soportada/) },
    ]);
    expect(expectErrors('---\nschemaVersion: dos\nfullName: Ada\n---\n')[0]).toMatchObject({ line: 2 });
  });

  it('no admite secciones y exige el frontmatter (ambos errores a la vez)', () => {
    expect(expectErrors('Texto\n\n## Foo\n')).toEqual([
      { file: 'profile.md', line: 3, message: 'Sección «## Foo» no admitida: profile.md no lleva secciones' },
      { file: 'profile.md', line: 1, message: 'Falta el frontmatter: profile.md debe empezar por un bloque «---» con los datos personales' },
    ]);
  });

  it('rechaza las claves reservadas y anidadas con una pista', () => {
    expect(expectErrors('---\nfullName: Ada\nsummary: x\nmeta: {}\npersonal: {}\n---\n').map((error) => `${error.line}: ${error.message}`)).toEqual([
      '3: summary: clave no admitida; el resumen se escribe en el cuerpo del fichero',
      '4: meta: clave no admitida; usa las claves planas schemaVersion, locale y updatedAt',
      '5: personal: clave no admitida; los datos personales van como claves planas (fullName, email…)',
    ]);
  });

  it('reporta juntos los errores de meta, personal e idiomas, cada uno en su línea', () => {
    const errors = expectErrors('---\nlocale: spanish\nfullName: Ada\nemail: nope\nlanguages:\n  - { name: Élfico, level: Z9 }\n---\n');
    expect(errors).toEqual([
      { file: 'profile.md', line: 2, message: expect.stringMatching(/^locale: Locale inválido/) },
      { file: 'profile.md', line: 4, message: 'email: Email inválido' },
      { file: 'profile.md', line: 6, message: expect.stringMatching(/^languages\[0\]\.level: /) },
    ]);
  });

  it('reporta solo los errores de la parte que falla', () => {
    expect(expectErrors('---\nfullName: Ada\nemail: nope\n---\n')).toEqual([{ file: 'profile.md', line: 3, message: 'email: Email inválido' }]);
  });

  it('propaga los errores YAML junto con los de secciones', () => {
    const errors = expectErrors('---\na: 1\na: 2\n---\n\n## Foo\n');
    expect(errors.map((error) => error.line)).toEqual([6, 3]);
  });

  it('propaga los errores de estructura del documento', () => {
    expect(expectErrors('---\nfullName: Ada\n---\n\n# Título\n')[0]?.message).toContain('Encabezado de nivel 1');
  });
});

describe('coerceInteger', () => {
  it('solo convierte cadenas de dígitos', () => {
    expect(coerceInteger('12')).toBe(12);
    expect(coerceInteger('1.5')).toBe('1.5');
    expect(coerceInteger(['1'])).toEqual(['1']);
  });
});
