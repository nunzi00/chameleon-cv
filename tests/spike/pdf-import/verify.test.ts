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

type Entry = ModelDraft['experience'][number];
const entry = (partial: Partial<Entry> & { title: string }): Entry => ({ subtitle: null, location: null, start: null, end: null, current: null, date: null, url: null, summary: null, technologies: [], achievements: [], ...partial });
const blank: ModelDraft = { fullName: null, headline: null, email: null, phone: null, location: null, links: [], summary: null, experience: [], projects: [], education: [], certifications: [], skills: [], achievements: [], languages: [] };

describe('normalizeDate', () => {
  it('normaliza al formato del esquema, entiende meses en letras y descarta lo que no cuadra', () => {
    expect(normalizeDate(undefined)).toBeUndefined();
    expect(normalizeDate(null)).toBeUndefined();
    expect(normalizeDate('2020')).toBe('2020');
    expect(normalizeDate(' 2020-3 ')).toBe('2020-03');
    expect(normalizeDate('2020-03-07')).toBe('2020-03-07');
    expect(normalizeDate('marzo 2020')).toBe('2020-03');
    expect(normalizeDate('Mar 2022')).toBe('2022-03');
    expect(normalizeDate('actualidad')).toBeUndefined();
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
  it('es un objeto cerrado con todas las claves obligatorias (v2)', () => {
    const schema = modelJsonSchema();
    expect(schema['type']).toBe('object');
    expect(schema['additionalProperties']).toBe(false);
    expect(schema['required']).toEqual(expect.arrayContaining(['fullName', 'email', 'experience', 'education', 'skills', 'languages']));
    expect(SYSTEM_PROMPT).toContain('LITERALMENTE');
    expect(SYSTEM_PROMPT).toContain('TODAS las claves');
    expect(MODEL_PROMPT_VERSION).toBe('structure-cv.v2');
    expect(MODEL_LIMITS.maxTokens).toBe(6000);
  });
});

describe('verifyModelDraft', () => {
  it('conserva lo que está en el texto, descarta lo inventado y lo cuenta', () => {
    const draft: ModelDraft = {
      ...blank,
      fullName: 'Lucía Ferrer Montalbán',
      headline: 'Directora de ingeniería',
      email: 'lucia.ferrer@example.org',
      phone: '',
      links: ['github.com/lferrer', 'linkedin.com/in/lferrer'],
      experience: [
        entry({
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
            { text: 'Lideré la migración a Kubernetes.', impact: null },
            { text: 'Diseñé la arquitectura de la nueva pasarela de pagos. (0 incidentes en 18 meses)', impact: null },
          ],
        }),
        entry({ title: 'CTO', subtitle: 'Startup', start: '2010' }),
      ],
      education: [entry({ title: 'Grado en Ingeniería Informática', subtitle: 'Universitat de València', start: '2009', end: '2013' })],
      certifications: [entry({ title: 'AWS Solutions Architect', date: '2021-05' })],
      skills: [
        { category: 'Lenguajes', names: ['PHP', 'Python', 'Go'] },
        { category: null, names: ['Haskell'] },
        { category: null, names: [] },
      ],
      achievements: [{ text: 'Premio inventado', impact: null }],
      languages: [
        { name: 'Español', level: 'nativo' },
        { name: 'Inglés', level: 'C2' },
        { name: 'Alemán', level: null },
      ],
    };
    const { draft: verified, dropped } = verifyModelDraft(draft, TEXT);
    expect(dropped).toEqual({ entries: 2, achievements: 2, fields: 10 });
    expect(verified.fullName).toBe('Lucía Ferrer Montalbán');
    expect(verified.headline).toBeUndefined();
    expect(verified.phone).toBeUndefined();
    expect(verified.links).toEqual(['github.com/lferrer']);
    expect(verified.experience).toHaveLength(1);
    const [first] = verified.experience;
    expect(first).toMatchObject({ title: 'Staff Backend Engineer', subtitle: 'Nexo Pagos', location: undefined, start: '2022-03', end: undefined, current: true, url: undefined, technologies: ['PHP 8.3', 'Kafka'] });
    expect(first?.provenance).toEqual({ line: 5, text: 'Staff Backend Engineer · Nexo Pagos · mar 2022 – actualidad' });
    expect(first?.achievements.map((achievement) => [achievement.text, achievement.impact, achievement.provenance.line])).toEqual([
      ['Diseñé la arquitectura de la nueva pasarela de pagos.', '0 incidentes en 18 meses', 6],
      ['Reduje la latencia p99 de 480 ms a 210 ms.', undefined, 7],
      ['Diseñé la arquitectura de la nueva pasarela de pagos.', '0 incidentes en 18 meses', 6],
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
        ...blank,
        experience: [
          entry({ title: 'Puesto A', start: '2020', current: false }),
          entry({ title: 'Puesto B', start: '2020', end: '2021' }),
          entry({ title: 'Puesto C', achievements: [{ text: 'Diseñé la arquitectura', impact: null }] }),
        ],
      },
      text,
    );
    expect(draft.experience.map((item) => item.current)).toEqual([false, undefined, undefined]);
    expect(draft.experience[2]?.achievements[0]?.provenance).toEqual({ line: 0, text: 'Diseñé la arquitectura' });
  });
});
