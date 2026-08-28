import { describe, expect, it } from 'vitest';

import { describeVerdict, stem, tokenize, verifyProposal } from '../../src/core/llm';

const ORIGINAL = 'Reduje la latencia p95 del checkout un **40 %** rediseñando la capa de caché.';
const OPTIONS = { allowed: ['-40 % p95'], vocabulary: ['php', 'kubernetes', 'backend', 'rendimiento', 'liderazgo', 'google cloud'], maxLength: 220 };

describe('verifyProposal (canon C2: integridad semántica completa)', () => {
  it('acepta una reescritura que conserva todos los hechos aunque cambie verbos, orden y formato de las cifras', () => {
    expect(verifyProposal(ORIGINAL, 'Optimicé la capa de caché, disminuyendo 40% la latencia p95 del checkout.', OPTIONS)).toEqual({ accepted: true, violations: [] });
    expect(verifyProposal(ORIGINAL, 'Rediseñé la capa de caché del checkout y reduje su latencia p95 un 40 %', OPTIONS)).toEqual({ accepted: true, violations: [] });
  });

  it('rechaza cifras nuevas, entidades nuevas, contexto nuevo y hechos omitidos, explicando cada uno', () => {
    // Hallazgo real del spike: omite el 40 %.
    expect(verifyProposal(ORIGINAL, 'Rediseñé la capa de caché, reduciendo la latencia p95 del checkout.', OPTIONS)).toEqual({
      accepted: false,
      violations: [{ code: 'VIOLATION_C2_FACT_OMITTED', details: ['40'] }],
    });
    expect(verifyProposal(ORIGINAL, 'Reduje la latencia p95 del checkout un 60 % rediseñando la capa de caché en 2023.', OPTIONS)).toMatchObject({
      accepted: false,
      violations: [{ code: 'VIOLATION_C2_NUMBER_ADDED', details: ['60', '2023'] }, { code: 'VIOLATION_C2_FACT_OMITTED', details: ['40'] }],
    });
    // Hallazgo real del spike: añade «ingenieros backend» y «mejorando su rendimiento y conocimientos».
    const mentoring = verifyProposal('Mentora de 5 personas en un programa de ejemplo.', 'Desarrollé un programa de mentoría para 5 ingenieros backend, mejorando su rendimiento y conocimientos.', OPTIONS);
    expect(mentoring.accepted).toBe(false);
    expect(mentoring.violations).toEqual([
      { code: 'VIOLATION_C2_ENTITY_ADDED', details: ['backend', 'rendimiento'] },
      { code: 'VIOLATION_C2_CONTEXT_ADDED', details: ['ingenieros', 'conocimientos'] },
    ]);
    const kubernetes = verifyProposal(ORIGINAL, 'Reduje la latencia p95 del checkout un 40 % migrando la caché a Kubernetes y Redis.', OPTIONS);
    expect(kubernetes.violations).toEqual([{ code: 'VIOLATION_C2_ENTITY_ADDED', details: ['Kubernetes', 'Redis', 'kubernetes'] }]);
    expect(describeVerdict(kubernetes)).toBe('✗ VIOLATION_C2_ENTITY_ADDED (Kubernetes, Redis, kubernetes)');
    expect(describeVerdict({ accepted: true, violations: [] })).toBe('✓ aceptada');
    expect(describeVerdict({ accepted: false, violations: [{ code: 'VIOLATION_EMPTY', details: [] }] })).toBe('✗ VIOLATION_EMPTY');
  });

  it('admite el contexto permitido (impacto, rol, empresa) y los términos de varias palabras del vocabulario', () => {
    const original = 'Lideré la migración a la nube sin ventana de parada.';
    const allowed = ['Senior Backend Engineer', 'ACME Corp'];
    expect(verifyProposal(original, 'Lideré en ACME Corp la migración a la nube sin ventana de parada.', { allowed })).toEqual({ accepted: true, violations: [] });
    expect(verifyProposal(original, 'Lideré la migración a Google Cloud sin ventana de parada.', { allowed, vocabulary: ['google cloud'] })).toMatchObject({
      violations: [{ code: 'VIOLATION_C2_ENTITY_ADDED', details: ['Google', 'Cloud', 'google cloud'] }],
    });
    const withVocabulary = verifyProposal('Automaticé el despliegue con Google Cloud Build.', 'Automaticé el despliegue.', { vocabulary: ['google cloud'] });
    expect(withVocabulary.violations).toEqual([{ code: 'VIOLATION_C2_FACT_OMITTED', details: ['google', 'cloud', 'build', 'google cloud'] }]);
  });

  it('rechaza propuestas vacías, idénticas o demasiado largas', () => {
    expect(verifyProposal(ORIGINAL, '   ', OPTIONS)).toEqual({ accepted: false, violations: [{ code: 'VIOLATION_EMPTY', details: [] }] });
    expect(verifyProposal(ORIGINAL, 'Reduje la latencia p95 del checkout un 40 % rediseñando la capa de caché.', OPTIONS)).toEqual({ accepted: false, violations: [{ code: 'VIOLATION_NO_CHANGE', details: [] }] });
    const long = verifyProposal(ORIGINAL, `Reduje la latencia p95 del checkout un 40 % rediseñando la capa de caché${' y más'.repeat(40)}.`, { ...OPTIONS, maxLength: 100 });
    expect(long.violations[0]).toEqual({ code: 'VIOLATION_LENGTH', details: [`${[...long.violations.length > 0 ? `Reduje la latencia p95 del checkout un 40 % rediseñando la capa de caché${' y más'.repeat(40)}.` : ''].length} > 100`] });
  });

  it('tokeniza y clasifica: cifras, técnicos, nombres propios, verbos, palabras y vacías; raíces en español e inglés', () => {
    const kinds = tokenize('Rediseñé la API de ACME Corp con node.js y c++ en 2023-05: p95 al 40 %, 2,5 M de eventos.').map((token) => `${token.raw}:${token.kind}`);
    expect(kinds).toEqual([
      'Rediseñé:verb',
      'la:stop',
      'API:technical',
      'de:stop',
      'ACME:technical',
      'Corp:proper',
      'con:stop',
      'node.js:word',
      'y:stop',
      'c++:technical',
      'en:stop',
      '2023-05:technical',
      'p95:technical',
      'al:stop',
      '40:number',
      '2,5:number',
      'M:short',
      'de:stop',
      'eventos:word',
    ]);
    expect(tokenize('Delivered features quickly', 'en').map((token) => token.kind)).toEqual(['verb', 'word', 'word']);
    expect(tokenize('uso de web y css').map((token) => token.kind)).toEqual(['short', 'stop', 'short', 'stop', 'short']);
    expect(tokenize('')).toEqual([]);
    expect(tokenize('**...**')).toEqual([]);
    expect(stem('mentoria', 'es')).toBe('mentor');
    expect(stem('mentora', 'es')).toBe('mentor');
    expect(stem('rendimientos', 'es')).toBe(stem('rendimiento', 'es'));
    expect(stem('capa', 'es')).toBe('capa');
    expect(stem('deployments', 'en')).toBe('deploy');
    expect(stem('quickly', 'en')).toBe('quick');
  });
});
