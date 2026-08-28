import { describe, expect, it } from 'vitest';

import { buildVocabulary, extractJobRequirements } from '../../src/core/keywords';
import { PIN_TAG, isPinned, parseMasterProfile, validateMasterProfile, type MasterProfileInput } from '../../src/core/schema';
import { NO_SCORES, applyLimits, keepTop, scoresFromReport, tailorToOffer } from '../../src/core/scoring';
import { relevanceOf, selectForSpecialty, type Selection } from '../../src/core/selection';

/** Perfil con un ítem anclado en cada sección recortable, ninguno relevante para «backend» por sus otras tags. */
function input(): MasterProfileInput {
  return {
    personal: { fullName: 'Ada' },
    specialties: [{ id: 'backend', title: 'Backend', tags: ['php', 'kubernetes'] }],
    experience: [
      {
        id: 'exp-acme',
        company: 'ACME',
        role: 'Dev',
        dates: { start: '2020' },
        tags: ['php'],
        achievements: [
          { id: 'a-php', text: 'PHP', tags: ['php'] },
          { id: 'a-pin', text: 'Anclado', tags: ['comunidad', 'pin'] },
          { id: 'a-k8s', text: 'K8s', tags: ['kubernetes'] },
          { id: 'a-universal', text: 'Universal' },
        ],
      },
      {
        id: 'exp-otra',
        company: 'Otra',
        role: 'Lead',
        dates: { start: '2018' },
        tags: ['gestion'],
        achievements: [
          { id: 'b-pin', text: 'Anclado en un contenedor ajeno', tags: ['pin'] },
          { id: 'b-gestion', text: 'Gestión', tags: ['gestion'] },
        ],
      },
    ],
    projects: [
      { id: 'p-php', name: 'Uno', tags: ['php'] },
      { id: 'p-pin', name: 'Anclado', tags: ['pin', 'otra'] },
      { id: 'p-k8s', name: 'Tres', tags: ['kubernetes'] },
    ],
    skills: [
      { id: 's-php', name: 'PHP', tags: ['php'] },
      { id: 's-pin', name: 'Excel', tags: ['pin'] },
      { id: 's-k8s', name: 'Kubernetes', tags: ['kubernetes'] },
    ],
    certifications: [
      { id: 'c-k8s', name: 'CKA', tags: ['kubernetes'] },
      { id: 'c-pin', name: 'Anclada', tags: ['pin'] },
    ],
    achievements: [
      { id: 't-php', text: 'Transversal', tags: ['php'] },
      { id: 't-pin', text: 'Transversal anclado', tags: ['pin', 'comunidad'] },
    ],
  };
}

const PINNED_IDS = ['a-pin', 'b-pin', 'p-pin', 's-pin', 'c-pin', 't-pin'];

function backend(profileInput: MasterProfileInput = input()): Selection {
  const result = selectForSpecialty(parseMasterProfile(profileInput), 'backend');
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.selection;
}

describe('#pin: esquema', () => {
  it('reconoce la tag reservada y la rechaza como id o tag de una especialidad', () => {
    expect(PIN_TAG).toBe('pin');
    expect(isPinned(['php', 'pin'])).toBe(true);
    expect(isPinned(['php'])).toBe(false);
    expect(validateMasterProfile(parseMasterProfile(input()))).toMatchObject({ ok: true });
    expect(() => parseMasterProfile({ personal: { fullName: 'Ada' }, specialties: [{ id: 'pin', title: 'X' }] })).toThrow(
      /specialties\[0\]\.id: "pin" está reservado: es la tag de anclaje \(#pin\) y no puede ser el id de una especialidad/,
    );
    expect(() => parseMasterProfile({ personal: { fullName: 'Ada' }, specialties: [{ id: 'x', title: 'X', tags: ['php', 'PIN'] }] })).toThrow(
      /specialties\[0\]\.tags\[1\]: "pin" está reservado: es la tag de anclaje \(#pin\) y no forma parte del vocabulario de una especialidad/,
    );
  });
});

describe('#pin: selección', () => {
  it('un ítem anclado es relevante para cualquier especialidad (razón «pinned») y arrastra a su contenedor', () => {
    expect(relevanceOf(['pin'], new Set())).toEqual({ relevant: true, explicit: true, pinned: true, matchedTags: [] });
    expect(relevanceOf(['pin', 'php'], new Set(['php']))).toEqual({ relevant: true, explicit: true, pinned: true, matchedTags: ['php'] });
    const selection = backend();
    const decision = (id: string) => selection.report.decisions.find((candidate) => candidate.id === id);
    for (const id of PINNED_IDS) {
      expect(decision(id)).toMatchObject({ included: true, reason: 'pinned' });
    }
    expect(decision('exp-otra')).toMatchObject({ included: true, reason: 'via-achievements', matchedTags: [] });
    expect(decision('b-gestion')).toMatchObject({ included: false, reason: 'no-match' });
    expect(selection.profile.experience.map((item) => [item.id, item.achievements.map((achievement) => achievement.id)])).toEqual([
      ['exp-acme', ['a-php', 'a-pin', 'a-k8s', 'a-universal']],
      ['exp-otra', ['b-pin']],
    ]);
    expect(selection.profile.projects.map((item) => item.id)).toEqual(['p-php', 'p-pin', 'p-k8s']);
    expect(selection.profile.skills.map((item) => item.id)).toEqual(['s-php', 's-pin', 's-k8s']);
    expect(selection.profile.certifications.map((item) => item.id)).toEqual(['c-k8s', 'c-pin']);
    expect(selection.profile.achievements.map((item) => item.id)).toEqual(['t-php', 't-pin']);
    for (const item of selection.report.decisions) {
      expect(item.included).toBe(item.reason !== 'no-match');
    }
    expect(validateMasterProfile(selection.profile)).toMatchObject({ ok: true });
  });

  it('monotonía: quitar #pin solo puede excluir; ponerlo solo puede incluir; idempotente', () => {
    const without = input();
    const otra = without.experience?.[1];
    if (otra?.achievements?.[0] === undefined) {
      throw new Error('fixture');
    }
    otra.achievements[0] = { ...otra.achievements[0], tags: [] };
    const selection = backend(without);
    expect(selection.profile.experience.map((item) => item.id)).toEqual(['exp-acme']);
    const again = selectForSpecialty(backend().profile, 'backend');
    expect(again.ok && again.selection.profile).toEqual(backend().profile);
  });
});

describe('#pin: recorte', () => {
  const items = [
    { id: 'a', tags: [] },
    { id: 'b', tags: ['pin'] },
    { id: 'c', tags: [] },
  ];
  const scores: Record<string, number> = { a: 5, b: 0, c: 3 };
  const scoreOf = (id: string): number => scores[id] ?? 0;

  it('los anclados van primero en el ranking, consumen plaza y nunca se recortan', () => {
    expect(keepTop(items, 1, scoreOf)).toEqual({
      kept: [{ id: 'b', tags: ['pin'] }],
      removed: [
        { item: { id: 'a', tags: [] }, score: 5 },
        { item: { id: 'c', tags: [] }, score: 3 },
      ],
    });
    expect(keepTop(items, 2, scoreOf).kept.map((item) => item.id)).toEqual(['a', 'b']);
    expect(keepTop(items, 0, scoreOf).kept.map((item) => item.id)).toEqual(['b']);
    expect(keepTop(items, undefined, scoreOf).kept.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    const twoPinned = [{ id: 'x', tags: ['pin'] }, ...items];
    expect(keepTop(twoPinned, 1, scoreOf).kept.map((item) => item.id)).toEqual(['x', 'b']);
    expect(keepTop(twoPinned, 1, scoreOf).removed.map(({ item }) => item.id)).toEqual(['a', 'c']);
  });

  it('applyLimits conserva todo ítem anclado en cada sección con límites de 1 (sin oferta)', () => {
    const trimmed = applyLimits(backend().profile, { achievementsPerContainer: 1, achievements: 1, skills: 1, projects: 1, certifications: 1 }, NO_SCORES);
    expect(trimmed.profile.experience.map((item) => item.achievements.map((achievement) => achievement.id))).toEqual([['a-pin'], ['b-pin']]);
    expect(trimmed.profile.projects.map((item) => item.id)).toEqual(['p-pin']);
    expect(trimmed.profile.skills.map((item) => item.id)).toEqual(['s-pin']);
    expect(trimmed.profile.certifications.map((item) => item.id)).toEqual(['c-pin']);
    expect(trimmed.profile.achievements.map((item) => item.id)).toEqual(['t-pin']);
    expect(trimmed.removed.map((item) => item.id)).not.toContain(expect.stringMatching(/-pin$/));
    expect(trimmed.removed).toHaveLength(9);
    expect(validateMasterProfile(trimmed.profile)).toMatchObject({ ok: true });
  });
});

describe('#pin: puntuación y vocabulario', () => {
  it('pin no entra en el vocabulario ni puntúa, pero los anclados se reordenan primero', () => {
    const profile = parseMasterProfile(input());
    const vocabulary = buildVocabulary(profile);
    expect(vocabulary.has('pin')).toBe(false);
    for (const tags of vocabulary.values()) {
      expect(tags.has('pin')).toBe(false);
    }
    expect(extractJobRequirements('Requisitos:\n- pin\n- Excel', vocabulary).terms).toEqual([]);

    // Kubernetes imprescindible (1.0) y PHP deseable (0.5): el orden por puntuación es observable.
    const requirements = extractJobRequirements('Requisitos:\n- Kubernetes\n\nDeseable:\n- PHP', vocabulary);
    expect(requirements.terms.map((term) => [term.term, term.weight])).toEqual([
      ['kubernetes', 1],
      ['php', 0.5],
    ]);
    const tailored = tailorToOffer(profile, requirements, { specialtyId: 'backend' });
    if (!tailored.ok) {
      throw new Error(tailored.error.message);
    }
    const { scored } = tailored;
    expect(scored.profile.skills.map((item) => item.id)).toEqual(['s-pin', 's-k8s', 's-php']);
    expect(scored.profile.experience[0]?.achievements.map((item) => item.id)).toEqual(['a-pin', 'a-k8s', 'a-php', 'a-universal']);
    expect(scored.profile.achievements.map((item) => item.id)).toEqual(['t-pin', 't-php']);
    expect(scored.report.decisions.find((decision) => decision.id === 'a-pin')).toMatchObject({ score: 0, matchedTerms: [], reason: 'pinned' });
    const scoreOf = scoresFromReport(scored.report);
    const trimmed = applyLimits(scored.profile, { achievementsPerContainer: 2, skills: 2 }, scoreOf);
    expect(trimmed.profile.experience[0]?.achievements.map((item) => item.id)).toEqual(['a-pin', 'a-k8s']);
    expect(trimmed.profile.skills.map((item) => item.id)).toEqual(['s-pin', 's-k8s']);
  });
});
