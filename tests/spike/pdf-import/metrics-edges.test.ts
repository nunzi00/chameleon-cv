/** Casos límite de las métricas y de las fechas del spike (T-8.4): emparejamientos en conflicto, campos opcionales ausentes, fechas mal formadas. */
import { describe, expect, it } from 'vitest';

import { parseMasterProfile } from '../../../src/core/schema';
import { findDateRange, findSingleDate, parsePoint } from '../../../scripts/spike/pdf-import/dates';
import { score, textCoverage } from '../../../scripts/spike/pdf-import/metrics';
import type { DraftEntry, DraftProfile } from '../../../scripts/spike/pdf-import/structure';

const provenance = { line: 1, text: 'x' };
const truth = parseMasterProfile({
  personal: { fullName: 'Ada Ejemplo', location: { city: 'Valencia' } },
  experience: [
    { id: 'e1', company: 'Acme', role: 'Engineer', location: 'Valencia', dates: { start: '2020-01' }, technologies: ['Go', 'Rust'], achievements: [{ id: 'a1', text: 'Construí la plataforma de pagos con Go.', impact: '3 M al mes' }, { id: 'a2', text: 'Reduje la latencia de la API un 40 %.' }] },
    { id: 'e2', company: 'Acme Labs', role: 'Engineer', dates: { start: '2018-01', end: '2019-12' }, achievements: [{ id: 'a3', text: 'Un logro que el borrador no recupera.' }] },
  ],
  projects: [{ id: 'p1', name: 'Kafka Guardian', role: 'Autora', achievements: [{ id: 'a4', text: 'Publiqué la biblioteca en abierto.', impact: '30 organizaciones' }] }],
  education: [{ id: 'ed1', institution: 'Universitat de València', degree: 'Máster en Ciencia de Datos' }],
  certifications: [{ id: 'c1', name: 'CKA', issuer: 'CNCF', date: '2021-04-20' }, { id: 'c2', name: 'AWS SAA' }],
  skills: [{ id: 's1', name: 'Go' }, { id: 's2', name: 'Rust' }],
});

function entry(partial: Partial<DraftEntry> & { title: string }): DraftEntry {
  return { technologies: [], achievements: [], provenance, ...partial };
}

const EMPTY: DraftProfile = { links: [], experience: [], projects: [], education: [], certifications: [], skills: [], achievements: [], languages: [], sections: [], unparsed: [] };

describe('score: emparejamientos y campos opcionales', () => {
  it('dos entradas de la verdad no comparten la misma del borrador; logros sin candidato, tecnologías, lugar, impacto, formación sin fechas y certificaciones con fecha', () => {
    const draft: DraftProfile = {
      ...EMPTY,
      fullName: 'Ada Ejemplo',
      location: 'Valencia, España',
      experience: [
        entry({ title: 'Engineer', subtitle: 'Acme', location: 'València', start: '2020-01', current: true, technologies: ['go', 'Rust', 'Extra'], achievements: [{ text: 'Construí la plataforma de pagos con Go.', impact: '3 M al mes', provenance }, { text: 'Otro texto que no se parece a ninguno de los de la verdad.', impact: undefined, provenance }] }),
        entry({ title: 'Freelance', subtitle: 'Sin correspondencia', start: '2010', achievements: [{ text: 'Logro huérfano.', impact: undefined, provenance }] }),
      ],
      projects: [entry({ title: 'Kafka Guardian', subtitle: 'Autora', achievements: [{ text: 'Publiqué la biblioteca en abierto.', impact: 'treinta organizaciones', provenance }] })],
      education: [entry({ title: 'Máster en Ciencia de Datos', subtitle: 'Universitat de València' })],
      certifications: [entry({ title: 'CKA', subtitle: 'CNCF', date: '2021-04' }), entry({ title: 'AWS SAA' })],
      skills: [{ category: undefined, names: ['GO', 'otra'], provenance }],
    };
    const card = score(truth, draft);
    expect(card.contact).toEqual({ fullName: true, headline: true, email: true, phone: true, city: true });
    expect(card.experience.recall).toEqual({ hit: 1, total: 2 });
    expect(card.experience.precision).toEqual({ hit: 1, total: 2 });
    expect(card.experience.dates).toEqual({ hit: 1, total: 1 });
    expect(card.experience.achievements).toEqual({ hit: 1, total: 3 });
    expect(card.experience.inventedAchievements).toBe(2);
    expect(card.experience.impacts).toEqual({ hit: 1, total: 1 });
    expect(card.experience.technologies).toEqual({ hit: 2, total: 2 });
    expect(card.experience.locations).toEqual({ hit: 1, total: 1 });
    expect(card.projects).toMatchObject({ recall: { hit: 1, total: 1 }, achievements: { hit: 1, total: 1 }, impacts: { hit: 0, total: 1 }, dates: { hit: 0, total: 0 } });
    expect(card.education).toMatchObject({ recall: { hit: 1, total: 1 }, dates: { hit: 0, total: 0 } });
    expect(card.certifications).toEqual({ recall: { hit: 2, total: 2 }, precision: { hit: 2, total: 2 }, dates: { hit: 0, total: 1 } });
    expect(card.skills).toEqual({ hit: 1, total: 2 });
    expect(card.languages).toEqual({ hit: 0, total: 0 });
    expect(card.prefilled.total).toBeGreaterThan(card.prefilled.hit);
    const coverage = textCoverage(truth, 'Ada Ejemplo Kafka Guardian Publiqué la biblioteca en abierto CKA Go');
    expect(coverage).toEqual({ hit: 5, total: 16 });
  });
});

describe('fechas mal formadas', () => {
  it('un rango o una fecha con mes numérico imposible no se reconocen; «xyz 20, 2021» tampoco', () => {
    expect(findDateRange('13/2020 – 2021')).toBeUndefined();
    expect(findSingleDate('13/2020')).toBeUndefined();
    expect(parsePoint('xyz 20, 2021')).toBeUndefined();
    expect(parsePoint('Apr 20, 2021')).toBe('2021-04-20');
  });
});

describe('score: el mejor candidato gana', () => {
  it('entre dos entradas y dos logros del borrador por encima del umbral se elige el más parecido', () => {
    const draft: DraftProfile = {
      ...EMPTY,
      experience: [
        entry({ title: 'Engineer', subtitle: 'Acme Corp', start: '2020-01', current: true }),
        entry({ title: 'Engineer', subtitle: 'Acme', start: '2020-01', current: true, achievements: [{ text: 'Construí la plataforma de pagos con Go y Rust.', impact: undefined, provenance }, { text: 'Construí la plataforma de pagos con Go.', impact: '3 M al mes', provenance }] }),
      ],
    };
    const card = score(truth, draft);
    // e1 («Engineer · Acme») elige la segunda entrada (parecido 1) sobre la primera (parecido alto pero menor); «Acme Labs» se queda sin pareja.
    expect(card.experience.recall).toEqual({ hit: 1, total: 2 });
    expect(card.experience.achievements.hit).toBe(1);
    expect(card.experience.impacts).toEqual({ hit: 1, total: 1 });
    expect(card.experience.inventedAchievements).toBe(1);
  });
});
