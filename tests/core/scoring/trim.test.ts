import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildVocabulary, extractJobRequirements } from '../../../src/core/keywords';
import { validateMasterProfile, type MasterProfile } from '../../../src/core/schema';
import {
  COMPACT_LIMITS,
  NO_SCORES,
  applyLimits,
  keepListed,
  keepTop,
  labelFor,
  labelOrId,
  scoresFromReport,
  selectionKey,
  summarizeMatch,
  tailorToOffer,
  type ScoreLookup,
  type ScoredSelection,
  type SectionLimits,
} from '../../../src/core/scoring';
import { NodeFileSystem, defaultSourceParsers, loadDataset } from '../../../src/parsers';
import { BACKEND_OFFER } from '../../fixtures/offer';
import { deepFreeze, selectionProfile } from '../../fixtures/selection';

async function scoredExample(): Promise<ScoredSelection> {
  const dataset = await loadDataset(join(__dirname, '../../fixtures/dataset'), { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
  if (!dataset.ok) {
    throw new Error(JSON.stringify(dataset.errors));
  }
  const result = tailorToOffer(dataset.profile, extractJobRequirements(BACKEND_OFFER, buildVocabulary(dataset.profile)));
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.scored;
}

function scoresOf(scored: ScoredSelection): ScoreLookup {
  const scores = new Map(scored.report.decisions.map((decision) => [decision.id, decision.score]));
  return (id) => scores.get(id) ?? 0;
}

const ids = (items: ReadonlyArray<{ readonly id: string }>): string[] => items.map((item) => item.id);

/** Todos los ids de un perfil, incluidos los logros anidados. */
function allIds(profile: MasterProfile): string[] {
  return [
    ...profile.experience.flatMap((item) => [item.id, ...ids(item.achievements)]),
    ...profile.projects.flatMap((item) => [item.id, ...ids(item.achievements)]),
    ...ids(profile.education),
    ...ids(profile.skills),
    ...ids(profile.certifications),
    ...ids(profile.achievements),
  ];
}

describe('keepTop', () => {
  const scores: ScoreLookup = (id) => ({ a: 3, b: 1, c: 2, d: 2 })[id] ?? 0;
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

  it('sin límite conserva todo; con 0 no conserva nada', () => {
    expect(keepTop(items, undefined, scores)).toEqual({ kept: items, removed: [] });
    expect(keepTop(items, 0, scores).kept).toEqual([]);
    expect(keepTop(items, 0, scores).removed.map((entry) => entry.item.id)).toEqual(['a', 'c', 'd', 'b']);
  });

  it('conserva los mejores por puntuación, desempata por orden de entrada y mantiene ese orden', () => {
    const result = keepTop(items, 2, scores);
    expect(ids(result.kept)).toEqual(['a', 'c']);
    expect(result.removed).toEqual([
      { item: { id: 'd' }, score: 2 },
      { item: { id: 'b' }, score: 1 },
    ]);
    expect(ids(keepTop([{ id: 'b' }, { id: 'a' }, { id: 'c' }], 2, scores).kept)).toEqual(['a', 'c']);
    expect(ids(keepTop(items, 10, scores).kept)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('applyLimits: ejemplo de docs/trimming-cli.md §3.6', () => {
  it('con --top-n 1 y --max-skills 2 recorta exactamente lo previsto, en orden', async () => {
    const scored = await scoredExample();
    const result = applyLimits(scored.profile, { achievementsPerContainer: 1, achievements: 1, skills: 2 }, scoresOf(scored));
    expect(ids(result.profile.experience[0]?.achievements ?? [])).toEqual(['exp-acme-1']);
    expect(ids(result.profile.skills)).toEqual(['skill-2', 'skill-3']);
    expect(ids(result.profile.achievements)).toEqual(['ach-2']);
    expect(ids(result.profile.certifications)).toEqual(['cert-1', 'cert-2']);
    expect(result.removed).toEqual([
      { section: 'experience', id: 'exp-acme-k8s', parentId: 'exp-acme', score: 2 },
      { section: 'skills', id: 'skill-1', score: 2.5 },
      { section: 'skills', id: 'skill-5', score: 0.5 },
    ]);
  });

  it('un proyecto recortado se va entero, sin listar sus logros por separado', () => {
    const profile = selectionProfile();
    const result = applyLimits(profile, { projects: 0 }, NO_SCORES);
    expect(result.profile.projects).toEqual([]);
    expect(result.removed).toEqual([{ section: 'projects', id: 'proj-platform', score: 0 }]);
  });

  it('los universales puntúan 0, van detrás de lo puntuado y son los primeros en caer', () => {
    const profile = selectionProfile();
    const scores: ScoreLookup = (id) => ({ 'exp-acme-2': 1.5, 'exp-acme-1': 1.25, 'exp-acme-3': 0.5 })[id] ?? 0;
    const three = applyLimits(profile, { achievementsPerContainer: 3 }, scores);
    expect(ids(three.profile.experience[0]?.achievements ?? [])).toEqual(['exp-acme-1', 'exp-acme-2', 'exp-acme-3']);
    expect(three.removed).toEqual([{ section: 'experience', id: 'exp-acme-4', parentId: 'exp-acme', score: 0 }]);
    const withoutOffer = applyLimits(profile, { achievementsPerContainer: 2 }, NO_SCORES);
    expect(ids(withoutOffer.profile.experience[0]?.achievements ?? [])).toEqual(['exp-acme-1', 'exp-acme-2']);
  });

  it('el preset compacto es 4 / 4 / 12 / 4 / 5', () => {
    expect(COMPACT_LIMITS).toEqual({ achievementsPerContainer: 4, achievements: 4, skills: 12, projects: 4, certifications: 5 });
  });

  it('scoresFromReport devuelve la puntuación de cada decisión y 0 para ids desconocidos', async () => {
    const scored = await scoredExample();
    const scoreOf = scoresFromReport(scored.report);
    expect(scoreOf('exp-acme')).toBe(7.75);
    expect(scoreOf('nope')).toBe(0);
  });
});

describe('invariantes del recorte (docs/trimming-cli.md §3.5)', () => {
  it('1. conserva el contrato y solo hace desaparecer ítems', async () => {
    const scored = await scoredExample();
    const result = applyLimits(scored.profile, { achievementsPerContainer: 1, skills: 2, certifications: 1 }, scoresOf(scored));
    expect(validateMasterProfile(result.profile).ok).toBe(true);
    const before = allIds(scored.profile);
    for (const id of allIds(result.profile)) {
      expect(before).toContain(id);
    }
    expect(result.profile.personal).toBe(scored.profile.personal);
    expect(result.profile.education).toBe(scored.profile.education);
  });

  it('2. conserva el orden de los supervivientes', async () => {
    const scored = await scoredExample();
    const result = applyLimits(scored.profile, { skills: 3, achievementsPerContainer: 1 }, scoresOf(scored));
    const original = ids(scored.profile.skills);
    const kept = ids(result.profile.skills);
    expect(kept).toEqual(original.filter((id) => kept.includes(id)));
  });

  it('3. es monótono en N: subir un límite nunca elimina un superviviente; undefined no recorta; 0 vacía', async () => {
    const scored = await scoredExample();
    const scores = scoresOf(scored);
    const keptSkills = (limit: number | undefined): string[] => ids(applyLimits(scored.profile, { skills: limit }, scores).profile.skills);
    for (let limit = 0; limit < scored.profile.skills.length; limit += 1) {
      const smaller = keptSkills(limit);
      const larger = keptSkills(limit + 1);
      expect(larger).toEqual(expect.arrayContaining(smaller));
      expect(larger.length).toBe(smaller.length + 1);
    }
    expect(keptSkills(undefined)).toEqual(ids(scored.profile.skills));
    expect(keptSkills(0)).toEqual([]);
  });

  it('4. es determinista y puro', async () => {
    const scored = await scoredExample();
    const frozen = deepFreeze(structuredClone(scored.profile));
    const limits: SectionLimits = { achievementsPerContainer: 1, skills: 2 };
    const first = applyLimits(frozen, limits, scoresOf(scored));
    const second = applyLimits(frozen, limits, scoresOf(scored));
    expect(second).toEqual(first);
    expect(frozen).toEqual(structuredClone(scored.profile));
  });

  it('5. explica todo lo recortado: |removed| = |entrada| − |salida| y cada id sale con su puntuación', async () => {
    const scored = await scoredExample();
    const scores = scoresOf(scored);
    const result = applyLimits(scored.profile, { achievementsPerContainer: 1, achievements: 0, skills: 1, certifications: 1 }, scores);
    expect(result.removed).toHaveLength(allIds(scored.profile).length - allIds(result.profile).length);
    for (const removed of result.removed) {
      expect(removed.score).toBe(scores(removed.id));
      expect(allIds(result.profile)).not.toContain(removed.id);
    }
  });
});

describe('summarizeMatch', () => {
  it('resume la adecuación con el ejemplo de docs/scoring.md §6', async () => {
    const scored = await scoredExample();
    const summary = summarizeMatch(scored.report, scored.profile);
    expect(summary).toMatchObject({ recognized: 7, demonstrated: 6, requiredTotal: 4, requiredDemonstrated: 4, experienceYears: 5, gaps: ['rendimiento', 'observabilidad', 'aws', 'gcp'] });
    expect(summary.ratio).toBeCloseTo(6 / 7);
    expect(summary.terms.find((term) => term.term === 'php')?.evidence).toEqual(['exp-acme', 'exp-acme-1', 'skill-1', 'skill-2', 'cert-2']);
    expect(summary.terms.find((term) => term.term === 'kafka')?.evidence).toEqual([]);
    expect(summary.topEvidence.map((evidence) => `${evidence.id} · ${evidence.label} (${evidence.score})`)).toEqual([
      'exp-acme · ACME Corp — Senior Backend Engineer (7.75)',
      'skill-2 · Symfony (3.75)',
      'skill-3 · Kubernetes (3)',
      'skill-1 · PHP (2.5)',
      'cert-2 · Symfony Certified Developer (2.5)',
    ]);
  });

  it('sin requisitos reconocidos la ratio es 0 y admite otro límite de evidencias', async () => {
    const scored = await scoredExample();
    const empty = summarizeMatch({ ...scored.report, requirements: { terms: [], tagWeights: {}, gaps: [] } }, scored.profile, 2);
    expect(empty).toMatchObject({ recognized: 0, demonstrated: 0, ratio: 0, requiredTotal: 0, experienceYears: undefined });
    expect(empty.topEvidence).toHaveLength(2);
  });

  it('labelFor etiqueta cada sección y devuelve undefined si el id no existe', () => {
    const profile = selectionProfile();
    expect(labelFor(profile, 'experience', 'exp-acme')).toBe('ACME Corp — Senior Backend Engineer');
    expect(labelFor(profile, 'projects', 'proj-platform')).toBe('Plataforma interna');
    expect(labelFor(profile, 'education', 'edu-uni')).toBe('Grado en Ingeniería Informática');
    expect(labelFor(profile, 'skills', 'skill-php')).toBe('PHP');
    expect(labelFor(profile, 'certifications', 'cert-cka')).toBe('CKA');
    expect(labelFor(profile, 'achievements', 'ach-1')).toBe('Ponente en una conferencia.');
    expect(labelFor(profile, 'achievements', 'nope')).toBeUndefined();
    expect(labelFor(profile, 'experience', 'nope')).toBeUndefined();
    expect(labelOrId(profile, 'skills', 'skill-php')).toBe('PHP');
    expect(labelOrId(profile, 'skills', 'nope')).toBe('nope');
    const long = { ...profile, achievements: [{ ...profile.achievements[0]!, id: 'largo', text: 'x'.repeat(80) }] };
    expect(labelFor(long, 'achievements', 'largo')).toHaveLength(60);
  });
});

describe('selección explícita de skills y proyectos (docs/trimming-cli.md §3.5, invariante 6)', () => {
  it('selectionKey ignora mayúsculas, acentos y espacios', () => {
    expect(selectionKey('  Ingeniería de DATOS ')).toBe('ingenieria de datos');
  });

  it('keepListed conserva los listados por id o nombre en el orden del documento, devuelve el resto como recortado y los desconocidos aparte', () => {
    const items = [
      { id: 'skill-1', name: 'PHP', tags: ['pin'] },
      { id: 'skill-2', name: 'Kubernetes', tags: [] },
      { id: 'skill-3', name: 'Análisis de datos', tags: [] },
    ];
    const result = keepListed(items, ['kubernetes', 'analisis de datos', 'Inexistente'], (id) => (id === 'skill-1' ? 9 : 1));
    expect(result.kept.map((item) => item.id)).toEqual(['skill-2', 'skill-3']);
    expect(result.removed).toEqual([{ item: items[0], score: 9 }]);
    expect(result.unknown).toEqual(['Inexistente']);
    expect(keepListed(items, ['skill-1'], NO_SCORES).kept.map((item) => item.id)).toEqual(['skill-1']);
  });

  it('applyLimits aplica la lista antes del límite por cantidad y no toca las demás secciones', () => {
    const profile = deepFreeze(selectionProfile());
    const [firstSkill, secondSkill] = profile.skills;
    const [firstProject] = profile.projects;
    const limits: SectionLimits = { skillsInclude: [secondSkill!.name, firstSkill!.id, 'Nadie'], projectsInclude: [firstProject!.name], skills: 1 };
    const result = applyLimits(profile, limits, NO_SCORES);
    expect(result.profile.skills.map((skill) => skill.id)).toEqual([firstSkill!.id]);
    expect(result.profile.projects.map((project) => project.id)).toEqual([firstProject!.id]);
    expect(result.unknown).toEqual({ skills: ['Nadie'], projects: [] });
    expect(result.removed.filter((item) => item.section === 'skills')).toHaveLength(profile.skills.length - 1);
    expect(result.removed.filter((item) => item.section === 'projects')).toHaveLength(profile.projects.length - 1);
    expect(result.profile.experience).toEqual(profile.experience);
    expect(applyLimits(profile, {}, NO_SCORES).unknown).toEqual({ skills: [], projects: [] });
  });
});

describe('evidencias protegidas de los límites (T-8.9)', () => {
  it('keepTop trata los ids protegidos como anclados: sobreviven aunque el límite sea menor', () => {
    const items = [
      { id: 'a', tags: [] },
      { id: 'b', tags: [] },
      { id: 'c', tags: [] },
    ];
    const scores: ScoreLookup = (id) => ({ a: 3, b: 2, c: 1 })[id] ?? 0;
    expect(keepTop(items, 1, scores).kept.map((item) => item.id)).toEqual(['a']);
    expect(keepTop(items, 1, scores, new Set(['c'])).kept.map((item) => item.id)).toEqual(['c']);
    expect(keepTop(items, 0, scores, new Set(['b', 'c'])).kept.map((item) => item.id)).toEqual(['b', 'c']);
    expect(keepTop(items, 2, scores, new Set(['c'])).kept.map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('applyLimits respeta limits.keep en logros anidados, skills, proyectos y certificaciones', () => {
    const profile = selectionProfile();
    const lastSkill = profile.skills[profile.skills.length - 1]?.id ?? '';
    const lastProject = profile.projects[profile.projects.length - 1]?.id ?? '';
    const withoutKeep = applyLimits(profile, { skills: 1, projects: 1 }, NO_SCORES);
    expect(withoutKeep.profile.skills.map((skill) => skill.id)).toEqual([profile.skills[0]?.id]);
    const withKeep = applyLimits(profile, { skills: 1, projects: 1, keep: [lastSkill, lastProject] }, NO_SCORES);
    expect(withKeep.profile.skills.map((skill) => skill.id)).toEqual([lastSkill]);
    expect(withKeep.profile.projects.map((project) => project.id)).toEqual([lastProject]);
    expect(withKeep.removed.some((item) => item.id === lastSkill || item.id === lastProject)).toBe(false);
  });
});
