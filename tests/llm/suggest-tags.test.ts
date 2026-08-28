import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { closedDictionary, type ClosedDictionary } from '../../src/core/llm/tags';
import type { MasterProfile } from '../../src/core/schema';
import {
  MemoryLlmCache,
  SUGGEST_TAGS_LIMITS,
  SUGGEST_TAGS_PROMPT_VERSION,
  buildSuggestTagsFragment,
  formatTagLine,
  interpretSuggestTags,
  loadSuggestTagsPrompt,
  runSuggestTagsBatch,
  suggestTagsJsonSchema,
  suggestTagsMessages,
  tagStats,
  type LlmProvider,
  type LlmRequest,
} from '../../src/llm';
import { NodeFileSystem, defaultSourceParsers, loadDataset } from '../../src/parsers';

let profile: MasterProfile;
let dictionary: ClosedDictionary;

beforeAll(async () => {
  const dataset = await loadDataset(join(__dirname, '../fixtures/dataset'), { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
  if (!dataset.ok) {
    throw new Error('dataset');
  }
  profile = dataset.profile;
  const result = closedDictionary(profile);
  if (!result.ok) {
    throw new Error(result.message);
  }
  dictionary = result.dictionary;
});

function fakeProvider(calls: LlmRequest[], suggestions: unknown = [{ tag: 'php', reason: 'usa PHP en [EMPRESA-1]' }, { tag: 'aws', reason: 'no está' }], fail = false): LlmProvider {
  return {
    id: 'ollama',
    kind: 'local',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'fake',
    complete: (request) => {
      calls.push(request);
      if (fail) {
        return Promise.resolve({ ok: false, code: 'timeout', message: 'tarde' });
      }
      const json = { suggestions };
      return Promise.resolve({ ok: true, json, raw: JSON.stringify(json), model: 'fake-1', usage: { promptTokens: 10, completionTokens: 5 }, elapsedMs: 7 });
    },
    health: () => Promise.resolve({ ok: true, version: undefined, models: ['fake'], modelAvailable: true }),
  };
}

describe('fragmento de suggest tags (canon C4: mínimo y seudonimizado)', () => {
  it('de un logro del perfil: texto, tags actuales, contexto del contenedor, especialidades y diccionario', () => {
    const fragment = buildSuggestTagsFragment(profile, { id: 'exp-acme-1' }, dictionary, { redactCompanies: true, maxTags: 3, locale: 'en' });
    expect(fragment?.input).toEqual({
      id: 'exp-acme-1',
      text: 'Reduje la latencia p95 del checkout un **40 %** rediseñando la capa de caché.',
      currentTags: ['performance', 'php'],
      locale: 'en',
      maxTags: 3,
      context: { role: 'Senior Backend Engineer', company: '[EMPRESA-1]', technologies: ['PHP 8.3', 'Symfony 6.4', 'Kubernetes'] },
      specialties: dictionary.specialties.map((specialty) => ({ ...specialty, tags: [...specialty.tags] })),
      dictionary: ['php', 'symfony', 'kubernetes', 'kafka', 'liderazgo', 'gestion', 'agile'],
    });
    expect(fragment?.contextText).toBe('Senior Backend Engineer · PHP 8.3 · Symfony 6.4 · Kubernetes · php · symfony · kubernetes');
    expect(fragment?.currentTags).toEqual(['performance', 'php']);
    expect(JSON.stringify(fragment?.input)).not.toMatch(/ACME|example\.com|Madrid/);
    const transversal = buildSuggestTagsFragment(profile, { id: 'ach-1' }, dictionary);
    expect(transversal?.input).toMatchObject({ id: 'ach-1', locale: 'es-ES', maxTags: SUGGEST_TAGS_LIMITS.maxTags, context: { technologies: [] } });
    expect(transversal?.contextText).toBe('');
  });

  it('de un texto suelto (con sus hashtags como tags actuales); nada si el id no existe o el texto está vacío', () => {
    const fragment = buildSuggestTagsFragment(profile, { text: '  Migré la plataforma de Ada Ejemplo a Kubernetes  ', currentTags: ['devops'] }, dictionary);
    expect(fragment?.input).toMatchObject({ text: 'Migré la plataforma de [NOMBRE] a Kubernetes', currentTags: ['devops'], context: { technologies: [] } });
    expect(fragment?.input.id).toBeUndefined();
    expect(fragment?.text).toBe('Migré la plataforma de Ada Ejemplo a Kubernetes');
    expect(buildSuggestTagsFragment(profile, { text: 'sin tags' }, dictionary)?.currentTags).toEqual([]);
    expect(buildSuggestTagsFragment(profile, { id: 'nope' }, dictionary)).toBeUndefined();
    expect(buildSuggestTagsFragment(profile, { text: '   ' }, dictionary)).toBeUndefined();
    expect(buildSuggestTagsFragment(profile, {}, dictionary)).toBeUndefined();
    const meta = { ...profile.meta };
    delete meta.locale;
    expect(buildSuggestTagsFragment({ ...profile, meta }, { text: 'sin locale' }, dictionary)?.input.locale).toBe('es');
  });

  it('el JSON Schema para el proveedor restringe la etiqueta al diccionario (enum); el prompt versionado existe', async () => {
    const schema = suggestTagsJsonSchema(['php', 'kafka']) as { properties: { suggestions: { items: { properties: { tag: { enum: string[] } } } } } };
    expect(schema.properties.suggestions.items.properties.tag.enum).toEqual(['php', 'kafka']);
    const prompt = await loadSuggestTagsPrompt();
    expect(prompt).toContain('Diccionario cerrado');
    expect(SUGGEST_TAGS_PROMPT_VERSION).toBe('suggest-tags.v1');
    const fragment = buildSuggestTagsFragment(profile, { id: 'exp-acme-1' }, dictionary);
    if (fragment === undefined) throw new Error('fragmento');
    expect(suggestTagsMessages(fragment, prompt)).toEqual([
      { role: 'system', content: prompt },
      { role: 'user', content: JSON.stringify(fragment.input) },
    ]);
  });

  it('interpreta respuestas: error del proveedor, esquema incumplido y seudónimos deshechos en la justificación', () => {
    const fragment = buildSuggestTagsFragment(profile, { id: 'exp-acme-1' }, dictionary, { redactCompanies: true });
    if (fragment === undefined) throw new Error('fragmento');
    expect(interpretSuggestTags(fragment, { ok: false, code: 'timeout', message: 'tarde' })).toEqual({ ok: false, code: 'timeout', message: 'tarde' });
    expect(interpretSuggestTags(fragment, { ok: true, json: { nope: true }, raw: '{}', model: 'm', usage: {}, elapsedMs: 1 })).toMatchObject({ ok: false, code: 'invalid-output', message: expect.stringContaining('no cumple el esquema de «suggest tags»') });
    const ok = interpretSuggestTags(fragment, { ok: true, json: { suggestions: [{ tag: 'php', reason: 'en [EMPRESA-1]' }] }, raw: '{}', model: 'm', usage: {}, elapsedMs: 1 });
    expect(ok).toMatchObject({ ok: true, suggestions: [{ tag: 'php', reason: 'en ACME Corp' }], promptVersion: 'suggest-tags.v1' });
  });
});

describe('lote de suggest tags: caché, verificación y estadísticas', () => {
  it('verifica cada etiqueta contra el diccionario, cachea y la segunda ejecución sale de la caché', async () => {
    const calls: LlmRequest[] = [];
    const cache = new MemoryLlmCache();
    const progress: string[] = [];
    const fragments = [buildSuggestTagsFragment(profile, { id: 'exp-acme-1' }, dictionary), buildSuggestTagsFragment(profile, { text: 'Migré a Kubernetes' }, dictionary)].filter((fragment) => fragment !== undefined);
    const items = await runSuggestTagsBatch({ profile, fragments, provider: fakeProvider(calls), prompt: 'p', cache, now: () => new Date('2026-08-29T10:00:00.000Z'), progress: (line) => progress.push(line) });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: 'exp-acme-1', location: 'Senior Backend Engineer · ACME Corp', currentTags: ['performance', 'php'], accepted: [{ tag: 'php', evidence: 'contexto', isNew: false, reason: 'usa PHP en [EMPRESA-1]' }], rejected: [{ tag: 'aws', code: 'VIOLATION_CLOSED_DICTIONARY' }], fromCache: false, elapsedMs: 7 });
    expect(items[1]).toMatchObject({ id: undefined, location: 'texto', text: 'Migré a Kubernetes', accepted: [{ tag: 'php', evidence: 'inferida', isNew: true }] });
    expect(calls[0]?.schemaName).toBe('suggest-tags');
    expect(calls[0]?.maxTokens).toBe(SUGGEST_TAGS_LIMITS.maxTokens);
    expect(progress).toEqual(['[1/2] exp-acme-1: #php (0 literal · 1 por contexto · 0 inferida) · 7 ms', '[2/2] texto: #php (0 literal · 0 por contexto · 1 inferida) · 7 ms']);
    expect(cache.size).toBe(2);
    expect(formatTagLine(items[0] as NonNullable<(typeof items)[0]>)).toBe('#php');
    expect(tagStats(items)).toEqual({ items: 2, suggested: 2, fresh: 1, rejected: 2, failed: 0, fromCache: 0 });

    const again = await runSuggestTagsBatch({ profile, fragments, provider: fakeProvider(calls), prompt: 'p', cache, progress: (line) => progress.push(line) });
    expect(calls).toHaveLength(2);
    expect(again.every((item) => item.fromCache)).toBe(true);
    expect(progress[2]).toBe('[1/2] exp-acme-1: #php · desde caché');
  });

  it('una entrada de caché inválida se ignora; un fallo del proveedor no aborta el lote; sin etiquetas del diccionario', async () => {
    const calls: LlmRequest[] = [];
    const cache = new MemoryLlmCache();
    const fragment = buildSuggestTagsFragment(profile, { id: 'exp-acme-k8s' }, dictionary);
    if (fragment === undefined) throw new Error('fragmento');
    const first = await runSuggestTagsBatch({ profile, fragments: [fragment], provider: fakeProvider(calls), prompt: 'p', cache });
    expect(first[0]?.fromCache).toBe(false);
    for (const [key] of (cache as unknown as { entries: Map<string, unknown> }).entries) {
      await cache.set(key, { createdAt: 'x', model: 'm', raw: '{}', json: { nope: true }, usage: {}, elapsedMs: 0 });
    }
    const second = await runSuggestTagsBatch({ profile, fragments: [fragment], provider: fakeProvider(calls, [{ tag: 'aws', reason: 'fuera' }]), prompt: 'p', cache });
    expect(calls).toHaveLength(2);
    expect(second[0]).toMatchObject({ accepted: [], rejected: [{ tag: 'aws', code: 'VIOLATION_CLOSED_DICTIONARY' }], fromCache: false });
    expect(formatTagLine(second[0] as NonNullable<(typeof second)[0]>)).toBe('');
    const cachedEmpty: string[] = [];
    const third = await runSuggestTagsBatch({ profile, fragments: [fragment], provider: fakeProvider(calls), prompt: 'p', cache, progress: (line) => cachedEmpty.push(line) });
    expect(calls).toHaveLength(2);
    expect(third[0]).toMatchObject({ fromCache: true, accepted: [] });
    expect(cachedEmpty).toEqual(['[1/1] exp-acme-k8s: ninguna etiqueta del diccionario · desde caché']);
    const progress: string[] = [];
    const failed = await runSuggestTagsBatch({ profile, fragments: [fragment], provider: fakeProvider(calls, [], true), prompt: 'p', progress: (line) => progress.push(line) });
    expect(failed[0]).toMatchObject({ error: 'timeout: tarde', accepted: [], rejected: [], fromCache: false, usage: {} });
    expect(progress).toEqual(['[1/1] exp-acme-k8s: fallo (timeout)']);
    expect(tagStats(failed)).toEqual({ items: 1, suggested: 0, fresh: 0, rejected: 0, failed: 1, fromCache: 0 });
    const empty = await runSuggestTagsBatch({ profile, fragments: [fragment], provider: fakeProvider(calls, []), prompt: 'p', progress: (line) => progress.push(line) });
    expect(empty[0]?.accepted).toEqual([]);
    expect(progress[1]).toBe('[1/1] exp-acme-k8s: ninguna etiqueta del diccionario (0 literal · 0 por contexto · 0 inferida) · 7 ms');
  });
});
