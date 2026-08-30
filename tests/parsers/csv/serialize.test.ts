import { describe, expect, it } from 'vitest';

import type { Certification, Skill } from '../../../src/core/schema';
import { CsvParser } from '../../../src/parsers/csv/csv-parser';
import { csvCell, serializeCertifications, serializeCsv, serializeSkills } from '../../../src/parsers/csv/serialize';

function parsed(path: string, content: string): unknown {
  const result = new CsvParser().parse({ path, content });
  if (!result.ok) {
    throw new Error(result.errors.map((error) => error.message).join('\n'));
  }
  return result.contribution;
}

describe('serializeCsv', () => {
  it('entrecomilla solo comas, comillas y saltos (RFC 4180)', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('di "hola"')).toBe('"di ""hola"""');
    expect(csvCell('dos\nlíneas')).toBe('"dos\nlíneas"');
    expect(csvCell('con|barra')).toBe('con|barra');
    expect(serializeCsv(['a', 'b'], [['1', 'x,y'], ['', '']])).toBe('a,b\n1,"x,y"\n,\n');
    expect(serializeCsv(['a'], [])).toBe('a\n');
  });
});

describe('skills.csv y certifications.csv por el parser real', () => {
  it('sin columna id cuando los ids son los posicionales; con ella cuando no', () => {
    const skills: Skill[] = [
      { id: 'skill-1', name: 'PHP', category: 'language', level: 'expert', years: 10, aliases: ['php 8'], tags: ['php', 'backend'] },
      { id: 'skill-2', name: 'Kafka, streams', category: 'platform', aliases: [], tags: [] },
    ];
    const content = serializeSkills(skills);
    expect(content).toBe('name,category,level,years,aliases,tags\nPHP,language,expert,10,php 8,php|backend\n"Kafka, streams",platform,,,,\n');
    expect(parsed('skills.csv', content)).toEqual({ skills });

    const explicit: Skill[] = [{ id: 'php', name: 'PHP', category: 'other', aliases: [], tags: [] }];
    expect(serializeSkills(explicit)).toBe('name,category,level,years,aliases,tags,id\nPHP,other,,,,,php\n');
    expect(parsed('skills.csv', serializeSkills(explicit))).toEqual({ skills: explicit });
  });

  it('certificaciones', () => {
    const certifications: Certification[] = [
      { id: 'cert-1', name: 'AWS SAA', issuer: 'Amazon', date: '2023-01', url: 'https://aws.example/x', tags: ['cloud', 'aws'] },
      { id: 'cert-2', name: 'Scrum', tags: [] },
    ];
    const content = serializeCertifications(certifications);
    expect(content).toBe('name,issuer,date,url,tags\nAWS SAA,Amazon,2023-01,https://aws.example/x,cloud|aws\nScrum,,,,\n');
    expect(parsed('certifications.csv', content)).toEqual({ certifications });
    const explicit: Certification[] = [{ id: 'aws', name: 'AWS', tags: [] }];
    expect(serializeCertifications(explicit)).toBe('name,issuer,date,url,tags,id\nAWS,,,,,aws\n');
    expect(parsed('certifications.csv', serializeCertifications(explicit))).toEqual({ certifications: explicit });
  });
});
