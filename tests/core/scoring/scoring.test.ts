import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildVocabulary, extractJobRequirements, type JobRequirements } from '../../../src/core/keywords';
import { parseMasterProfile, validateMasterProfile, type MasterProfile } from '../../../src/core/schema';
import { type MatchReport, OFFER_SPECIALTY_ID, type ScoredSelection, evidenceIds, itemScore, matchedTerms, offerSpecialty, scoreSelection, suggestSpecialty, tailorToOffer } from '../../../src/core/scoring';
import { selectForSpecialty } from '../../../src/core/selection';
import { formatMatchReport } from '../../../src/cli/explain';
import { NodeFileSystem, defaultSourceParsers, loadDataset } from '../../../src/parsers';
import { BACKEND_OFFER } from '../../fixtures/offer';
import { deepFreeze, selectionProfile } from '../../fixtures/selection';

async function datasetProfile(): Promise<MasterProfile> {
  const result = await loadDataset(join(__dirname, '../../fixtures/dataset'), { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
  if (!result.ok) {
    throw new Error(JSON.stringify(result.errors));
  }
  return result.profile;
}

function tailor(profile: MasterProfile, requirements: JobRequirements, specialtyId?: string): ScoredSelection {
  const result = tailorToOffer(profile, requirements, specialtyId === undefined ? {} : { specialtyId });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.scored;
}

const ids = (items: ReadonlyArray<{ readonly id: string }>): string[] => items.map((item) => item.id);
const scoreOf = (scored: ScoredSelection, id: string): number | undefined => scored.report.decisions.find((decision) => decision.id === id)?.score;

describe('tailorToOffer con el ejemplo de docs/scoring.md §6', () => {
  it('puntúa, reordena logros y skills y explica la cobertura', async () => {
    const profile = deepFreeze(await datasetProfile());
    const requirements = extractJobRequirements(BACKEND_OFFER, buildVocabulary(profile));
    const scored = tailor(profile, requirements);

    expect(scored.selection.specialty).toEqual({ id: OFFER_SPECIALTY_ID, title: 'Ingeniera de software', tags: Object.keys(requirements.tagWeights) });
    expect(scoreOf(scored, 'exp-acme')).toBe(7.75);
    expect(scoreOf(scored, 'exp-acme-1')).toBe(2.25);
    expect(scoreOf(scored, 'exp-acme-k8s')).toBe(2);
    expect(scoreOf(scored, 'exp-startup')).toBe(0.5);
    expect(scoreOf(scored, 'skill-2')).toBe(3.75);
    expect(scoreOf(scored, 'skill-3')).toBe(3);
    expect(scoreOf(scored, 'skill-1')).toBe(2.5);
    expect(scoreOf(scored, 'skill-5')).toBe(0.5);
    expect(scoreOf(scored, 'cert-2')).toBe(2.5);
    expect(scoreOf(scored, 'cert-1')).toBe(2);
    expect(scoreOf(scored, 'ach-2')).toBe(0.5);
    expect(scoreOf(scored, 'edu-universidad')).toBe(0);
    expect(scored.report.decisions.filter((decision) => !decision.included).map((decision) => decision.id)).toEqual([
      'exp-acme-3',
      'proj-chameleon',
      'skill-4',
      'ach-1',
    ]);

    expect(ids(scored.profile.experience)).toEqual(['exp-acme', 'exp-startup']);
    expect(ids(scored.profile.experience[0]?.achievements ?? [])).toEqual(['exp-acme-1', 'exp-acme-k8s']);
    expect(ids(scored.profile.skills)).toEqual(['skill-2', 'skill-3', 'skill-1', 'skill-5']);
    expect(ids(scored.profile.certifications)).toEqual(['cert-1', 'cert-2']);
    expect(ids(scored.profile.achievements)).toEqual(['ach-2']);

    expect(scored.report.coverage['php']).toEqual(['exp-acme', 'exp-acme-1', 'skill-1', 'skill-2', 'cert-2']);
    expect(scored.report.coverage['kafka']).toEqual([]);
    expect(scored.report.decisions.find((decision) => decision.id === 'exp-acme-1')?.matchedTerms).toEqual(['php', 'symfony', 'performance']);
  });

  it('con una especialidad real, esta elige titular y filtro; la oferta solo puntúa', async () => {
    const profile = await datasetProfile();
    const requirements = extractJobRequirements(BACKEND_OFFER, buildVocabulary(profile));
    const scored = tailor(profile, requirements, 'engineering-manager');
    expect(scored.selection.specialty.id).toBe('engineering-manager');
    expect(scored.profile.personal.headline).toBe('Engineering Manager');
    expect(ids(scored.profile.experience)).toEqual(['exp-startup']);
    expect(scoreOf(scored, 'exp-startup')).toBe(0.5);
    expect(tailorToOffer(profile, requirements, { specialtyId: 'devops' })).toMatchObject({ ok: false, error: { code: 'UNKNOWN_SPECIALTY' } });
  });

  it('formatMatchReport produce el bloque de --explain', async () => {
    const profile = await datasetProfile();
    const requirements = extractJobRequirements(BACKEND_OFFER, buildVocabulary(profile));
    const lines = formatMatchReport(tailor(profile, requirements).report).split('\n');
    expect(lines[0]).toBe('Oferta: 7 requisitos reconocidos, 5 años exigidos · carencias: rendimiento, observabilidad, aws, gcp');
    expect(lines[1]).toBe(
      '  php (required ×2, 1.25) · symfony (required ×2, 1.25) · kubernetes (required, 1.00) · performance (required, 1.00) · backend (unknown, 0.75) · kafka (desirable, 0.50) · tech lead (desirable, 0.50)',
    );
    expect(lines).toContain('+ experience exp-acme: matched (php, symfony, kubernetes) · 7.75 [php, symfony, kubernetes]');
    expect(lines).toContain('    + exp-acme-1: matched (performance, php) · 2.25 [php, symfony, performance]');
    expect(lines).toContain('+ experience exp-startup: matched (liderazgo) · 0.50 [tech lead]');
    expect(lines).toContain('+ skills skill-2: matched (symfony, php, backend) · 3.75 [php, symfony, backend]');
    expect(lines).toContain('    - exp-acme-3: no-match');
    expect(lines).toContain('+ education edu-universidad: universal · 0.00');
    expect(lines.at(-2)).toBe('No demostrado: kafka');
  });
});

describe('scoreSelection y utilidades', () => {
  const profile = deepFreeze(selectionProfile());
  const weights = { php: 1.25, kubernetes: 1, liderazgo: 0.5, backend: 1.25 };
  const requirements: JobRequirements = {
    terms: [
      { term: 'php', tags: ['php', 'backend'], occurrences: 1, emphasis: 'required', weight: 1.25, contexts: [] },
      { term: 'kubernetes', tags: ['kubernetes'], occurrences: 1, emphasis: 'required', weight: 1, contexts: [] },
      { term: 'tech lead', tags: ['liderazgo'], occurrences: 1, emphasis: 'desirable', weight: 0.5, contexts: [] },
    ],
    tagWeights: weights,
    gaps: [],
  };

  it('itemScore y matchedTerms son aditivos y transparentes', () => {
    expect(itemScore(['php', 'performance', 'backend'], weights)).toBe(2.5);
    expect(itemScore([], weights)).toBe(0);
    expect(matchedTerms(['kubernetes', 'liderazgo'], requirements)).toEqual(['kubernetes', 'tech lead']);
  });

  it('conserva el contrato y los mismos ítems, solo reordena logros y skills, y desempata por orden de documento', () => {
    const scored = tailor(profile, requirements);
    expect(validateMasterProfile(scored.profile).ok).toBe(true);
    expect(ids(scored.profile.skills).sort()).toEqual(ids(scored.selection.profile.skills).sort());
    expect(ids(scored.profile.experience)).toEqual(ids(scored.selection.profile.experience));
    // La especialidad virtual incluye «liderazgo»: exp-acme-3 [liderazgo, gestion] entra con 0.5.
    expect(ids(scored.profile.experience[0]?.achievements ?? [])).toEqual(['exp-acme-2', 'exp-acme-1', 'exp-acme-3', 'exp-acme-4']);
    expect(ids(scored.profile.skills)).toEqual(['skill-php', 'skill-kubernetes', 'skill-liderazgo', 'skill-comunicacion']);
    expect(scoreOf(scored, 'exp-acme-2')).toBe(1.5);
    expect(scoreOf(scored, 'exp-acme-3')).toBe(0.5);
    expect(scoreOf(scored, 'exp-acme-4')).toBe(0);
    expect(scoreOf(scored, 'exp-acme')).toBe(3.25);
  });

  it('es pura y monótona: añadir una tag pedida nunca baja la puntuación', () => {
    const snapshot = structuredClone(profile);
    const base = tailor(profile, requirements);
    expect(profile).toEqual(snapshot);
    const boosted = parseMasterProfile({
      ...selectionProfile(),
      experience: selectionProfile().experience.map((experience) =>
        experience.id === 'exp-acme'
          ? { ...experience, achievements: experience.achievements.map((achievement) => (achievement.id === 'exp-acme-4' ? { ...achievement, tags: ['php'] } : achievement)) }
          : experience,
      ),
    });
    const after = tailor(boosted, requirements);
    expect(scoreOf(after, 'exp-acme-4')).toBeGreaterThan(scoreOf(base, 'exp-acme-4') ?? Number.NaN);
    expect(scoreOf(after, 'exp-acme')).toBeGreaterThan(scoreOf(base, 'exp-acme') ?? Number.NaN);
  });

  it('redondea según las opciones y usa el nombre completo como titular si no hay headline', () => {
    const selection = selectForSpecialty({ ...profile, specialties: [offerSpecialty(profile, requirements)] }, OFFER_SPECIALTY_ID);
    expect(selection.ok).toBe(true);
    if (!selection.ok) {
      return;
    }
    // 1.25 + 1.5 + 0.5 = 3.25 exactos → 3 al redondear solo el total (no cada logro).
    expect(scoreSelection(selection.selection, requirements, { decimals: 0 }).report.decisions.find((decision) => decision.id === 'exp-acme')?.score).toBe(3);
    const nameless = parseMasterProfile({ personal: { fullName: 'Ada' } });
    expect(offerSpecialty(nameless, requirements)).toEqual({ id: 'offer', title: 'Ada', tags: ['php', 'kubernetes', 'liderazgo', 'backend'] });
  });

  it('formatMatchReport cubre los casos sin términos, sin carencias y con todo demostrado', () => {
    const empty: JobRequirements = { terms: [], tagWeights: {}, gaps: [] };
    expect(formatMatchReport(tailor(profile, empty).report).split('\n')[0]).toBe('Oferta: 0 requisitos reconocidos · sin carencias detectadas');
    const single: JobRequirements = { terms: [requirements.terms[0]!], tagWeights: { php: 1.25, backend: 1.25 }, gaps: ['aws'] };
    const lines = formatMatchReport(tailor(profile, single).report).split('\n');
    expect(lines[0]).toBe('Oferta: 1 requisitos reconocidos · carencias: aws');
    expect(lines.at(-2)).toBe('Todos los requisitos reconocidos están demostrados');
  });

  it('marca el origen del requisito que puso el co-piloto (T-9.10): quién lo reconoció es parte del informe', () => {
    const conCopiloto: JobRequirements = {
      terms: [{ ...requirements.terms[0]!, source: 'copiloto' }],
      tagWeights: { php: 1.25 },
      gaps: [],
    };
    expect(formatMatchReport(tailor(profile, conCopiloto).report).split('\n')[1]).toContain(', co-piloto)');
  });
});

describe('especialidad sugerida y evidencias (T-8.9)', () => {
  it('suggestSpecialty elige la especialidad cuyas tags más pesan en la oferta; sin requisitos, sin coincidencias o con empate, ninguna', () => {
    const profile = selectionProfile();
    const requirements = extractJobRequirements(BACKEND_OFFER, buildVocabulary(profile));
    const suggested = suggestSpecialty(profile, requirements);
    expect(suggested).toBeDefined();
    expect(profile.specialties.map((specialty) => specialty.id)).toContain(suggested?.id);
    expect(suggested?.covered).toBeGreaterThan(0);
    expect(suggested?.total).toBe(Object.keys(requirements.tagWeights).length);
    expect(suggestSpecialty(profile, { ...requirements, tagWeights: {} })).toBeUndefined();
    expect(suggestSpecialty({ ...profile, specialties: [] }, requirements)).toBeUndefined();
    expect(suggestSpecialty(profile, { ...requirements, tagWeights: { 'tag-que-nadie-tiene': 1 } })).toBeUndefined();
    const twin = { ...profile, specialties: [{ id: 'a', title: 'A', tags: ['php'] }, { id: 'b', title: 'B', tags: ['php'] }] };
    expect(suggestSpecialty(twin, { ...requirements, tagWeights: { php: 1 } })).toBeUndefined();
    const ordered = { ...profile, specialties: [{ id: 'a', title: 'A', tags: ['php'] }, { id: 'b', title: 'B', tags: ['php', 'kafka'] }] };
    expect(suggestSpecialty(ordered, { ...requirements, tagWeights: { php: 1, kafka: 1 } })).toMatchObject({ id: 'b', title: 'B', covered: 2, total: 2 });
    const tied = { ...profile, specialties: [{ id: 'a', title: 'A', tags: ['php', 'go'] }, { id: 'b', title: 'B', tags: ['kafka'] }] };
    expect(suggestSpecialty(tied, { ...requirements, tagWeights: { php: 1, go: 1, kafka: 2 } })).toMatchObject({ id: 'a', covered: 2 });
  });

  it('evidenceIds devuelve los ítems incluidos con algún término coincidente', () => {
    const profile = selectionProfile();
    const requirements = extractJobRequirements(BACKEND_OFFER, buildVocabulary(profile));
    const tailored = tailorToOffer(profile, requirements);
    expect(tailored.ok).toBe(true);
    const report = tailored.ok ? tailored.scored.report : undefined;
    const ids = evidenceIds(report as MatchReport);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const decision = report?.decisions.find((entry) => entry.id === id);
      expect(decision?.included).toBe(true);
      expect(decision?.matchedTerms.length).toBeGreaterThan(0);
    }
    expect(evidenceIds({ requirements, decisions: [{ id: 'x', section: 'skills', included: false, reason: 'universal', matchedTags: [], score: 1, matchedTerms: ['php'] } as never], coverage: {} })).toEqual([]);
  });
});
