import { describe, expect, it } from 'vitest';

import { fingerprint, formatReview, parseReview, type ReviewItem } from '../../src/llm';

const HEADER = { generatedAt: '2026-08-29T10:00:00.000Z', provider: { id: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'm' }, promptVersion: 'improve.v1', temperature: 0, seed: 7 } as const;
const OK = { accepted: true, violations: [] } as const;
const KO = { accepted: false, violations: [{ code: 'VIOLATION_C2_NUMBER_ADDED' as const, details: ['99'] }] };

const ITEMS: ReviewItem[] = [
  {
    id: 'exp-acme-1',
    location: 'Senior Backend Engineer · ACME Corp',
    original: 'Reduje la latencia p95 un 40 %.',
    impact: '-40 % p95',
    source: { file: 'experience/acme.md', line: 15, hash: fingerprint('Reduje la latencia p95 un 40 %.') },
    proposals: [
      { text: 'Rediseñé la caché y bajé un 40 % la latencia p95.', rationale: 'verbo', verdict: OK },
      { text: 'Bajé un 99 % la latencia.', rationale: 'inventa', verdict: KO },
    ],
    fromCache: false,
    elapsedMs: 12,
    usage: { promptTokens: 10, completionTokens: 5 },
  },
  { id: 'exp-acme-2', location: 'Senior Backend Engineer · ACME Corp', original: 'Sin fuente.', proposals: [], error: 'timeout: tarde', fromCache: false, elapsedMs: 0, usage: {} },
];

describe('parseReview (T-4.7): lee lo que formatReview escribe, más las marcas del usuario', () => {
  it('reconstruye cabecera, ítems, fuentes, propuestas aceptadas y tachadas, y las marcas [x]', () => {
    const text = formatReview({ ...HEADER, task: 'improve', specialty: 'backend', offer: 'acme', dataDir: 'data/sources' }, ITEMS);
    expect(text).toContain('- fuentes: data/sources\n');
    expect(text).toContain(`Fuente: experience/acme.md:15 · sha256 ${fingerprint('Reduje la latencia p95 un 40 %.')}\n`);
    const parsed = parseReview(text.replace('- [ ] Propuesta 1:', '- [x] Propuesta 1:'));
    expect(parsed).toEqual({
      ok: true,
      review: {
        task: 'improve',
        specialty: 'backend',
        offer: 'acme',
        dataDir: 'data/sources',
        items: [
          {
            id: 'exp-acme-1',
            location: 'Senior Backend Engineer · ACME Corp',
            original: 'Reduje la latencia p95 un 40 %.',
            impact: '-40 % p95',
            source: { file: 'experience/acme.md', line: 15, hash: fingerprint('Reduje la latencia p95 un 40 %.') },
            proposals: [
              { number: 1, text: 'Rediseñé la caché y bajé un 40 % la latencia p95.', accepted: true, checked: true, verification: '✓ aceptada' },
              { number: 2, text: 'Bajé un 99 % la latencia.', accepted: false, checked: false, verification: '✗ VIOLATION_C2_NUMBER_ADDED (99)' },
            ],
          },
          { id: 'exp-acme-2', location: 'Senior Backend Engineer · ACME Corp', original: 'Sin fuente.', proposals: [], error: 'timeout: tarde' },
        ],
      },
    });
    expect(parseReview(formatReview({ ...HEADER, task: 'improve' }, []))).toEqual({ ok: true, review: { task: 'improve', specialty: undefined, offer: undefined, dataDir: undefined, items: [] } });
  });

  it('une los párrafos de un resumen, admite [X], CRLF y ficheros sin cabecera o con secciones sin separador', () => {
    const summary: ReviewItem = {
      id: 'summary',
      location: 'Resumen profesional · backend',
      original: 'Resumen actual',
      source: { file: 'specialties/backend.md', line: 6, hash: fingerprint('Resumen actual') },
      proposals: [
        { text: 'Primer párrafo.\n\nSegundo párrafo.', rationale: 'r', verdict: { ...OK, coverage: { mentioned: ['php'], missing: [] } } },
        { text: 'Uno.\n\nDos inventado.', rationale: 'r', verdict: KO },
      ],
      fromCache: true,
      elapsedMs: 0,
      usage: {},
    };
    const text = formatReview({ ...HEADER, task: 'summarize', specialty: 'backend', promptVersion: 'summarize.v1' }, [summary]).replace('- [ ] Propuesta 1:', '- [X] Propuesta 1:').replace(/\n/g, '\r\n');
    const parsed = parseReview(text);
    expect(parsed).toMatchObject({
      ok: true,
      review: {
        task: 'summarize',
        specialty: 'backend',
        items: [
          {
            id: 'summary',
            proposals: [
              { number: 1, text: 'Primer párrafo.\n\nSegundo párrafo.', accepted: true, checked: true, verification: '✓ aceptada' },
              { number: 2, text: 'Uno.\n\nDos inventado.', accepted: false, checked: false, verification: '✗ VIOLATION_C2_NUMBER_ADDED (99)' },
            ],
          },
        ],
      },
    });
    expect(parseReview('# Otra cosa\n')).toEqual({ ok: false, message: 'no es un fichero de revisión de «cv improve» ni de «cv summarize» (falta su cabecera)' });
    expect(parseReview('')).toMatchObject({ ok: false });
    const loose = parseReview('# Revisión de logros (cv improve)\n\n## solo-id\n\n      huérfana\n- [ ] Propuesta 1: a\n\n      no continúa tras línea vacía\n');
    expect(loose).toMatchObject({ ok: true, review: { items: [{ id: 'solo-id', location: '', original: '', proposals: [{ number: 1, text: 'a', checked: false }] }] } });
  });
});

describe('la línea de verificación se lee de vuelta', () => {
  it('una rechazada conserva el motivo, que es lo único que la explica', () => {
    // Sin esto, la interfaz web solo podía decir «no supera la verificación», que no es accionable: quien revisa
    // no distingue una invención del modelo de un dato que le falta a su propia fuente.
    const text = formatReview({ ...HEADER, task: 'improve', specialty: undefined, offer: undefined, dataDir: 'data/sources' }, ITEMS);
    const parsed = parseReview(text);
    const proposals = parsed.ok ? parsed.review.items[0]?.proposals : undefined;
    expect(proposals?.[0]).toMatchObject({ accepted: true, verification: '✓ aceptada' });
    expect(proposals?.[1]).toMatchObject({ accepted: false, verification: '✗ VIOLATION_C2_NUMBER_ADDED (99)' });
  });
});
