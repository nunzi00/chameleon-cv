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

  it('para síntesis: sin vigilar el contexto nuevo, con hechos clave y cobertura', () => {
    const corpus = 'Senior Backend Engineer\nACME Corp\nPHP 8\nKubernetes\nReduje la latencia p95 un 40 %.';
    const options = { contextAdded: false, keyFacts: ['php', 'kubernetes', ''], vocabulary: ['php', 'kubernetes', 'aws'] };
    expect(verifyProposal(corpus, 'Ingeniera con años de experiencia en plataformas robustas usando PHP; reduje la latencia p95 un 40 %.', options)).toEqual({
      accepted: true,
      violations: [],
      coverage: { mentioned: ['php'], missing: ['kubernetes'] },
    });
    expect(verifyProposal(corpus, 'Ingeniera con experiencia en AWS y 3 equipos.', options)).toEqual({
      accepted: false,
      violations: [{ code: 'VIOLATION_C2_NUMBER_ADDED', details: ['3'] }, { code: 'VIOLATION_C2_ENTITY_ADDED', details: ['AWS', 'aws'] }, { code: 'VIOLATION_C2_FACT_OMITTED', details: ['php', 'kubernetes'] }],
      coverage: { mentioned: [], missing: ['php', 'kubernetes'] },
    });
    expect(verifyProposal(corpus, 'Perfil con experiencia consolidada.', { contextAdded: false, keyFacts: [] })).toEqual({ accepted: true, violations: [], coverage: { mentioned: [], missing: [] } });
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
    // Mayúscula tras punto o salto de línea: inicio de frase, no nombre propio.
    expect(tokenize('Reduje costes. Certificada CKA.\nLideré equipos').map((token) => `${token.raw}:${token.kind}`)).toEqual(['Reduje:word', 'costes:word', 'Certificada:verb', 'CKA:technical', 'Lideré:verb', 'equipos:word']);
    expect(tokenize('Trabajé en Madrid. Madrid es grande').map((token) => `${token.raw}:${token.kind}`)).toEqual(['Trabajé:verb', 'en:stop', 'Madrid:proper', 'Madrid:word', 'es:stop', 'grande:word']);
    expect(tokenize('**...**')).toEqual([]);
    expect(stem('mentoria', 'es')).toBe('mentor');
    expect(stem('mentora', 'es')).toBe('mentor');
    expect(stem('rendimientos', 'es')).toBe(stem('rendimiento', 'es'));
    expect(stem('capa', 'es')).toBe('capa');
    expect(stem('deployments', 'en')).toBe('deploy');
    expect(stem('quickly', 'en')).toBe('quick');
  });
});

describe('una cifra vale por su valor, no por cómo se escriba', () => {
  it('el separador de millares no convierte una cifra de la fuente en una cifra inventada', () => {
    // Este era el defecto: «21 709» se troceaba en «21» y «709», así que la misma cifra escrita de otro modo
    // parecía inventada y tumbaba la propuesta entera. Con separador de espacio, de punto o sin él, es la misma.
    for (const propuesta of ['Recuperé 21 709 mensajes AMQP perdidos.', 'Recuperé 21.709 mensajes AMQP perdidos.', 'Recuperé los 21709 mensajes AMQP perdidos.']) {
      expect(verifyProposal('Recuperé 21709 mensajes AMQP perdidos.', propuesta, { locale: 'es' }).violations).toEqual([]);
    }
    expect(verifyProposal('Migré 393.000 contactos del CRM.', 'Migré 393 000 contactos del CRM.', { locale: 'es' }).violations).toEqual([]);
  });

  it('pero una cifra que no está sigue siendo una invención, y un decimal o una versión no se tocan', () => {
    expect(verifyProposal('Recuperé los eventos perdidos.', 'Recuperé 207 eventos.', { locale: 'es' }).violations).toMatchObject([
      { code: 'VIOLATION_C2_NUMBER_ADDED', details: ['207'] },
    ]);
    // «8.3» es una versión y «1,4» un decimal: quitarles el punto los convertiría en otra cifra.
    expect(verifyProposal('Actualicé a PHP 8.3 con 1,4 s de arranque.', 'Actualicé a PHP 8.3; arranque de 1,4 s.', { locale: 'es' }).violations).toEqual([]);
    expect(verifyProposal('Procesé 1234 pedidos.', 'Procesé 1 234 pedidos.', { locale: 'en' }).violations).toEqual([]);
  });

  it('con «allowNewNumbers» la propuesta se acepta, pero la cifra se avisa: nunca se calla', () => {
    const verdict = verifyProposal('Recuperé los eventos perdidos.', 'Recuperé 207 eventos.', { locale: 'es', allowNewNumbers: true });
    expect(verdict.accepted).toBe(true);
    expect(verdict.warnings).toMatchObject([{ code: 'VIOLATION_C2_NUMBER_ADDED', details: ['207'] }]);
    expect(describeVerdict(verdict)).toContain('⚠ comprueba');
    // Sin la opción, lo mismo bloquea.
    expect(verifyProposal('Recuperé los eventos perdidos.', 'Recuperé 207 eventos.', { locale: 'es' }).accepted).toBe(false);
    // Y en la vía de síntesis (con hechos clave y cobertura) el aviso viaja igual.
    const sintesis = verifyProposal('Recuperé los eventos perdidos de Kafka.', 'Recuperé 207 eventos de Kafka.', { locale: 'es', allowNewNumbers: true, contextAdded: false, keyFacts: ['kafka'] });
    expect(sintesis.accepted).toBe(true);
    expect(sintesis.warnings).toMatchObject([{ code: 'VIOLATION_C2_NUMBER_ADDED', details: ['207'] }]);
  });
});
