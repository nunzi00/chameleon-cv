import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  JobRequirementsSchema,
  buildVocabulary,
  classifyLines,
  containsTerm,
  extractExperienceYears,
  extractJobRequirements,
  findTerm,
  isHeadingLike,
  isWordChar,
  longestFirst,
  matchTerms,
  normalizeInput,
  normalizeLine,
  strongestEmphasis,
  yearsMentionedIn,
  type Vocabulary,
} from '../../../src/core/keywords';
import { parseMasterProfile, type MasterProfile } from '../../../src/core/schema';
import { NodeFileSystem, defaultSourceParsers, loadDataset } from '../../../src/parsers';
import { BACKEND_OFFER } from '../../fixtures/offer';
import { selectionProfile } from '../../fixtures/selection';

async function datasetProfile(): Promise<MasterProfile> {
  const result = await loadDataset(join(__dirname, '../../fixtures/dataset'), { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
  if (!result.ok) {
    throw new Error(JSON.stringify(result.errors));
  }
  return result.profile;
}

const vocabularyOf = (entries: Record<string, readonly string[]>): Vocabulary => new Map(Object.entries(entries).map(([term, tags]) => [term, new Set(tags)]));

describe('normalización', () => {
  it('quita acentos, pasa a minúsculas y colapsa espacios', () => {
    expect(normalizeLine('  Gestión  de   Equipos ')).toBe('gestion de equipos');
    expect(normalizeInput('﻿a\r\nb\rc')).toBe('a\nb\nc');
    expect(isWordChar('ñ')).toBe(true);
    expect(isWordChar('+')).toBe(false);
    expect(isWordChar(undefined)).toBe(false);
  });
});

describe('matcher', () => {
  it('ordena de más largo a más corto y, a igual longitud, alfabéticamente', () => {
    expect(longestFirst(['php', 'kafka', 'node.js', 'c++', 'go'])).toEqual(['node.js', 'kafka', 'c++', 'php', 'go']);
  });

  it('exige límites de palabra propios, válidos para símbolos', () => {
    expect(findTerm('experiencia con c++ y c', 'c++')).toBe(16);
    expect(findTerm('asp.net y .net core', '.net')).toBe(10);
    expect(findTerm('node.jsx no es node.js', 'node.js')).toBe(15);
    expect(findTerm('phpstorm', 'php')).toBe(-1);
    expect(containsTerm('tech lead senior', 'tech lead')).toBe(true);
    expect(containsTerm('technical leader', 'tech lead')).toBe(false);
  });

  it('cuenta apariciones, recuerda la primera y enmascara para que lo corto no cuente dentro de lo largo', () => {
    const lines = [{ normalized: 'google cloud platform y google cloud' }, { normalized: 'cloud' }];
    const { hits, masked } = matchTerms(lines, ['cloud', 'google cloud platform', 'google cloud']);
    expect(hits.get('google cloud platform')?.all.map((hit) => [hit.lineIndex, hit.offset])).toEqual([[0, 0]]);
    expect(hits.get('google cloud')?.all.map((hit) => [hit.lineIndex, hit.offset])).toEqual([[0, 24]]);
    expect(hits.get('cloud')?.first).toEqual({ line: lines[1], lineIndex: 1, offset: 0 });
    expect(masked).toEqual(['                      y             ', '     ']);
  });
});

describe('secciones y énfasis', () => {
  it('abre secciones con encabezados es/en y aplica énfasis en línea al resto', () => {
    const lines = classifyLines(['Intro', 'Requisitos:', 'PHP', 'Kafka es un plus', 'Kubernetes', 'Nice to have', 'Go', 'Otro'].join('\n'));
    expect(lines.map((line) => `${line.index}:${line.emphasis}`)).toEqual([
      '0:unknown',
      '1:required',
      '2:required',
      '3:desirable',
      '4:required',
      '5:desirable',
      '6:desirable',
      '7:desirable',
    ]);
    expect(lines[1]).toEqual({ index: 1, original: 'Requisitos:', normalized: 'requisitos:', emphasis: 'required' });
  });

  it('isHeadingLike exige brevedad y dos puntos o pocas palabras', () => {
    expect(isHeadingLike('requisitos:')).toBe(true);
    expect(isHeadingLike('what you need')).toBe(true);
    expect(isHeadingLike('- experiencia con kafka es un plus')).toBe(false);
    expect(isHeadingLike(`requisitos ${'x'.repeat(60)}:`)).toBe(false);
  });

  it('strongestEmphasis prioriza required > unknown > desirable', () => {
    expect(strongestEmphasis(['desirable', 'unknown'])).toBe('unknown');
    expect(strongestEmphasis(['desirable', 'required', 'unknown'])).toBe('required');
    expect(strongestEmphasis([])).toBe('desirable');
  });
});

describe('años de experiencia', () => {
  it('toma el mínimo de cada rango y el máximo entre menciones, solo en líneas de experiencia', () => {
    expect(yearsMentionedIn('5+ anos de experiencia con php, 3-5 anos con k8s')).toEqual([3, 5]);
    expect(yearsMentionedIn('2 years y 4 a 6 years')).toEqual([4, 2]);
    expect(yearsMentionedIn('empresa con 50 anos de experiencia')).toEqual([]);
    expect(extractExperienceYears(['experiencia: 2+ anos', 'experience with 3 years', 'fundada hace 20 anos'])).toBe(3);
    expect(extractExperienceYears(['sin cifras'])).toBeUndefined();
  });
});

describe('buildVocabulary', () => {
  it('incluye tags de todos los ítems y nombres y alias de skills, sin technologies ni skills sin tags', async () => {
    const vocabulary = buildVocabulary(await datasetProfile());
    expect(vocabulary.get('php')).toEqual(new Set(['php', 'backend']));
    expect(vocabulary.get('symfony')).toEqual(new Set(['symfony', 'php', 'backend']));
    expect(vocabulary.get('k8s')).toEqual(new Set(['kubernetes', 'devops', 'platform']));
    expect(vocabulary.get('tech lead')).toEqual(new Set(['liderazgo']));
    expect(vocabulary.get('liderazgo tecnico')).toEqual(new Set(['liderazgo']));
    expect(vocabulary.get('kafka')).toEqual(new Set(['kafka']));
    expect(vocabulary.get('comunidad')).toEqual(new Set(['comunidad']));
    expect(vocabulary.has('php 8.3')).toBe(false);
  });

  it('omite las skills sin tags', () => {
    const vocabulary = buildVocabulary(selectionProfile());
    expect(vocabulary.has('comunicacion')).toBe(false);
    expect(vocabulary.get('gestion')).toEqual(new Set(['gestion']));
  });
});

describe('extractJobRequirements', () => {
  it('reproduce la tabla de docs/scoring.md §6 con el dataset de ejemplo', async () => {
    const requirements = extractJobRequirements(BACKEND_OFFER, buildVocabulary(await datasetProfile()));
    expect(requirements.terms.map((term) => [term.term, term.occurrences, term.emphasis, term.weight, term.tags])).toEqual([
      ['php', 2, 'required', 1.25, ['php', 'backend']],
      ['symfony', 2, 'required', 1.25, ['symfony', 'php', 'backend']],
      ['kubernetes', 1, 'required', 1, ['kubernetes', 'devops', 'platform']],
      ['performance', 1, 'required', 1, ['performance']],
      ['backend', 1, 'unknown', 0.75, ['backend']],
      ['kafka', 1, 'desirable', 0.5, ['kafka']],
      ['tech lead', 1, 'desirable', 0.5, ['liderazgo']],
    ]);
    expect(requirements.tagWeights).toEqual({
      php: 1.25,
      backend: 1.25,
      symfony: 1.25,
      kubernetes: 1,
      devops: 1,
      platform: 1,
      performance: 1,
      kafka: 0.5,
      liderazgo: 0.5,
    });
    expect(requirements.experienceYears).toBe(5);
    expect(requirements.gaps).toEqual(['rendimiento', 'observabilidad', 'aws', 'gcp']);
    expect(requirements.terms[0]?.contexts).toEqual(['Senior Backend Engineer (PHP/Symfony)', '- 5+ años de experiencia con PHP y Symfony.']);
    expect(JobRequirementsSchema.safeParse(requirements).success).toBe(true);
  });

  it('respeta las opciones (pesos, refuerzo, contextos y diccionario) y trunca contextos largos', () => {
    const vocabulary = vocabularyOf({ php: ['php'] });
    const offer = `${'x'.repeat(200)} php\nphp php php php php\nAWS`;
    const requirements = extractJobRequirements(offer, vocabulary, {
      unknownWeight: 2,
      frequencyBoost: 0.5,
      maxBoostedOccurrences: 2,
      contextsPerTerm: 1,
      dictionary: ['aws', 'php'],
    });
    expect(requirements.terms).toHaveLength(1);
    expect(requirements.terms[0]).toMatchObject({ occurrences: 6, weight: 4, emphasis: 'unknown' });
    expect(requirements.terms[0]?.contexts).toHaveLength(1);
    expect(requirements.terms[0]?.contexts[0]?.length).toBe(160);
    expect(requirements.terms[0]?.contexts[0]?.endsWith('…')).toBe(true);
    expect(requirements.gaps).toEqual(['aws']);
    expect(requirements.experienceYears).toBeUndefined();
  });

  it('ordena por peso y, a igual peso, por orden de aparición; sin coincidencias devuelve listas vacías', () => {
    const vocabulary = vocabularyOf({ kafka: ['kafka'], php: ['php'], 'node.js': ['node.js'] });
    const ordered = extractJobRequirements('Node.js y PHP\nDeseable: Kafka', vocabulary);
    expect(ordered.terms.map((term) => term.term)).toEqual(['node.js', 'php', 'kafka']);
    const empty = extractJobRequirements('Nada relevante aquí', vocabulary, { dictionary: [] });
    expect(empty).toEqual({ terms: [], tagWeights: {}, gaps: [] });
  });

  it('es monótono: más menciones nunca bajan el peso y un alias nuevo nunca quita evidencia', () => {
    const base = extractJobRequirements('Requisitos:\nk8s', vocabularyOf({ kubernetes: ['kubernetes'] }));
    expect(base.terms).toEqual([]);
    const withAlias = extractJobRequirements('Requisitos:\nk8s', vocabularyOf({ kubernetes: ['kubernetes'], k8s: ['kubernetes'] }));
    expect(withAlias.tagWeights).toEqual({ kubernetes: 1 });
    const repeated = extractJobRequirements('Requisitos:\nk8s y k8s', vocabularyOf({ kubernetes: ['kubernetes'], k8s: ['kubernetes'] }));
    expect(repeated.tagWeights['kubernetes']).toBeGreaterThan(withAlias.tagWeights['kubernetes'] ?? 0);
  });

  it('no muta el perfil ni el vocabulario', () => {
    const profile = selectionProfile();
    const snapshot = structuredClone(profile);
    const vocabulary = buildVocabulary(profile);
    const before = new Map([...vocabulary].map(([term, tags]) => [term, [...tags]]));
    extractJobRequirements(BACKEND_OFFER, vocabulary);
    expect(profile).toEqual(snapshot);
    expect(new Map([...vocabulary].map(([term, tags]) => [term, [...tags]]))).toEqual(before);
    expect(parseMasterProfile(snapshot)).toEqual(profile);
  });
});
