import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MemoryLlmCache, cacheKey, canonicalJson, createNodeLlmCache, formatReview, llmCacheDirectory, reviewStats, type LlmCacheEntry, type ReviewItem } from '../../src/llm';

const ENTRY: LlmCacheEntry = { createdAt: '2026-08-28T20:00:00.000Z', model: 'qwen', raw: '{"proposals":[]}', json: { proposals: [] }, usage: { promptTokens: 10 }, elapsedMs: 1200 };

describe('caché de respuestas (canon C8/C10)', () => {
  it('la clave es un SHA-256 canónico: no depende del orden de las claves ni de valores undefined', () => {
    const a = cacheKey({ task: 'improve', promptVersion: 'improve.v1', provider: 'ollama@http://127.0.0.1:11434', model: 'm', input: { b: 1, a: [1, { d: 2, c: 3 }], u: undefined } });
    const b = cacheKey({ model: 'm', input: { a: [1, { c: 3, d: 2 }], b: 1 }, provider: 'ollama@http://127.0.0.1:11434', promptVersion: 'improve.v1', task: 'improve' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(cacheKey({ task: 'improve', promptVersion: 'improve.v2', provider: 'x', model: 'm', input: {} })).not.toBe(cacheKey({ task: 'improve', promptVersion: 'improve.v1', provider: 'x', model: 'm', input: {} }));
    expect(canonicalJson({ z: null, a: 'x', n: 1.5, t: true })).toBe('{"a":"x","n":1.5,"t":true,"z":null}');
  });

  it('el almacén en memoria guarda, devuelve y vacía', async () => {
    const cache = new MemoryLlmCache();
    expect(await cache.get('k')).toBeUndefined();
    await cache.set('k', ENTRY);
    expect(await cache.get('k')).toEqual(ENTRY);
    expect(cache.size).toBe(1);
    expect(await cache.clear()).toBe(1);
    expect(cache.size).toBe(0);
  });

  it('el almacén en disco escribe ficheros 0600 en un directorio 0700, ignora entradas corruptas y se vacía', async () => {
    const root = await mkdtemp(join(tmpdir(), 'chameleon-llm-cache-'));
    try {
      const directory = join(root, 'llm');
      const cache = createNodeLlmCache(directory);
      expect(await cache.get('missing')).toBeUndefined();
      await cache.set('k1', ENTRY);
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect((await stat(join(directory, 'k1.json'))).mode & 0o777).toBe(0o600);
      expect(JSON.parse(await readFile(join(directory, 'k1.json'), 'utf8'))).toEqual(ENTRY);
      expect(await cache.get('k1')).toEqual(ENTRY);
      await writeFile(join(directory, 'bad.json'), 'no es json');
      await writeFile(join(directory, 'shape.json'), JSON.stringify({ nope: true }));
      expect(await cache.get('bad')).toBeUndefined();
      expect(await cache.get('shape')).toBeUndefined();
      expect(await cache.clear()).toBe(3);
      expect(await readdir(root)).toEqual([]);
      expect(await cache.clear()).toBe(0);
      expect(llmCacheDirectory({ XDG_CACHE_HOME: '/x' }, 'linux', '/h')).toBe('/x/chameleon-cv/llm');
      expect(llmCacheDirectory().endsWith(join('chameleon-cv', 'llm'))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('fichero de revisión (canon C1/C9)', () => {
  const items: ReviewItem[] = [
    {
      id: 'exp-acme-1',
      location: 'Senior Backend Engineer · ACME Corp',
      original: 'Reduje la latencia p95 del checkout un **40 %** rediseñando la capa de caché.',
      impact: '-40 % p95',
      proposals: [
        { text: 'Optimicé la capa de caché, disminuyendo 40% la latencia p95 del checkout.', rationale: 'Resultado al final.', verdict: { accepted: true, violations: [] } },
        { text: 'Rediseñé la capa de caché, reduciendo la latencia p95 del checkout.', rationale: 'Más conciso.', verdict: { accepted: false, violations: [{ code: 'VIOLATION_C2_FACT_OMITTED', details: ['40'] }] } },
      ],
      fromCache: false,
      elapsedMs: 24000,
      usage: { promptTokens: 493, completionTokens: 121 },
    },
    { id: 'ach-2', location: 'Logros transversales', original: 'Mentora de 5 personas.', proposals: [], error: 'timeout: Typst…', fromCache: false, elapsedMs: 0, usage: {} },
    { id: 'ach-3', location: 'Logros transversales', original: 'Ponente.', proposals: [{ text: 'Fui ponente.', rationale: 'x', verdict: { accepted: true, violations: [] } }], fromCache: true, elapsedMs: 0, usage: {} },
    { id: 'ach-4', location: 'Logros transversales', original: 'Autora.', proposals: [{ text: 'Fui autora.', rationale: 'y', verdict: { accepted: true, violations: [] } }], fromCache: false, elapsedMs: 3, usage: { promptTokens: 3 } },
    { id: 'ach-5', location: 'Logros transversales', original: 'Editora.', proposals: [{ text: 'Fui editora.', rationale: 'z', verdict: { accepted: true, violations: [] } }], fromCache: false, elapsedMs: 4, usage: { completionTokens: 4 } },
  ];

  it('resume y formatea con procedencia, casillas para lo aceptado y tachado con motivo para lo rechazado', () => {
    expect(reviewStats(items)).toEqual({ items: 5, proposals: 5, accepted: 4, rejected: 1, failed: 1, fromCache: 1 });
    const text = formatReview(
      { task: 'improve', generatedAt: '2026-08-28T20:00:00.000Z', specialty: 'backend', offer: 'acme-backend', provider: { id: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080', model: 'default' }, promptVersion: 'improve.v1', temperature: 0, seed: 7 },
      items,
    );
    expect(text).toBe(
      [
        '# Revisión de logros (cv improve)',
        '',
        '- generado: 2026-08-28T20:00:00.000Z',
        '- especialidad: backend · oferta: acme-backend',
        '- proveedor: openai-compatible (http://127.0.0.1:8080) · modelo: default · prompt: improve.v1 · temperatura 0 · semilla 7',
        '- logros: 5 · propuestas: 5 · aceptadas: 4 · rechazadas: 1 · fallidos: 1 · desde caché: 1',
        '',
        'La IA sugiere; tú decides. Nada se ha modificado en `data/sources/`. Marca con `[x]` las propuestas que quieras adoptar y cópialas a tus fuentes (o aplícalas con `cv improve apply` cuando exista). Las propuestas tachadas incumplen el canon C2 (integridad semántica): el motivo está al lado.',
        '',
        '## exp-acme-1 · Senior Backend Engineer · ACME Corp',
        '',
        'Original: Reduje la latencia p95 del checkout un **40 %** rediseñando la capa de caché.',
        'Impacto: -40 % p95',
        '',
        '- [ ] Propuesta 1: Optimicé la capa de caché, disminuyendo 40% la latencia p95 del checkout.',
        '  - motivo: Resultado al final.',
        '  - verificación: ✓ aceptada',
        '- ~~Propuesta 2: Rediseñé la capa de caché, reduciendo la latencia p95 del checkout.~~',
        '  - motivo: Más conciso.',
        '  - verificación: ✗ VIOLATION_C2_FACT_OMITTED (40)',
        '  - procedencia: 24000 ms · tokens 493 + 121',
        '',
        '## ach-2 · Logros transversales',
        '',
        'Original: Mentora de 5 personas.',
        '',
        '- ✗ sin propuestas: timeout: Typst…',
        '',
        '## ach-3 · Logros transversales',
        '',
        'Original: Ponente.',
        '',
        '- [ ] Propuesta 1: Fui ponente.',
        '  - motivo: x',
        '  - verificación: ✓ aceptada',
        '  - procedencia: desde caché',
        '',
        '## ach-4 · Logros transversales',
        '',
        'Original: Autora.',
        '',
        '- [ ] Propuesta 1: Fui autora.',
        '  - motivo: y',
        '  - verificación: ✓ aceptada',
        '  - procedencia: 3 ms · tokens 3 + ?',
        '',
        '## ach-5 · Logros transversales',
        '',
        'Original: Editora.',
        '',
        '- [ ] Propuesta 1: Fui editora.',
        '  - motivo: z',
        '  - verificación: ✓ aceptada',
        '  - procedencia: 4 ms · tokens ? + 4',
        '',
      ].join('\n'),
    );
    expect(formatReview({ task: 'improve', generatedAt: 'x', provider: { id: 'ollama', baseUrl: 'u', model: 'm' }, promptVersion: 'improve.v1', temperature: 0, seed: 7 }, [])).toContain('- especialidad: ninguna (perfil completo) · oferta: ninguna\n');
  });
});
