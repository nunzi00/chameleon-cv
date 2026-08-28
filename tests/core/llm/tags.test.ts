import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { buildVocabulary } from '../../../src/core/keywords';
import { closedDictionary, evidenceTerms, formatHashtags, normalizeTag, tagEvidence, verifyTagSuggestions } from '../../../src/core/llm/tags';
import type { MasterProfile } from '../../../src/core/schema';
import { NodeFileSystem, defaultSourceParsers, loadDataset } from '../../../src/parsers';

let profile: MasterProfile;

beforeAll(async () => {
  const dataset = await loadDataset(join(__dirname, '../../fixtures/dataset'), { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
  if (!dataset.ok) {
    throw new Error('dataset');
  }
  profile = dataset.profile;
});

describe('diccionario cerrado (T-4.6): el perfil es el diccionario', () => {
  it('es la unión de las tags de las especialidades, o solo de la pedida', () => {
    expect(closedDictionary(profile)).toEqual({
      ok: true,
      dictionary: {
        tags: ['php', 'symfony', 'kubernetes', 'kafka', 'liderazgo', 'gestion', 'agile'],
        specialties: [
          { id: 'backend', title: 'Senior Backend Engineer', tags: ['php', 'symfony', 'kubernetes', 'kafka'] },
          { id: 'engineering-manager', title: 'Engineering Manager', tags: ['liderazgo', 'gestion', 'agile'] },
        ],
      },
    });
    expect(closedDictionary(profile, 'engineering-manager')).toMatchObject({ ok: true, dictionary: { tags: ['liderazgo', 'gestion', 'agile'] } });
  });

  it('explica una especialidad desconocida, un perfil sin especialidades y especialidades sin tags', () => {
    expect(closedDictionary(profile, 'frontend')).toEqual({ ok: false, message: 'No existe la especialidad «frontend» (definidas: backend, engineering-manager)' });
    const empty: MasterProfile = { ...profile, specialties: [] };
    expect(closedDictionary(empty, 'frontend')).toEqual({ ok: false, message: 'No existe la especialidad «frontend» (el perfil no define ninguna)' });
    expect(closedDictionary(empty)).toMatchObject({ ok: false, message: expect.stringContaining('El perfil no define especialidades') });
    const tagless: MasterProfile = { ...profile, specialties: profile.specialties.map((specialty) => ({ ...specialty, tags: [] })) };
    expect(closedDictionary(tagless)).toEqual({ ok: false, message: 'Las especialidades no definen ninguna tag: el diccionario está vacío' });
    expect(closedDictionary(tagless, 'backend')).toEqual({ ok: false, message: 'La especialidad no define ninguna tag: el diccionario está vacío' });
  });
});

describe('verificación de sugerencias (política C10 de suggest tags)', () => {
  const dictionary = ['php', 'symfony', 'kubernetes', 'kafka', 'liderazgo', 'gestion', 'agile'];

  it('normaliza la grafía, rechaza lo que no está en el diccionario y la tag reservada, deduplica y limita', () => {
    const vocabulary = buildVocabulary(profile);
    const verdict = verifyTagSuggestions(
      [
        { tag: ' #PHP ', reason: ' usa PHP ' },
        { tag: 'Kubernetes', reason: 'migración' },
        { tag: 'aws', reason: 'no está' },
        { tag: 'php', reason: 'duplicada' },
        { tag: 'pin', reason: 'reservada' },
        { tag: 'symfony', reason: 'tercera' },
        { tag: 'kafka', reason: 'cuarta' },
      ],
      { dictionary, text: 'Lideré la migración a Kubernetes sin ventana de parada.', contextText: 'Senior Backend Engineer · PHP 8.3 · Symfony 6.4', currentTags: ['kubernetes', 'devops'], vocabulary, maxTags: 3 },
    );
    expect(verdict.accepted).toEqual([
      { tag: 'php', reason: 'usa PHP', evidence: 'contexto', isNew: true },
      { tag: 'kubernetes', reason: 'migración', evidence: 'literal', isNew: false },
      { tag: 'symfony', reason: 'tercera', evidence: 'contexto', isNew: true },
    ]);
    expect(verdict.rejected).toEqual([
      { tag: 'aws', code: 'VIOLATION_CLOSED_DICTIONARY' },
      { tag: 'pin', code: 'VIOLATION_RESERVED_TAG' },
      { tag: 'kafka', code: 'VIOLATION_MAX_TAGS' },
    ]);
    expect(verifyTagSuggestions([], { dictionary, text: 'x', vocabulary })).toEqual({ accepted: [], rejected: [] });
    expect(verifyTagSuggestions([{ tag: 'agile', reason: '' }], { dictionary, text: 'Trabajo ágil', vocabulary })).toEqual({ accepted: [{ tag: 'agile', reason: '', evidence: 'inferida', isNew: true }], rejected: [] });
  });

  it('calcula la evidencia por código: literal en el texto, en el contexto o inferida; los alias del perfil cuentan', () => {
    const vocabulary = buildVocabulary(profile);
    expect(normalizeTag('##Node.JS ')).toBe('node.js');
    expect(evidenceTerms('kubernetes', vocabulary)).toContain('kubernetes');
    expect(evidenceTerms('kubernetes', vocabulary)).toContain('k8s');
    expect(tagEvidence('kubernetes', 'Migré 12 servicios a k8s', '', vocabulary)).toBe('literal');
    expect(tagEvidence('kubernetes', 'Migré 12 servicios', 'PHP 8.3 · Kubernetes', vocabulary)).toBe('contexto');
    expect(tagEvidence('kubernetes', 'Kubernetesmania', 'kuber', vocabulary)).toBe('inferida');
    expect(tagEvidence('kafka', 'Kafka Streams', '', new Map())).toBe('literal');
    expect(formatHashtags(['php', 'symfony'])).toBe('#php #symfony');
    expect(formatHashtags([])).toBe('');
  });
});
