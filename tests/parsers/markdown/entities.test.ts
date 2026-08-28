import { describe, expect, it } from 'vitest';

import type { DatasetError, ParseResult } from '../../../src/parsers/dataset/types';
import { aliasDatePaths, entityKindForDirectory, parseEntityFile, type EntityKind } from '../../../src/parsers/markdown/entities';

function kind(directory: string): EntityKind {
  const found = entityKindForDirectory(directory);
  if (found === undefined) {
    throw new Error(`Tipo desconocido: ${directory}`);
  }
  return found;
}

function parse(directory: string, name: string, source: string): ParseResult {
  return parseEntityFile(kind(directory), name, source, `${directory}/${name}.md`);
}

function expectOk(directory: string, name: string, source: string) {
  const result = parse(directory, name, source);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.errors, null, 2));
  }
  return result;
}

function expectErrors(directory: string, name: string, source: string): readonly DatasetError[] {
  const result = parse(directory, name, source);
  if (result.ok) {
    throw new Error('Se esperaban errores');
  }
  return result.errors;
}

const EXPERIENCE = [
  '---',
  'company: ACME Corp',
  'role: Senior Backend Engineer',
  'location: Madrid (remoto)',
  'start: 2021-03',
  'end: 2024-06',
  'tags: [PHP, symfony, kubernetes]',
  'technologies: [PHP 8.3, Symfony 6.4]',
  '---',
  '',
  'Plataforma de pagos.',
  '',
  'Segundo párrafo.',
  '',
  '## Logros',
  '',
  '- Reduje la latencia un **40 %**. #performance #php',
  '  - impact: -40 % p95',
  '  - date: 2023-05',
  '- Migré a Kubernetes. #kubernetes',
  '  - id: exp-acme-k8s',
  '',
].join('\n');

describe('parseEntityFile: experiencias', () => {
  it('produce la experiencia canónica con id por nombre de fichero, fechas, resumen y logros', () => {
    const result = expectOk('experience', 'acme', EXPERIENCE);
    expect(result.contribution).toEqual({
      experience: [
        {
          id: 'exp-acme',
          company: 'ACME Corp',
          role: 'Senior Backend Engineer',
          location: 'Madrid (remoto)',
          dates: { start: '2021-03', end: '2024-06' },
          summary: 'Plataforma de pagos.\n\nSegundo párrafo.',
          technologies: ['PHP 8.3', 'Symfony 6.4'],
          tags: ['php', 'symfony', 'kubernetes'],
          achievements: [
            { id: 'exp-acme-1', text: 'Reduje la latencia un **40 %**.', tags: ['performance', 'php'], impact: '-40 % p95', date: '2023-05' },
            { id: 'exp-acme-k8s', text: 'Migré a Kubernetes.', tags: ['kubernetes'] },
          ],
        },
      ],
    });
    expect(result.provenance).toEqual(
      expect.arrayContaining([
        { path: ['experience', 0], file: 'experience/acme.md', line: 1 },
        { path: ['experience', 0, 'company'], file: 'experience/acme.md', line: 2 },
        { path: ['experience', 0, 'dates'], file: 'experience/acme.md', line: 5 },
        { path: ['experience', 0, 'summary'], file: 'experience/acme.md', line: 11 },
        { path: ['experience', 0, 'achievements', 0], file: 'experience/acme.md', line: 17 },
        { path: ['experience', 0, 'achievements', 0, 'date'], file: 'experience/acme.md', line: 19 },
        { path: ['experience', 0, 'achievements', 1, 'id'], file: 'experience/acme.md', line: 21 },
      ]),
    );
  });

  it('respeta un id explícito y lo localiza en su línea', () => {
    const result = expectOk('experience', 'acme', '---\nid: exp-custom\ncompany: ACME\nrole: Dev\nstart: 2020\n---\n');
    expect(result.contribution.experience?.[0]?.id).toBe('exp-custom');
    expect(result.provenance).toContainEqual({ path: ['experience', 0], file: 'experience/acme.md', line: 2 });
  });

  it('trata un «end» vacío como periodo en curso', () => {
    const result = expectOk('experience', 'acme', '---\ncompany: ACME\nrole: Dev\nstart: 2020\nend:\n---\n');
    expect(result.contribution.experience?.[0]?.dates).toEqual({ start: '2020' });
  });

  it('rechaza «end» sin «start» señalando su línea', () => {
    expect(expectErrors('experience', 'acme', '---\ncompany: ACME\nrole: Dev\nend: 2020\n---\n')).toEqual([
      { file: 'experience/acme.md', line: 4, message: 'end: no se admite una fecha de fin sin fecha de inicio (start)' },
    ]);
  });

  it('rechaza las claves reservadas con una pista', () => {
    const errors = expectErrors('experience', 'acme', '---\ncompany: ACME\nsummary: x\nachievements: []\ndates: {start: 2020}\n---\n');
    expect(errors.map((error) => `${error.line}: ${error.message}`)).toEqual([
      '3: summary: clave no admitida; el resumen se escribe en el cuerpo del fichero, antes del primer encabezado',
      '4: achievements: clave no admitida; los logros se escriben en la sección «## Logros»',
      '5: dates: clave no admitida; usa las claves planas «start» y «end»',
    ]);
  });

  it('exige el frontmatter', () => {
    expect(expectErrors('experience', 'acme', 'Sin frontmatter.\n')).toEqual([
      { file: 'experience/acme.md', line: 1, message: 'Falta el frontmatter: el fichero debe empezar por un bloque «---» con los datos de la entidad' },
    ]);
  });

  it('propaga los errores YAML y los de estructura del documento', () => {
    expect(expectErrors('experience', 'acme', '---\na: 1\na: 2\n---\n')[0]?.message).toContain('Frontmatter YAML inválido');
    expect(expectErrors('experience', 'acme', '---\ncompany: ACME\n---\n# Título\n')[0]?.message).toContain('Encabezado de nivel 1');
  });

  it('localiza los errores del esquema en la línea de la clave y habla de start/end, no de dates', () => {
    const errors = expectErrors('experience', 'acme', '---\ncompany: ACME\nrole: Dev\nstart: 2020-13\ncompnay: typo\n---\n');
    expect(errors).toEqual(
      expect.arrayContaining([
        { file: 'experience/acme.md', line: 4, message: expect.stringMatching(/^start: Fecha inválida/) },
        { file: 'experience/acme.md', line: 5, message: 'compnay: clave no reconocida' },
      ]),
    );
    expect(expectErrors('experience', 'acme', '---\ncompany: ACME\nrole: Dev\nstart: 2021\nend: 2020\n---\n')).toEqual([
      { file: 'experience/acme.md', line: 5, message: 'end: La fecha de fin no puede ser anterior a la de inicio' },
    ]);
  });

  it('localiza los errores de un logro en la línea de su metadato', () => {
    const errors = expectErrors('experience', 'acme', '---\ncompany: ACME\nrole: Dev\nstart: 2020\n---\n\n## Logros\n\n- Uno\n  - date: 2023-02-30\n');
    expect(errors).toEqual([{ file: 'experience/acme.md', line: 10, message: expect.stringMatching(/^achievements\[0\]\.date: Fecha inválida/) }]);
  });

  it('valida las secciones: desconocidas, repetidas o sin lista', () => {
    const base = '---\ncompany: ACME\nrole: Dev\nstart: 2020\n---\n';
    expect(expectErrors('experience', 'acme', `${base}\n## Otra\n\n- x\n`)).toEqual([
      { file: 'experience/acme.md', line: 7, message: 'Sección «## Otra» no reconocida (admitida: ## Logros)' },
    ]);
    expect(expectErrors('experience', 'acme', `${base}\n## Logros\n\n- x\n\n## Logros\n\n- y\n`)).toEqual([
      { file: 'experience/acme.md', line: 11, message: 'La sección «## Logros» solo puede aparecer una vez' },
    ]);
    expect(expectErrors('experience', 'acme', `${base}\n## Logros\n\nTexto suelto.\n`)).toEqual([
      { file: 'experience/acme.md', line: 7, message: 'La sección «## Logros» debe contener únicamente una lista de viñetas' },
    ]);
    expect(expectErrors('experience', 'acme', `${base}\n## Logros\n\n- Uno\n  - foo: x\n`)).toEqual([
      { file: 'experience/acme.md', line: 10, message: 'Logro 1: metadato «foo» no admitido (admitidos: impact, date, id)' },
    ]);
  });
});

describe('parseEntityFile: otros tipos', () => {
  it('especialidades: id por nombre de fichero, sin «id:» ni fechas, con resumen', () => {
    const result = expectOk('specialties', 'backend', '---\ntitle: Backend\ntags: [php]\n---\n\nPitch.\n');
    expect(result.contribution).toEqual({ specialties: [{ id: 'backend', title: 'Backend', tags: ['php'], summary: 'Pitch.' }] });
    expect(expectErrors('specialties', 'backend', '---\nid: otro\ntitle: Backend\nstart: 2020\n---\n')).toEqual([
      { file: 'specialties/backend.md', line: 2, message: 'id: clave no admitida; el id de una especialidad es el nombre del fichero' },
      { file: 'specialties/backend.md', line: 4, message: 'start: clave no admitida; esta entidad no lleva fechas' },
    ]);
  });

  it('proyectos: admite url, fechas parciales y «## Achievements» como alias', () => {
    const result = expectOk('projects', 'cli', '---\nname: CLI\nurl: https://example.com\nstart: 2026-08\n---\n\n## Achievements\n\n- Hecho. #ts\n');
    expect(result.contribution).toEqual({
      projects: [
        {
          id: 'proj-cli',
          name: 'CLI',
          url: 'https://example.com',
          dates: { start: '2026-08' },
          technologies: [],
          tags: [],
          achievements: [{ id: 'proj-cli-1', text: 'Hecho.', tags: ['ts'] }],
        },
      ],
    });
  });

  it('formación: no admite logros', () => {
    const result = expectOk('education', 'uni', '---\ninstitution: U\ndegree: Grado\nstart: 2010\nend: 2014\n---\n');
    expect(result.contribution).toEqual({ education: [{ id: 'edu-uni', institution: 'U', degree: 'Grado', dates: { start: '2010', end: '2014' }, tags: [] }] });
    expect(expectErrors('education', 'uni', '---\ninstitution: U\ndegree: Grado\n---\n\n## Logros\n\n- x\n')).toEqual([
      { file: 'education/uni.md', line: 6, message: 'Esta entidad no admite la sección «## Logros»' },
    ]);
  });

  it('entityKindForDirectory devuelve undefined para directorios desconocidos', () => {
    expect(entityKindForDirectory('skills')).toBeUndefined();
  });
});

describe('aliasDatePaths', () => {
  it.each<[string, string]>([
    ['dates.start: x', 'start: x'],
    ['dates.end: x', 'end: x'],
    ['dates: x', 'start: x'],
    ['company: x', 'company: x'],
  ])('%s → %s', (message, expected) => {
    expect(aliasDatePaths({ file: 'f', message }).message).toBe(expected);
  });
});
