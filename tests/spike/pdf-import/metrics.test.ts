/** Métricas del spike (T-8.4): la tarjeta sale de emparejar el borrador con la verdad; la tabla, de la tarjeta. */
import { describe, expect, it } from 'vitest';

import { parseMasterProfile, type MasterProfile } from '../../../src/core/schema';
import { THRESHOLDS, markdownTable, percent, score, textCoverage, plainText } from '../../../scripts/spike/pdf-import/metrics';
import type { DraftEntry, DraftProfile } from '../../../scripts/spike/pdf-import/structure';
import { fullProfileInput } from '../../fixtures/master-profile';

const truth: MasterProfile = parseMasterProfile(fullProfileInput());
const provenance = { line: 1, text: 'x' };

function entryFrom(item: {
  role?: string | undefined;
  name?: string | undefined;
  degree?: string | undefined;
  company?: string | undefined;
  institution?: string | undefined;
  location?: string | undefined;
  dates?: { start: string; end?: string | undefined } | undefined;
  achievements?: ReadonlyArray<{ text: string; impact?: string | undefined }> | undefined;
  technologies?: readonly string[] | undefined;
}): DraftEntry {
  return {
    title: item.role ?? item.name ?? item.degree ?? '',
    subtitle: item.company ?? item.institution,
    location: item.location,
    start: item.dates?.start,
    end: item.dates?.end,
    current: item.dates !== undefined && item.dates.end === undefined,
    technologies: item.technologies ?? [],
    achievements: (item.achievements ?? []).map((achievement) => ({ text: achievement.text, impact: achievement.impact, provenance })),
    provenance,
  };
}

/** El borrador perfecto: lo que un estructurador ideal sacaría del PDF. */
function perfect(): DraftProfile {
  return {
    fullName: truth.personal.fullName,
    headline: truth.personal.headline,
    email: truth.personal.email,
    phone: truth.personal.phone,
    location: truth.personal.location?.city,
    links: [],
    summary: truth.personal.summary,
    experience: truth.experience.map(entryFrom),
    projects: truth.projects.map((item) => entryFrom({ name: item.name, company: item.role, dates: item.dates, achievements: item.achievements, technologies: item.technologies })),
    education: truth.education.map((item) => entryFrom({ degree: item.degree, institution: item.institution, dates: item.dates })),
    certifications: truth.certifications.map((item) => ({ title: item.name, subtitle: item.issuer, date: item.date, technologies: [], achievements: [], provenance })),
    skills: [{ category: undefined, names: truth.skills.map((skill) => skill.name), provenance }],
    achievements: [],
    languages: (truth.languages ?? []).map((language) => ({ name: language.name, level: language.level })),
    sections: [],
    unparsed: [],
  };
}

const EMPTY: DraftProfile = { links: [], experience: [], projects: [], education: [], certifications: [], skills: [], achievements: [], languages: [], sections: [], unparsed: [] };

describe('score', () => {
  it('el borrador perfecto puntúa el 100 % en todo; el vacío, 0 %', () => {
    const card = score(truth, perfect());
    expect(card.contact).toEqual({ fullName: true, headline: true, email: true, phone: true, city: true });
    expect(card.experience.recall).toEqual({ hit: truth.experience.length, total: truth.experience.length });
    expect(card.experience.precision.hit).toBe(truth.experience.length);
    expect(card.experience.dates).toEqual({ hit: truth.experience.length, total: truth.experience.length });
    const achievements = truth.experience.reduce((sum, item) => sum + item.achievements.length, 0);
    expect(card.experience.achievements).toEqual({ hit: achievements, total: achievements });
    expect(card.experience.inventedAchievements).toBe(0);
    expect(card.education.recall.hit).toBe(truth.education.length);
    expect(card.certifications.recall.hit).toBe(truth.certifications.length);
    expect(card.skills).toEqual({ hit: truth.skills.length, total: truth.skills.length });
    expect(card.prefilled.hit).toBe(card.prefilled.total);
    expect(card.prefilled.total).toBeGreaterThan(5);
    const empty = score(truth, EMPTY);
    expect(empty.experience.recall).toEqual({ hit: 0, total: truth.experience.length });
    expect(empty.experience.precision).toEqual({ hit: 0, total: 0 });
    expect(empty.prefilled.hit).toBeLessThanOrEqual(2); // solo lo opcional ausente en la verdad cuenta como acertado
    expect(empty.contact.fullName).toBe(false);
  });

  it('empareja por parecido (≥ 0,75) aunque cambie el orden empresa/rol, cuenta fechas mal, logros parciales e inventados', () => {
    const first = truth.experience[0]!;
    const draft: DraftProfile = {
      ...EMPTY,
      fullName: first.role, // nombre equivocado
      experience: [
        {
          ...entryFrom({ role: first.company, company: first.role, dates: { start: first.dates.start, end: '1999' } }),
          achievements: [
            { text: first.achievements[0]?.text ?? 'x', impact: undefined, provenance },
            { text: 'Un logro que no existe en ninguna parte del perfil original.', impact: undefined, provenance },
          ],
        },
        entryFrom({ role: 'Cargo inventado', company: 'Empresa fantasma', dates: { start: '2001' }, achievements: [{ text: 'Otro logro inventado de arriba abajo.' }] }),
      ],
    };
    const card = score(truth, draft);
    expect(card.experience.recall).toEqual({ hit: 1, total: truth.experience.length });
    expect(card.experience.precision).toEqual({ hit: 1, total: 2 });
    expect(card.experience.dates).toEqual({ hit: 0, total: 1 });
    expect(card.experience.achievements.hit).toBe(1);
    expect(card.experience.inventedAchievements).toBe(2);
    expect(card.contact.fullName).toBe(false);
    expect(THRESHOLDS.entry).toBe(0.75);
  });
});

describe('cobertura del texto y tabla', () => {
  it('textCoverage mide qué parte de la verdad aparece en el texto; markdownTable y percent formatean', () => {
    const text = [truth.personal.fullName, ...truth.experience.map((item) => `${item.role} ${item.company}`)].join('\n');
    const coverage = textCoverage(truth, text);
    expect(coverage.hit).toBeGreaterThanOrEqual(1 + 2 * truth.experience.length);
    expect(coverage.hit).toBeLessThan(coverage.total);
    expect(percent({ hit: 1, total: 4 })).toBe('25 % (1/4)');
    expect(percent({ hit: 0, total: 0 })).toBe('n/a');
    const table = markdownTable([{ name: 'a/pdfkit', candidate: 'p1', coverage, card: score(truth, perfect()), milliseconds: 12 }]);
    expect(table.split('\n')).toHaveLength(3);
    expect(table).toContain('| a/pdfkit | p1 | ');
    expect(table).toContain('| 5/5 | 100 %');
    expect(table).toContain('| 12 |');
  });
});

describe('plainText', () => {
  it('quita enlaces, negritas y cursivas Markdown de la verdad', () => {
    expect(plainText('Publiqué [Kafka Guardian](https://example.org/kafka-guardian), con **métricas** _listas_ para usar.')).toBe('Publiqué Kafka Guardian, con métricas listas para usar.');
    expect(plainText('snake_case_name sigue igual')).toBe('snake_case_name sigue igual');
  });
});
