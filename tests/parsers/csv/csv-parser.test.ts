import { describe, expect, it } from 'vitest';

import { CsvParser } from '../../../src/parsers/csv/csv-parser';
import type { DatasetError } from '../../../src/parsers/dataset/types';

const parser = new CsvParser();

function expectErrors(path: string, content: string): readonly DatasetError[] {
  const result = parser.parse({ path, content });
  if (result.ok) {
    throw new Error('Se esperaban errores');
  }
  return result.errors;
}

describe('CsvParser', () => {
  it('se identifica como plugin de .csv y rechaza rutas desconocidas', () => {
    expect(parser.name).toBe('csv');
    expect(parser.extensions).toEqual(['.csv']);
    expect(parser.parse({ path: 'projects.csv', content: 'name\n' })).toEqual({
      ok: false,
      errors: [{ file: 'projects.csv', message: 'Ruta no reconocida para el parser CSV (admitidas: skills.csv, certifications.csv)' }],
    });
  });

  it('produce skills canónicas con ids posicionales o explícitos y procedencia por fila', () => {
    const content = [
      'name,category,level,years,aliases,tags,id',
      'PHP,language,expert,10,,PHP|backend,',
      'Kubernetes,platform,advanced,5,K8S|k8s,kubernetes|devops,skill-k8s',
      'Liderazgo técnico,,,,,liderazgo,',
      '',
    ].join('\n');
    expect(parser.parse({ path: 'skills.csv', content })).toEqual({
      ok: true,
      contribution: {
        skills: [
          { id: 'skill-1', name: 'PHP', category: 'language', level: 'expert', years: 10, aliases: [], tags: ['php', 'backend'] },
          { id: 'skill-k8s', name: 'Kubernetes', category: 'platform', level: 'advanced', years: 5, aliases: ['k8s'], tags: ['kubernetes', 'devops'] },
          { id: 'skill-3', name: 'Liderazgo técnico', category: 'other', aliases: [], tags: ['liderazgo'] },
        ],
      },
      provenance: [
        { path: ['skills', 0], file: 'skills.csv', line: 2 },
        { path: ['skills', 1], file: 'skills.csv', line: 3 },
        { path: ['skills', 2], file: 'skills.csv', line: 4 },
      ],
    });
  });

  it('produce certificaciones canónicas', () => {
    expect(parser.parse({ path: 'certifications.csv', content: 'name,issuer,date,url,tags\nCKA,CNCF,2022-05,https://example.com/cka,kubernetes\n' })).toEqual({
      ok: true,
      contribution: {
        certifications: [{ id: 'cert-1', name: 'CKA', issuer: 'CNCF', date: '2022-05', url: 'https://example.com/cka', tags: ['kubernetes'] }],
      },
      provenance: [{ path: ['certifications', 0], file: 'certifications.csv', line: 2 }],
    });
  });

  it('localiza los errores del esquema en la línea de la fila, con el nombre de la columna, y los acumula', () => {
    expect(expectErrors('skills.csv', 'name,level,years,tags\nPHP,ninja,10,php\nGo,expert,diez,go\nOk,expert,1,php!\n')).toEqual([
      { file: 'skills.csv', line: 2, message: expect.stringMatching(/^level: /) },
      { file: 'skills.csv', line: 3, message: expect.stringMatching(/^years: /) },
      { file: 'skills.csv', line: 4, message: expect.stringMatching(/^tags\[0\]: Etiqueta inválida/) },
    ]);
    expect(expectErrors('certifications.csv', 'name,date,url\nCKA,2022-13,javascript:alert(1)\n')).toEqual([
      { file: 'certifications.csv', line: 2, message: expect.stringMatching(/^date: Fecha inválida/) },
      { file: 'certifications.csv', line: 2, message: 'url: URL inválida: solo se admiten direcciones http(s)' },
    ]);
  });

  it('propaga los errores de tabla (cabecera y estructura)', () => {
    expect(expectErrors('skills.csv', 'nombre\nPHP\n').map((error) => error.message)).toEqual([
      'Columna «nombre» no reconocida (admitidas: name, category, level, years, aliases, tags, id)',
      'Falta la columna obligatoria «name»',
    ]);
  });
});
