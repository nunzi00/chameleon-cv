import { describe, expect, it } from 'vitest';

import { parseMasterProfile, type MasterProfile } from '../../../src/core/schema';
import { selectForSpecialty } from '../../../src/core/selection';
import { labelsFor, languageOf } from '../../../src/renderers/markdown/labels';
import { buildCvView, contactLine, skillGroups } from '../../../src/renderers/markdown/view';
import { selectionProfile } from '../../fixtures/selection';

function backendProfile(): MasterProfile {
  const result = selectForSpecialty(selectionProfile(), 'backend');
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.selection.profile;
}

describe('buildCvView', () => {
  it('formatea el perfil seleccionado para backend en castellano', () => {
    const view = buildCvView(backendProfile(), 'es-ES');
    expect(view.fullName).toBe('Ada Ejemplo');
    expect(view.headline).toBe('Senior Backend Engineer');
    expect(view.contact).toBe('Madrid, España · ada@example.com · +34 600 000 000 · [GitHub](https://github.com/ada-ejemplo)');
    expect(view.summary).toBe('APIs y sistemas distribuidos para esta especialidad.');
    expect(view.experience).toEqual([
      {
        id: 'exp-acme',
        role: 'Senior Backend Engineer',
        company: 'ACME Corp',
        location: 'Madrid (remoto)',
        period: 'mar 2021 – jun 2024',
        summary: 'Plataforma de pagos con 2 M de transacciones/mes.',
        achievements: [
          { id: 'exp-acme-1', text: 'Reduje la latencia p95 un 40 %.', impact: '-40 % p95' },
          { id: 'exp-acme-2', text: 'Lideré la migración a Kubernetes.', impact: undefined },
          { id: 'exp-acme-4', text: 'Responsable del área de pagos.', impact: undefined },
        ],
        technologies: 'PHP 8.3, Symfony 6.4, Kubernetes',
      },
    ]);
    expect(view.projects).toEqual([]);
    expect(view.skillGroups.map((group) => `${group.label}: ${group.names}`)).toEqual(['Lenguajes: PHP', 'Plataformas: Kubernetes', 'Competencias: Comunicación']);
    expect(view.education).toEqual([
      { id: 'edu-uni', degree: 'Grado en Ingeniería Informática', field: 'Software', institution: 'Universidad Ejemplo', period: '2010 – 2014' },
    ]);
    expect(view.certifications).toEqual([{ id: 'cert-cka', name: 'CKA', issuer: 'CNCF', date: 'may 2022', url: 'https://example.com/cert/cka' }]);
    expect(view.languages).toEqual([
      { name: 'Español', level: 'nativo' },
      { name: 'Inglés', level: 'C1' },
    ]);
  });

  it('usa etiquetas y fechas en inglés con un locale inglés', () => {
    const view = buildCvView(backendProfile(), 'en-US');
    expect(view.labels.experience).toBe('Experience');
    expect(view.experience[0]?.period).toBe('Mar 2021 – Jun 2024');
    expect(view.languages[0]?.level).toBe('native');
    expect(view.skillGroups[0]?.label).toBe('Languages');
  });

  it('compone los proyectos con su meta (periodo y URL) y ordena todo cronológicamente', () => {
    const profile = parseMasterProfile({
      personal: { fullName: 'Ada' },
      projects: [
        { id: 'sin-fechas', name: 'Sin fechas', url: 'https://example.com/a' },
        { id: 'antiguo', name: 'Antiguo', dates: { start: '2019', end: '2020' }, role: 'Autora', technologies: ['Go'], summary: 'Resumen.' },
        { id: 'en-curso', name: 'En curso', dates: { start: '2026-08' } },
        { id: 'nada', name: 'Nada' },
      ],
      certifications: [
        { id: 'c-sin', name: 'Sin fecha' },
        { id: 'c-2020', name: 'Vieja', date: '2020' },
        { id: 'c-2024', name: 'Nueva', date: '2024-01-10' },
      ],
    });
    const view = buildCvView(profile, 'es');
    expect(view.projects.map((project) => [project.id, project.meta, project.role, project.technologies])).toEqual([
      ['en-curso', 'ago 2026 – actualidad', undefined, ''],
      ['antiguo', '2019 – 2020', 'Autora', 'Go'],
      ['sin-fechas', 'https://example.com/a', undefined, ''],
      ['nada', '', undefined, ''],
    ]);
    expect(view.certifications.map((certification) => [certification.id, certification.date])).toEqual([
      ['c-2024', '10 ene 2024'],
      ['c-2020', '2020'],
      ['c-sin', ''],
    ]);
    expect(view.headline).toBeUndefined();
    expect(view.contact).toBe('');
    expect(view.education).toEqual([]);
  });

  it('deja vacío el periodo de una formación sin fechas', () => {
    const profile = parseMasterProfile({ personal: { fullName: 'Ada' }, education: [{ id: 'e', institution: 'U', degree: 'D' }] });
    expect(buildCvView(profile, 'es').education[0]?.period).toBe('');
  });
});

describe('contactLine', () => {
  it('compone solo las partes presentes', () => {
    expect(contactLine({ fullName: 'Ada', links: [] })).toBe('');
    expect(contactLine({ fullName: 'Ada', location: { city: 'Madrid' }, links: [] })).toBe('Madrid');
    expect(contactLine({ fullName: 'Ada', phone: '600', links: [{ label: 'Web', url: 'https://ada.example' }] })).toBe('600 · [Web](https://ada.example)');
  });
});

describe('skillGroups', () => {
  it('agrupa por categoría en el orden canónico, omitiendo las vacías, y expone nivel y años', () => {
    const groups = skillGroups(
      [
        { id: 's1', name: 'Docker', category: 'tool', aliases: [], tags: [] },
        { id: 's2', name: 'PHP', category: 'language', level: 'expert', years: 10, aliases: [], tags: [] },
        { id: 's3', name: 'Go', category: 'language', aliases: [], tags: [] },
      ],
      labelsFor('es'),
    );
    expect(groups.map((group) => [group.category, group.names])).toEqual([
      ['language', 'PHP, Go'],
      ['tool', 'Docker'],
    ]);
    expect(groups[0]?.skills[0]).toEqual({ id: 's2', name: 'PHP', level: 'expert', years: 10 });
  });
});

describe('labels', () => {
  it('elige castellano para es* e inglés para el resto', () => {
    expect(languageOf('es-ES')).toBe('es');
    expect(languageOf('en_GB')).toBe('en');
    expect(labelsFor('ES').present).toBe('actualidad');
    expect(labelsFor('en').present).toBe('present');
    expect(labelsFor('fr').present).toBe('present');
  });
});
