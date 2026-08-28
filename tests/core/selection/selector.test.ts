import { describe, expect, it } from 'vitest';

import { validateMasterProfile, type MasterProfile } from '../../../src/core/schema';
import {
  relevanceOf,
  selectForSpecialty,
  specialtyVocabulary,
  type ItemDecision,
  type Selection,
  type SelectionSection,
} from '../../../src/core/selection';
import { deepFreeze, selectionProfile } from '../../fixtures/selection';

function select(profile: MasterProfile, specialtyId: string): Selection {
  const result = selectForSpecialty(profile, specialtyId);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.selection;
}

const ids = (items: ReadonlyArray<{ readonly id: string }>): string[] => items.map((item) => item.id);

function decision(selection: Selection, id: string, parentId?: string): ItemDecision {
  const found = selection.report.decisions.find((candidate) => candidate.id === id && candidate.parentId === parentId);
  if (found === undefined) {
    throw new Error(`Sin decisión para ${id}`);
  }
  return found;
}

/** Devuelve una copia del perfil con las tags de un ítem sustituidas (para los invariantes de monotonía). */
function withTags(profile: MasterProfile, target: ItemDecision, tags: readonly string[]): MasterProfile {
  const replaceIn = <T extends { readonly id: string; readonly tags: readonly string[] }>(items: readonly T[]): T[] =>
    items.map((item) => (item.id === target.id ? { ...item, tags: [...tags] } : item));
  const replaceNested = <T extends { readonly id: string; readonly achievements: ReadonlyArray<{ readonly id: string; readonly tags: readonly string[] }> }>(
    items: readonly T[],
  ): T[] => items.map((item) => (item.id === target.parentId ? { ...item, achievements: replaceIn(item.achievements) } : item));
  const flat: Record<SelectionSection, (profile: MasterProfile) => Partial<MasterProfile>> = {
    experience: (p) => ({ experience: target.parentId === undefined ? replaceIn(p.experience) : replaceNested(p.experience) }),
    projects: (p) => ({ projects: target.parentId === undefined ? replaceIn(p.projects) : replaceNested(p.projects) }),
    education: (p) => ({ education: replaceIn(p.education) }),
    skills: (p) => ({ skills: replaceIn(p.skills) }),
    certifications: (p) => ({ certifications: replaceIn(p.certifications) }),
    achievements: (p) => ({ achievements: replaceIn(p.achievements) }),
  };
  return { ...profile, ...flat[target.section](profile) };
}

describe('selectForSpecialty: ejemplos de la especificación', () => {
  const profile = deepFreeze(selectionProfile());

  it('backend: conserva lo universal y lo que coincide, filtra los logros y sobrescribe titular y resumen', () => {
    const { profile: selected, specialty, report } = select(profile, 'backend');
    expect(specialty.id).toBe('backend');
    expect(report.vocabulary).toEqual(['backend', 'php', 'symfony', 'kubernetes']);
    expect(ids(selected.experience)).toEqual(['exp-acme']);
    expect(ids(selected.experience[0]?.achievements ?? [])).toEqual(['exp-acme-1', 'exp-acme-2', 'exp-acme-4']);
    expect(ids(selected.projects)).toEqual([]);
    expect(ids(selected.education)).toEqual(['edu-uni']);
    expect(ids(selected.skills)).toEqual(['skill-php', 'skill-kubernetes', 'skill-comunicacion']);
    expect(ids(selected.certifications)).toEqual(['cert-cka']);
    expect(ids(selected.achievements)).toEqual([]);
    expect(selected.personal).toEqual({
      ...profile.personal,
      headline: 'Senior Backend Engineer',
      summary: 'APIs y sistemas distribuidos para esta especialidad.',
    });
    expect(selected.specialties).toEqual([specialty]);
    expect(selected.meta).toBe(profile.meta);
    expect(selected.languages).toBe(profile.languages);
  });

  it('engineering-manager: arrastra un proyecto por sus logros y conserva el resumen por defecto', () => {
    const { profile: selected } = select(profile, 'engineering-manager');
    expect(ids(selected.experience)).toEqual(['exp-acme']);
    expect(ids(selected.experience[0]?.achievements ?? [])).toEqual(['exp-acme-2', 'exp-acme-3', 'exp-acme-4']);
    expect(ids(selected.projects)).toEqual(['proj-platform']);
    expect(ids(selected.projects[0]?.achievements ?? [])).toEqual(['proj-platform-1']);
    expect(ids(selected.skills)).toEqual(['skill-liderazgo', 'skill-comunicacion']);
    expect(ids(selected.certifications)).toEqual([]);
    expect(ids(selected.achievements)).toEqual(['ach-2']);
    expect(selected.personal.headline).toBe('Engineering Manager');
    expect(selected.personal.summary).toBe('Resumen por defecto.');
  });

  it('explica cada decisión con su motivo y las tags que coincidieron', () => {
    const manager = select(profile, 'engineering-manager');
    expect(decision(manager, 'exp-acme')).toEqual({ section: 'experience', id: 'exp-acme', included: true, reason: 'universal', matchedTags: [] });
    expect(decision(manager, 'exp-acme-3', 'exp-acme')).toEqual({
      section: 'experience',
      id: 'exp-acme-3',
      parentId: 'exp-acme',
      included: true,
      reason: 'matched',
      matchedTags: ['liderazgo', 'gestion'],
    });
    expect(decision(manager, 'exp-acme-1', 'exp-acme')).toMatchObject({ included: false, reason: 'no-match', matchedTags: [] });
    expect(decision(manager, 'proj-platform')).toEqual({ section: 'projects', id: 'proj-platform', included: true, reason: 'via-achievements', matchedTags: [] });
    expect(decision(manager, 'exp-startup')).toMatchObject({ included: false, reason: 'no-match' });
    expect(manager.report.decisions.some((candidate) => candidate.id === 'exp-startup-1')).toBe(false);
    // «backend» es el id de la especialidad y forma parte del vocabulario.
    expect(decision(select(profile, 'backend'), 'skill-php')).toMatchObject({ section: 'skills', included: true, reason: 'matched', matchedTags: ['php', 'backend'] });
  });

  it('rechaza una especialidad desconocida indicando las disponibles', () => {
    expect(selectForSpecialty(profile, 'devops')).toEqual({
      ok: false,
      error: {
        code: 'UNKNOWN_SPECIALTY',
        message: 'Especialidad desconocida: «devops» (disponibles: backend, engineering-manager)',
        available: ['backend', 'engineering-manager'],
      },
    });
    const without = { ...profile, specialties: [] };
    expect(selectForSpecialty(without, 'backend')).toMatchObject({
      ok: false,
      error: { message: 'Especialidad desconocida: «backend» (no hay especialidades definidas)', available: [] },
    });
  });
});

describe('invariantes canónicos', () => {
  const profile = deepFreeze(selectionProfile());
  const specialties = ['backend', 'engineering-manager'] as const;

  it('1. es pura y determinista: no muta la entrada (congelada) y repite el resultado', () => {
    const snapshot = structuredClone(profile);
    const first = select(profile, 'backend');
    const second = select(profile, 'backend');
    expect(profile).toEqual(snapshot);
    expect(second).toEqual(first);
  });

  it.each(specialties)('2. conserva el contrato: el perfil seleccionado para %s valida', (specialtyId) => {
    expect(validateMasterProfile(select(profile, specialtyId).profile).ok).toBe(true);
  });

  it.each(specialties)('3. conserva el orden de los ítems supervivientes (%s)', (specialtyId) => {
    const { profile: selected } = select(profile, specialtyId);
    const sections: SelectionSection[] = ['experience', 'projects', 'education', 'skills', 'certifications', 'achievements'];
    for (const section of sections) {
      const original = ids(profile[section]);
      const kept = ids(selected[section]);
      expect(kept).toEqual(original.filter((id) => kept.includes(id)));
    }
    for (const experience of selected.experience) {
      const original = ids(profile.experience.find((candidate) => candidate.id === experience.id)?.achievements ?? []);
      const kept = ids(experience.achievements);
      expect(kept).toEqual(original.filter((id) => kept.includes(id)));
    }
  });

  it.each(specialties)('4. es idempotente (%s)', (specialtyId) => {
    const once = select(profile, specialtyId);
    const twice = select(once.profile, specialtyId);
    expect(twice.profile).toEqual(once.profile);
  });

  it.each(specialties)('5. es monótona respecto al etiquetado (%s)', (specialtyId) => {
    const original = select(profile, specialtyId);
    for (const target of original.report.decisions) {
      const untagged = select(withTags(profile, target, []), specialtyId);
      const containerKept = target.parentId === undefined || decision(untagged, target.parentId).included;
      if (containerKept) {
        expect(decision(untagged, target.id, target.parentId).included, `quitar tags a ${target.id}`).toBe(true);
      } else {
        // Única excepción: el logro era quien arrastraba a su contenedor (§2.2.1).
        expect(decision(original, target.parentId).reason, `contenedor de ${target.id}`).toBe('via-achievements');
      }
      if (!target.included) {
        const foreign = select(withTags(profile, target, ['zzz-ajena']), specialtyId);
        expect(decision(foreign, target.id, target.parentId).included, `tag ajena en ${target.id}`).toBe(false);
        const pinned = select(withTags(profile, target, [specialtyId]), specialtyId);
        expect(decision(pinned, target.id, target.parentId).included, `tag del vocabulario en ${target.id}`).toBe(true);
      }
    }
  });

  it.each(specialties)('6. es explicable: una decisión por ítem evaluado e included ⇔ reason ≠ no-match (%s)', (specialtyId) => {
    const { profile: selected, report } = select(profile, specialtyId);
    const keys = report.decisions.map((candidate) => `${candidate.section}/${candidate.parentId ?? ''}/${candidate.id}`);
    expect(new Set(keys).size).toBe(keys.length);
    const nestedEvaluated = [...selected.experience, ...selected.projects].reduce(
      (count, container) => count + (profile.experience.find((c) => c.id === container.id) ?? profile.projects.find((c) => c.id === container.id))!.achievements.length,
      0,
    );
    const flatEvaluated =
      profile.experience.length + profile.projects.length + profile.education.length + profile.skills.length + profile.certifications.length + profile.achievements.length;
    expect(report.decisions).toHaveLength(flatEvaluated + nestedEvaluated);
    for (const candidate of report.decisions) {
      expect(candidate.included).toBe(candidate.reason !== 'no-match');
    }
  });
});

describe('utilidades', () => {
  it('specialtyVocabulary incluye el id de la especialidad', () => {
    expect([...specialtyVocabulary({ id: 'backend', title: 'Backend', tags: ['php', 'kafka'] })]).toEqual(['backend', 'php', 'kafka']);
  });

  it('relevanceOf distingue universal, coincidencia explícita y sin coincidencia', () => {
    const vocabulary = new Set(['php', 'kafka']);
    expect(relevanceOf([], vocabulary)).toEqual({ relevant: true, explicit: false, pinned: false, matchedTags: [] });
    expect(relevanceOf(['go', 'php'], vocabulary)).toEqual({ relevant: true, explicit: true, pinned: false, matchedTags: ['php'] });
    expect(relevanceOf(['go'], vocabulary)).toEqual({ relevant: false, explicit: false, pinned: false, matchedTags: [] });
  });
});
