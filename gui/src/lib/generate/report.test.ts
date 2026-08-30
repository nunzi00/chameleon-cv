import { describe, expect, it } from 'vitest';

import type { AnalyzeResponse, GenerateReportPayload } from '../api/types';
import { analysisView, describeLimits, matchLines, reportSections, selectionLines, themeLine, trimLines } from './report';

const selection: NonNullable<GenerateReportPayload['selection']> = {
  specialtyId: 'backend',
  vocabulary: ['php', 'kubernetes'],
  decisions: [
    { section: 'experience', id: 'exp-acme', included: true, reason: 'coincide', matchedTags: ['php'] } as never,
    { section: 'experience', id: 'ach-1', parentId: 'exp-acme', included: false, reason: 'sin coincidencia', matchedTags: [] } as never,
  ],
};

const match: NonNullable<GenerateReportPayload['match']> = {
  requirements: { terms: [{ term: 'kubernetes', emphasis: 'required', occurrences: 2, weight: 1.5 } as never, { term: 'go', emphasis: 'nice', occurrences: 1, weight: 0.5 } as never], gaps: ['go'], experienceYears: 5 } as never,
  decisions: [
    { section: 'experience', id: 'exp-acme', included: true, reason: 'coincide', matchedTags: [], score: 2.25, matchedTerms: ['kubernetes'] } as never,
    { section: 'projects', id: 'proj-x', included: false, reason: 'sin coincidencia', matchedTags: [], score: 0, matchedTerms: [] } as never,
  ],
  coverage: { kubernetes: ['exp-acme'], go: [] },
};

describe('informe de decisiones', () => {
  it('selección, oferta, recortes y tema con el vocabulario de la CLI', () => {
    expect(selectionLines(selection)).toEqual(['Especialidad «backend» (vocabulario: php, kubernetes): 1 de 2 ítems incluidos', '+ experience exp-acme: coincide (php)', '    − ach-1: sin coincidencia']);
    expect(matchLines(match)).toEqual(['Oferta: 2 requisitos reconocidos, 5 años exigidos · carencias: go', '  kubernetes (required ×2, 1.50) · go (nice, 0.50)', '+ experience exp-acme: coincide · 2.25 [kubernetes]', '− projects proj-x: sin coincidencia', 'No demostrado: go']);
    const kubernetes = match.requirements.terms[0];
    const covered = { ...match, requirements: { terms: [kubernetes], gaps: [], experienceYears: undefined } as never };
    expect(matchLines(covered).at(-1)).toBe('Todos los requisitos reconocidos están demostrados');
    expect(matchLines({ ...match, requirements: { terms: [], gaps: [], experienceYears: undefined } as never })).toEqual(['Oferta: 0 requisitos reconocidos · sin carencias detectadas', '+ experience exp-acme: coincide · 2.25 [kubernetes]', '− projects proj-x: sin coincidencia']);
    expect(describeLimits({})).toBe('sin límites');
    expect(describeLimits({ achievementsPerContainer: 3, achievements: 3, skills: 8, projects: 2, certifications: 1 })).toBe('3 logros por experiencia y proyecto, 3 logros transversales, 8 skills, 2 proyectos, 1 certificaciones');
    expect(trimLines([], { skills: 8 })).toEqual(['Recortes (8 skills): ninguno']);
    expect(trimLines([{ section: 'skills', id: 'sk-1', score: 0.5 }, { section: 'experience', id: 'ach-9', parentId: 'exp-acme', score: 1 }, { section: 'skills', id: 'sk-2', score: 0.25 }], { skills: 1 })).toEqual(['Recortes (1 skills): 3 ítems fuera', '  skills: sk-1 (0.50), sk-2 (0.25)', '  exp-acme: ach-9 (1.00)']);
    expect(trimLines([{ section: 'projects', id: 'p', score: 1 }], {})).toEqual(['Recortes (sin límites): 1 ítem fuera', '  projects: p (1.00)']);
    expect(themeLine(undefined)).toBeUndefined();
    expect(themeLine({ name: 'classic', builtin: true, overridden: [] })).toBe('Tema: classic (distribuido)');
    expect(themeLine({ name: 'mio', builtin: false, overridden: ['accent'] })).toBe('Tema: mio (del proyecto); cv.toml anula accent');
  });

  it('las secciones siguen el orden de las decisiones y omiten lo que no aplica', () => {
    const full = reportSections({ selection, match, limits: {}, removed: [], theme: { name: 'classic', builtin: true, overridden: [] } });
    expect(full.map((section) => section.title)).toEqual(['Selección', 'Oferta', 'Recortes', 'Tema']);
    const minimal = reportSections({ selection: undefined, match: undefined, limits: {}, removed: [], theme: undefined });
    expect(minimal.map((section) => section.title)).toEqual(['Selección', 'Recortes']);
    expect(minimal[0]?.lines).toEqual(['Sin especialidad: se genera el CV completo, sin selección']);
  });
});

describe('analysisView', () => {
  const base: AnalyzeResponse = {
    history: [],
    offer: { source: 'acme', terms: match.requirements.terms, gaps: ['go'], experienceYears: 5 } as never,
    summary: { recognized: 2, demonstrated: 1, ratio: 0.5, requiredTotal: 1, requiredDemonstrated: 1 },
    coverage: { kubernetes: ['exp-acme'], go: [] },
    decisions: match.decisions,
    ranking: [{ id: 'exp-acme', section: 'experience', score: 2.25, label: 'ACME · Dev' } as never],
    selection,
    warnings: [],
  };

  it('separa demostrados y no demostrados con la evidencia de coverage, y resume la adecuación', () => {
    const view = analysisView(base);
    expect(view.headline).toBe('Oferta acme · 2 requisitos reconocidos · 5 años de experiencia exigidos');
    expect(view.adequacy).toBe('1 de 2 requisitos demostrados (50 %) · imprescindibles: 1 de 1');
    expect(view.demonstrated).toEqual([{ term: 'kubernetes', detail: 'required ×2 · 1.50', evidence: ['exp-acme'] }]);
    expect(view.missing).toEqual([{ term: 'go', detail: 'nice · 0.50', evidence: [] }]);
    expect(view.gaps).toEqual(['go']);
    expect(view.ranking).toEqual([{ id: 'exp-acme', label: 'ACME · Dev', score: '2.25' }]);
    const nothing = analysisView({ ...base, offer: { source: 'x', terms: [], gaps: [], experienceYears: undefined } as never, summary: { ...base.summary, recognized: 0 }, coverage: {}, ranking: [] });
    expect(nothing.headline).toBe('Oferta x · 0 requisitos reconocidos');
    expect(nothing.adequacy).toContain('no menciona nada');
    expect(analysisView({ ...base, coverage: {} }).missing).toHaveLength(2);
  });
});
