import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { NodeFileSystem, defaultSourceParsers, loadDataset } from '../../../src/parsers';

const FIXTURE_ROOT = join(__dirname, '../../fixtures/dataset');

describe('loadDataset sobre el dataset de ejemplo (disco real)', () => {
  it('produce el MasterProfile canónico documentado en docs/formato-dataset.md', async () => {
    const result = await loadDataset(FIXTURE_ROOT, { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.files).toEqual([
      'profile.md',
      'specialties/backend.md',
      'specialties/engineering-manager.md',
      'experience/acme.md',
      'experience/startup.md',
      'projects/chameleon.md',
      'education/universidad.md',
      'achievements.md',
      'skills.csv',
      'certifications.csv',
    ]);
    const { profile } = result;
    expect(profile.meta).toEqual({ schemaVersion: 1, locale: 'es-ES', updatedAt: '2026-08-28' });
    expect(profile.personal.fullName).toBe('Ada Ejemplo');
    expect(profile.personal.summary).toBe('Ingeniera de software con **10 años** construyendo plataformas de pago.\n\nResumen por defecto en dos párrafos.');
    expect(profile.languages).toHaveLength(2);
    expect(profile.specialties.map((specialty) => [specialty.id, specialty.summary])).toEqual([
      ['backend', 'APIs y sistemas distribuidos para esta especialidad.'],
      ['engineering-manager', undefined],
    ]);
    expect(profile.experience.map((experience) => experience.id)).toEqual(['exp-acme', 'exp-startup']);
    expect(profile.experience[0]?.tags).toEqual(['php', 'symfony', 'kubernetes']);
    expect(profile.experience[0]?.achievements.map((achievement) => achievement.id)).toEqual(['exp-acme-1', 'exp-acme-k8s', 'exp-acme-3']);
    expect(profile.experience[0]?.achievements[0]).toEqual({
      id: 'exp-acme-1',
      text: 'Reduje la latencia p95 del checkout un **40 %** rediseñando la capa de caché.',
      tags: ['performance', 'php'],
      impact: '-40 % p95',
      date: '2023-05',
    });
    expect(profile.experience[1]?.dates).toEqual({ start: '2024-07' });
    expect(profile.projects[0]).toMatchObject({ id: 'proj-chameleon', url: 'https://example.com/chameleon', achievements: [{ id: 'proj-chameleon-1' }] });
    expect(profile.education[0]).toEqual({
      id: 'edu-universidad',
      institution: 'Universidad Ejemplo',
      degree: 'Grado en Ingeniería Informática',
      field: 'Software',
      dates: { start: '2010', end: '2014' },
      tags: [],
    });
    expect(profile.achievements.map((achievement) => [achievement.id, achievement.date])).toEqual([
      ['ach-1', '2025-10'],
      ['ach-2', undefined],
    ]);
    expect(profile.skills.map((skill) => skill.id)).toEqual(['skill-1', 'skill-2', 'skill-3', 'skill-4', 'skill-5']);
    expect(profile.skills[0]).toEqual({ id: 'skill-1', name: 'PHP', category: 'language', level: 'expert', years: 10, aliases: [], tags: ['php', 'backend'] });
    expect(profile.skills[3]?.tags).toEqual(['c++']);
    expect(profile.skills[4]).toEqual({
      id: 'skill-5',
      name: 'Liderazgo técnico',
      category: 'soft',
      level: 'advanced',
      aliases: ['tech lead', 'team lead'],
      tags: ['liderazgo'],
    });
    expect(profile.certifications).toEqual([
      { id: 'cert-1', name: 'CKA', issuer: 'CNCF', date: '2022-05-10', url: 'https://example.com/cert/cka', tags: ['kubernetes', 'devops'] },
      { id: 'cert-2', name: 'Symfony Certified Developer', issuer: 'SensioLabs', date: '2021', tags: ['symfony', 'php'] },
    ]);
  });
});
