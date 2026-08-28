import { describe, expect, it } from 'vitest';

import {
  collectIds,
  findDuplicateIds,
  formatPath,
  MASTER_PROFILE_SCHEMA_VERSION,
  validateMasterProfile,
  type MasterProfile,
  type ValidationIssue,
} from '../../../src/core/schema';
import { fullProfileInput, minimalProfileInput } from '../../fixtures/master-profile';

const BEL = String.fromCharCode(7);
const NUL = String.fromCharCode(0);

function expectValid(input: unknown): MasterProfile {
  const result = validateMasterProfile(input);
  if (!result.ok) {
    throw new Error(`Se esperaba un perfil válido:\n${JSON.stringify(result.issues, null, 2)}`);
  }
  return result.profile;
}

function expectIssues(input: unknown): readonly ValidationIssue[] {
  const result = validateMasterProfile(input);
  if (result.ok) {
    throw new Error('Se esperaba un perfil inválido');
  }
  return result.issues;
}

/** Perfil mínimo (sin tipar a propósito: aquí se construyen entradas deliberadamente malformadas). */
const profile = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  personal: { fullName: 'Ada Ejemplo' },
  ...extra,
});

const experience = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'exp-1',
  company: 'ACME',
  role: 'Dev',
  dates: { start: '2020' },
  ...overrides,
});

describe('MasterProfileSchema: perfiles válidos', () => {
  it('acepta el perfil mínimo y aplica los valores por defecto', () => {
    expect(expectValid(minimalProfileInput())).toEqual({
      meta: { schemaVersion: MASTER_PROFILE_SCHEMA_VERSION },
      personal: { fullName: 'Ada Ejemplo', links: [] },
      specialties: [],
      experience: [],
      projects: [],
      education: [],
      skills: [],
      achievements: [],
      certifications: [],
      languages: [],
    });
  });

  it('acepta el perfil completo, recorta el texto y normaliza tags, alias y tecnologías', () => {
    const result = expectValid(fullProfileInput());

    expect(result.meta).toEqual({ schemaVersion: 1, locale: 'es-ES', updatedAt: '2026-08-28' });
    expect(result.personal.fullName).toBe('Ada Ejemplo');
    expect(result.personal.summary).toBe('Primera línea.\nSegunda línea con\ttabulador.');
    expect(result.personal.links).toEqual([{ label: 'GitHub', url: 'https://github.com/ada-ejemplo' }]);
    expect(result.specialties[0]?.tags).toEqual(['php', 'node.js', 'kubernetes']);

    const acme = result.experience[0];
    expect(acme?.tags).toEqual(['php', 'symfony']);
    expect(acme?.technologies).toEqual(['PHP 8', 'Symfony']);
    expect(acme?.achievements[0]?.tags).toEqual(['performance', 'php']);
    expect(result.experience[1]).toEqual({
      id: 'exp-current',
      company: 'Startup',
      role: 'Tech Lead',
      dates: { start: '2024-07' },
      technologies: [],
      achievements: [],
      tags: [],
    });

    expect(result.skills[0]?.aliases).toEqual(['k8s']);
    expect(result.skills[1]).toEqual({ id: 'skill-php', name: 'PHP', category: 'other', aliases: [], tags: [] });
    expect(result.languages).toEqual([
      { name: 'Español', level: 'native' },
      { name: 'Inglés', level: 'C1' },
    ]);
  });

  it('admite periodos en curso y periodos ordenados con distinta granularidad', () => {
    expectValid(profile({ experience: [experience({ dates: { start: '2020-06', end: '2020' } })] }));
    expectValid(profile({ education: [{ id: 'edu', institution: 'U', degree: 'D', dates: { start: '2010' } }] }));
  });

  it('acepta los símbolos habituales en tags', () => {
    const result = expectValid(profile({ skills: [{ id: 'cpp', name: 'C++', tags: ['C++', 'c#', '.NET', 'ci/cd'] }] }));
    expect(result.skills[0]?.tags).toEqual(['c++', 'c#', '.net', 'ci/cd']);
  });
});

describe('MasterProfileSchema: rechazos', () => {
  const cases: Array<[string, unknown, string, string | undefined]> = [
    ['nombre en blanco', profile({ personal: { fullName: '   ' } }), 'personal.fullName', undefined],
    ['nombre demasiado largo', profile({ personal: { fullName: 'a'.repeat(121) } }), 'personal.fullName', undefined],
    [
      'carácter de control en texto de una línea',
      profile({ personal: { fullName: `Ada${BEL}` } }),
      'personal.fullName',
      'caracteres de control',
    ],
    [
      'salto de línea en texto de una línea',
      profile({ personal: { fullName: 'Ada\nEjemplo' } }),
      'personal.fullName',
      'caracteres de control',
    ],
    [
      'carácter de control en texto multilínea',
      profile({ personal: { fullName: 'Ada', summary: `ok${NUL}` } }),
      'personal.summary',
      'caracteres de control',
    ],
    ['email inválido', profile({ personal: { fullName: 'Ada', email: 'nope' } }), 'personal.email', 'Email inválido'],
    ['teléfono inválido', profile({ personal: { fullName: 'Ada', phone: 'llámame' } }), 'personal.phone', 'Teléfono inválido'],
    [
      'URL con esquema javascript:',
      profile({ personal: { fullName: 'Ada', links: [{ label: 'x', url: 'javascript:alert(1)' }] } }),
      'personal.links[0].url',
      'URL inválida',
    ],
    [
      'URL con esquema ftp:',
      profile({ personal: { fullName: 'Ada', links: [{ label: 'x', url: 'ftp://example.com/f' }] } }),
      'personal.links[0].url',
      'URL inválida',
    ],
    [
      'URL que no lo es',
      profile({ personal: { fullName: 'Ada', links: [{ label: 'x', url: 'no es una url' }] } }),
      'personal.links[0].url',
      'URL inválida',
    ],
    ['ubicación sin ciudad', profile({ personal: { fullName: 'Ada', location: { country: 'España' } } }), 'personal.location.city', undefined],
    ['clave desconocida en la raíz', profile({ foo: 1 }), '', 'foo'],
    ['clave desconocida en una experiencia', profile({ experience: [experience({ compnay: 'typo' })] }), 'experience[0]', 'compnay'],
    ['id con mayúsculas y espacios', profile({ experience: [experience({ id: 'Exp Acme' })] }), 'experience[0].id', 'Identificador inválido'],
    ['tag con símbolos no admitidos', profile({ experience: [experience({ tags: ['php!'] })] }), 'experience[0].tags[0]', 'Etiqueta inválida'],
    ['alias con símbolos no admitidos', profile({ skills: [{ id: 'k8s', name: 'K', aliases: ['k8s?'] }] }), 'skills[0].aliases[0]', 'Alias inválido'],
    [
      'demasiadas tags',
      profile({ experience: [experience({ tags: Array.from({ length: 51 }, (_, index) => `t${index}`) })] }),
      'experience[0].tags',
      undefined,
    ],
    ['fecha de inicio inexistente', profile({ experience: [experience({ dates: { start: '2020-13' } })] }), 'experience[0].dates.start', 'Fecha inválida'],
    ['fin anterior al inicio (año/mes)', profile({ experience: [experience({ dates: { start: '2021', end: '2020-12' } })] }), 'experience[0].dates.end', 'anterior'],
    [
      'fin anterior al inicio (día)',
      profile({ projects: [{ id: 'p', name: 'P', dates: { start: '2020-06-15', end: '2020-06-14' } }] }),
      'projects[0].dates.end',
      'anterior',
    ],
    ['fecha de logro inexistente', profile({ achievements: [{ id: 'a', text: 'T', date: '2023-02-29' }] }), 'achievements[0].date', 'Fecha inválida'],
    ['años de experiencia negativos', profile({ skills: [{ id: 's', name: 'K', years: -1 }] }), 'skills[0].years', undefined],
    ['años de experiencia no enteros', profile({ skills: [{ id: 's', name: 'K', years: 2.5 }] }), 'skills[0].years', undefined],
    ['años de experiencia desmesurados', profile({ skills: [{ id: 's', name: 'K', years: 61 }] }), 'skills[0].years', undefined],
    ['categoría de skill desconocida', profile({ skills: [{ id: 's', name: 'K', category: 'wizardry' }] }), 'skills[0].category', undefined],
    ['nivel de skill desconocido', profile({ skills: [{ id: 's', name: 'K', level: 'ninja' }] }), 'skills[0].level', undefined],
    ['nivel de idioma desconocido', profile({ languages: [{ name: 'Élfico', level: 'Z9' }] }), 'languages[0].level', undefined],
    ['versión de esquema no soportada', profile({ meta: { schemaVersion: 2 } }), 'meta.schemaVersion', 'Versión de esquema no soportada'],
    ['locale inválido', profile({ meta: { schemaVersion: 1, locale: 'spanish' } }), 'meta.locale', 'Locale inválido'],
    ['URL de certificación inválida', profile({ certifications: [{ id: 'c', name: 'C', url: 'mailto:x@example.com' }] }), 'certifications[0].url', 'URL inválida'],
    ['especialidad sin título', profile({ specialties: [{ id: 'backend' }] }), 'specialties[0].title', undefined],
    ['sección personal ausente', {}, 'personal', undefined],
    ['raíz que no es un objeto (null)', null, '', undefined],
    ['raíz que no es un objeto (número)', 42, '', undefined],
  ];

  it.each(cases)('%s', (_description, input, path, fragment) => {
    const issues = expectIssues(input);
    const issue = issues.find((candidate) => candidate.path === path);
    expect(issue, `rutas con problemas: ${issues.map((candidate) => candidate.path).join(', ') || '(ninguna)'}`).toBeDefined();
    if (fragment !== undefined) {
      expect(issue?.message).toContain(fragment);
    }
  });

  it('no evalúa el orden del periodo cuando una de las fechas es inválida', () => {
    const startInvalid = expectIssues(profile({ experience: [experience({ dates: { start: 'ayer', end: '2020' } })] }));
    expect(startInvalid.map((issue) => issue.path)).toEqual(['experience[0].dates.start']);

    const endInvalid = expectIssues(profile({ experience: [experience({ dates: { start: '2020', end: 'mañana' } })] }));
    expect(endInvalid.map((issue) => issue.path)).toEqual(['experience[0].dates.end']);
  });
});

describe('unicidad de identificadores', () => {
  it('rechaza un id repetido entre colecciones e indica dónde apareció por primera vez', () => {
    const issues = expectIssues(profile({ experience: [experience({ id: 'dup' })], projects: [{ id: 'dup', name: 'P' }] }));
    expect(issues).toEqual([
      { path: 'projects[0].id', message: 'Identificador duplicado "dup": ya se usa en experience[0].id' },
    ]);
  });

  it('rechaza un logro anidado cuyo id coincide con el de otro ítem', () => {
    const issues = expectIssues(profile({ experience: [experience({ id: 'exp-1', achievements: [{ id: 'exp-1', text: 'T' }] })] }));
    expect(issues).toEqual([
      { path: 'experience[0].achievements[0].id', message: 'Identificador duplicado "exp-1": ya se usa en experience[0].id' },
    ]);
  });

  it('collectIds recorre el perfil en orden de documento', () => {
    const occurrences = collectIds(expectValid(fullProfileInput())).map((occurrence) => `${occurrence.id}@${formatPath(occurrence.path)}`);
    expect(occurrences).toEqual([
      'backend@specialties[0].id',
      'exp-acme@experience[0].id',
      'ach-acme-latency@experience[0].achievements[0].id',
      'exp-current@experience[1].id',
      'proj-cli@projects[0].id',
      'edu-uni@education[0].id',
      'skill-kubernetes@skills[0].id',
      'skill-php@skills[1].id',
      'ach-talk@achievements[0].id',
      'cert-cka@certifications[0].id',
    ]);
  });

  it('findDuplicateIds devuelve una lista vacía cuando no hay repeticiones', () => {
    expect(findDuplicateIds(expectValid(fullProfileInput()))).toEqual([]);
  });
});
