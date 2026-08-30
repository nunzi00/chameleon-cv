import { describe, expect, it } from 'vitest';

import { MODEL_LIMITS, MODEL_PROMPT_VERSION, SYSTEM_PROMPT, modelJsonSchema, normalizeDate, present, verifyModelDraft, type ModelDraft } from '../../../scripts/spike/pdf-import/verify';

const TEXT = [
  'Lucía Ferrer Montalbán',
  'Ingeniera de software · plataformas de pago y datos',
  'Valencia, España · lucia.ferrer@example.org · +34 600 123 456 · github.com/lferrer',
  'Experiencia',
  'Staff Backend Engineer · Nexo Pagos · mar 2022 – actualidad',
  '– Diseñé la arquitectura de la nueva pasarela de pagos. (0 incidentes en 18 meses)',
  '– Reduje la latencia p99 de 480 ms a 210 ms.',
  'Tecnologías: PHP 8.3, Kafka, PostgreSQL',
  'Formación',
  'Grado en Ingeniería Informática · Universitat de València · 2009 – 2013',
  'Habilidades',
  'Lenguajes: PHP, Python',
  'Idiomas',
  'Español (nativo) · Inglés (C1)',
].join('\n');

describe('normalizeDate', () => {
  it('normaliza al formato del esquema y descarta lo que no cuadra', () => {
    expect(normalizeDate(undefined)).toBeUndefined();
    expect(normalizeDate('2020')).toBe('2020');
    expect(normalizeDate(' 2020-3 ')).toBe('2020-03');
    expect(normalizeDate('2020-03-07')).toBe('2020-03-07');
    expect(normalizeDate('marzo 2020')).toBeUndefined();
  });
});

describe('present', () => {
  it('exige límites de palabra sobre la forma alfanumérica', () => {
    expect(present('Nexo Pagos · +34 600 123 456', 'Go')).toBe(false);
    expect(present('Nexo Pagos · +34 600 123 456', '56 %')).toBe(false);
    expect(present('Nexo Pagos · +34 600 123 456', 'nexo pagos')).toBe(true);
    expect(present('Nexo Pagos · +34 600 123 456', '456')).toBe(true);
    expect(present('canaliza-\nciones de datos', 'canalizaciones')).toBe(true);
    expect(present('texto', '')).toBe(false);
  });
});

describe('modelJsonSchema', () => {
  it('es un objeto cerrado con las secciones del borrador', () => {
    const schema = modelJsonSchema();
    expect(schema['type']).toBe('object');
    expect(schema['additionalProperties']).toBe(false);
    expect(Object.keys(schema['properties'] as Record<string, unknown>)).toEqual(expect.arrayContaining(['fullName', 'experience', 'education', 'skills', 'languages']));
    expect(SYSTEM_PROMPT).toContain('LITERALMENTE');
    expect(MODEL_PROMPT_VERSION).toBe('structure-cv.v1');
    expect(MODEL_LIMITS.maxTokens).toBe(6000);
  });
});

describe('verifyModelDraft', () => {
  it('conserva lo que está en el texto, descarta lo inventado y lo cuenta', () => {
    const draft: ModelDraft = {
      fullName: 'Lucía Ferrer Montalbán',
      headline: 'Directora de ingeniería',
      email: 'lucia.ferrer@example.org',
      phone: '',
      links: ['github.com/lferrer', 'linkedin.com/in/lferrer'],
      experience: [
        {
          title: 'Staff Backend Engineer',
          subtitle: 'Nexo Pagos',
          location: 'Madrid',
          start: '2022-3',
          current: true,
          url: 'https://nexo.example',
          technologies: ['PHP 8.3', 'Kafka', 'Rust'],
          achievements: [
            { text: 'Diseñé la arquitectura de la nueva pasarela de pagos.', impact: '0 incidentes en 18 meses' },
            { text: 'Reduje la latencia p99 de 480 ms a 210 ms.', impact: '56 %' },
            { text: 'Lideré la migración a Kubernetes.' },
          ],
        },
        { title: 'CTO', subtitle: 'Startup', start: '2010' },
      ],
      education: [{ title: 'Grado en Ingeniería Informática', subtitle: 'Universitat de València', start: '2009', end: '2013' }],
      certifications: [{ title: 'AWS Solutions Architect', date: '2021-05' }],
      skills: [
        { category: 'Lenguajes', names: ['PHP', 'Python', 'Go'] },
        { names: ['Haskell'] },
        { names: [] },
      ],
      achievements: [{ text: 'Premio inventado' }],
      languages: [
        { name: 'Español', level: 'nativo' },
        { name: 'Inglés', level: 'C2' },
        { name: 'Alemán' },
      ],
    };
    const { draft: verified, dropped } = verifyModelDraft(draft, TEXT);
    expect(dropped).toEqual({ entries: 2, achievements: 2, fields: 10 });
    expect(verified.fullName).toBe('Lucía Ferrer Montalbán');
    expect(verified.headline).toBeUndefined();
    expect(verified.phone).toBeUndefined();
    expect(verified.links).toEqual(['github.com/lferrer']);
    expect(verified.experience).toHaveLength(1);
    const [entry] = verified.experience;
    expect(entry).toMatchObject({ title: 'Staff Backend Engineer', subtitle: 'Nexo Pagos', location: undefined, start: '2022-03', end: undefined, current: true, url: undefined, technologies: ['PHP 8.3', 'Kafka'] });
    expect(entry?.provenance).toEqual({ line: 5, text: 'Staff Backend Engineer · Nexo Pagos · mar 2022 – actualidad' });
    expect(entry?.achievements.map((achievement) => [achievement.text, achievement.impact, achievement.provenance.line])).toEqual([
      ['Diseñé la arquitectura de la nueva pasarela de pagos.', '0 incidentes en 18 meses', 6],
      ['Reduje la latencia p99 de 480 ms a 210 ms.', undefined, 7],
    ]);
    expect(verified.education[0]).toMatchObject({ start: '2009', end: '2013', current: undefined });
    expect(verified.certifications).toEqual([]);
    expect(verified.skills).toEqual([{ category: 'lenguajes', names: ['PHP', 'Python'], provenance: { line: 8, text: 'Tecnologías: PHP 8.3, Kafka, PostgreSQL' } }]);
    expect(verified.achievements).toEqual([]);
    expect(verified.languages).toEqual([
      { name: 'Español', level: 'nativo' },
      { name: 'Inglés', level: undefined },
    ]);
    expect(verified.sections).toEqual([]);
    expect(verified.unparsed).toEqual([]);
  });

  it('infiere «actual» solo cuando hay inicio sin fin y el modelo no lo niega; la procedencia cae a la línea 0 si el texto cruza líneas', () => {
    const text = 'Puesto A\nPuesto B\nPuesto C\nDiseñé la\narquitectura';
    const { draft } = verifyModelDraft(
      {
        experience: [
          { title: 'Puesto A', start: '2020', current: false },
          { title: 'Puesto B', start: '2020', end: '2021' },
          { title: 'Puesto C', achievements: [{ text: 'Diseñé la arquitectura' }] },
        ],
      },
      text,
    );
    expect(draft.experience.map((entry) => entry.current)).toEqual([false, undefined, undefined]);
    expect(draft.experience[2]?.achievements[0]?.provenance).toEqual({ line: 0, text: 'Diseñé la arquitectura' });
  });
});
