import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseMasterProfile } from '../../src/core/schema';
import {
  IMPROVE_LIMITS,
  IMPROVE_PROMPT_VERSION,
  ImproveInputSchema,
  PROMPTS_DIRECTORY,
  buildImproveFragment,
  improveJsonSchema,
  loadPrompt,
  runImprove,
  type LlmCompletion,
  type LlmProvider,
  type LlmRequest,
} from '../../src/llm';
import { fullProfileInput } from '../fixtures/master-profile';

function fakeProvider(completion: LlmCompletion, calls: LlmRequest[] = []): LlmProvider {
  return {
    id: 'ollama',
    kind: 'local',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'fake',
    complete: (request) => {
      calls.push(request);
      return Promise.resolve(completion);
    },
    health: () => Promise.resolve({ ok: true, version: undefined, models: ['fake'], modelAvailable: true }),
  };
}

describe('buildImproveFragment (canon C4: solo lo necesario, seudonimizado)', () => {
  it('localiza logros de experiencias, proyectos y transversales con su contexto, y nunca incluye datos de contacto', () => {
    const profile = parseMasterProfile(fullProfileInput());
    const experience = buildImproveFragment(profile, 'ach-acme-latency', { offerTerms: ['php', 'kubernetes'] });
    expect(experience?.input).toEqual({
      id: 'ach-acme-latency',
      text: 'Reduje la latencia p95 un **40 %**.',
      impact: '-40 % p95',
      locale: 'es-ES',
      maxLength: IMPROVE_LIMITS.maxLength,
      proposals: IMPROVE_LIMITS.proposals,
      context: { role: 'Senior Backend Engineer', company: 'ACME Corp', technologies: ['PHP 8', 'Symfony'], specialty: 'Senior Backend Engineer', offerTerms: ['php', 'kubernetes'] },
    });
    expect(JSON.stringify(experience?.input)).not.toMatch(/example\.com|600 000|Madrid|github/);
    expect(ImproveInputSchema.safeParse(experience?.input).success).toBe(true);

    const transversal = buildImproveFragment(profile, 'ach-talk', { locale: 'en', proposals: 3, maxLength: 120 });
    expect(transversal?.input).toMatchObject({ id: 'ach-talk', locale: 'en', proposals: 3, maxLength: 120, context: { technologies: [], offerTerms: [] } });
    expect('role' in (transversal?.input.context ?? {})).toBe(false);

    const project = buildImproveFragment(
      parseMasterProfile({ ...fullProfileInput(), projects: [{ id: 'p', name: 'Chameleon', role: 'Autora', technologies: ['TypeScript'], achievements: [{ id: 'p-1', text: 'Diseñé el esquema.' }] }] }),
      'p-1',
    );
    expect(project?.input.context).toEqual({ role: 'Autora', company: 'Chameleon', technologies: ['TypeScript'], specialty: 'Senior Backend Engineer', offerTerms: [] });
    expect(buildImproveFragment(profile, 'no-existe')).toBeUndefined();
  });

  it('seudonimiza el nombre siempre y la empresa si se pide, y deshace ambos', () => {
    const input = fullProfileInput();
    input.experience![0]!.achievements = [{ id: 'a', text: 'Ada Ejemplo lideró en ACME Corp el proyecto de Ada (ada@example.com).' }];
    const profile = parseMasterProfile(input);
    const fragment = buildImproveFragment(profile, 'a', { redactCompanies: true });
    expect(fragment?.input.text).toBe('[NOMBRE] lideró en [EMPRESA-1] el proyecto de [NOMBRE] ([EMAIL-1]).');
    expect(fragment?.input.context.company).toBe('[EMPRESA-1]');
    expect(fragment?.redaction.restore('[NOMBRE] en [EMPRESA-1]')).toBe('Ada Ejemplo en ACME Corp');
    const kept = buildImproveFragment(profile, 'a');
    expect(kept?.input.context.company).toBe('ACME Corp');
    const noLocale = buildImproveFragment(parseMasterProfile({ personal: { fullName: 'Ada' }, achievements: [{ id: 't', text: 'Logro' }] }), 't');
    expect(noLocale?.input).toMatchObject({ locale: 'es', context: { technologies: [], offerTerms: [] } });
    expect('specialty' in (noLocale?.input.context ?? {})).toBe(false);
  });
});

describe('prompt y esquema', () => {
  it('el prompt versionado existe, exige JSON y prohíbe inventar; el JSON Schema sale del mismo zod', async () => {
    const prompt = await loadPrompt();
    expect(IMPROVE_PROMPT_VERSION).toBe('improve.v1');
    expect(PROMPTS_DIRECTORY.endsWith('prompts')).toBe(true);
    expect(prompt).toContain('NO añadas ninguno');
    expect(prompt).toContain('{"proposals": [{"text": "...", "rationale": "..."}]}');
    const schema = improveJsonSchema();
    expect(schema).toMatchObject({ type: 'object', required: ['proposals'], additionalProperties: false });
    const directory = await mkdtemp(join(tmpdir(), 'chameleon-prompts-'));
    try {
      await writeFile(join(directory, 'improve.v9.md'), '  prompt de prueba \n');
      expect(await loadPrompt('improve.v9', directory)).toBe('prompt de prueba');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('runImprove (canon C6: validado con zod; seudónimos deshechos)', () => {
  const profile = parseMasterProfile(fullProfileInput());
  const fragment = buildImproveFragment(profile, 'ach-acme-latency', { redactCompanies: true })!;

  it('envía sistema + fragmento JSON con el esquema y devuelve las propuestas restauradas', async () => {
    const calls: LlmRequest[] = [];
    const provider = fakeProvider(
      { ok: true, json: { proposals: [{ text: 'Rediseñé la caché de [EMPRESA-1] y reduje la latencia p95 un 40 %', rationale: 'verbo de acción' }] }, raw: '{}', model: 'fake', usage: { promptTokens: 1 }, elapsedMs: 5 },
      calls,
    );
    const result = await runImprove(provider, fragment, 'PROMPT', 1234);
    expect(result).toEqual({
      ok: true,
      proposals: [{ text: 'Rediseñé la caché de ACME Corp y reduje la latencia p95 un 40 %', rationale: 'verbo de acción' }],
      raw: '{}',
      model: 'fake',
      usage: { promptTokens: 1 },
      elapsedMs: 5,
      promptVersion: 'improve.v1',
    });
    expect(calls[0]).toMatchObject({ schemaName: 'improve', maxTokens: IMPROVE_LIMITS.maxTokens, timeoutMs: 1234, messages: [{ role: 'system', content: 'PROMPT' }, { role: 'user', content: JSON.stringify(fragment.input) }] });
    expect(calls[0]?.schema).toEqual(improveJsonSchema());
  });

  it('propaga los fallos del proveedor y rechaza salidas que no cumplen el esquema', async () => {
    expect(await runImprove(fakeProvider({ ok: false, code: 'timeout', message: 'tarde' }), fragment, 'P')).toEqual({ ok: false, code: 'timeout', message: 'tarde' });
    const bad = await runImprove(fakeProvider({ ok: true, json: { proposals: [] }, raw: '', model: 'f', usage: {}, elapsedMs: 1 }), fragment, 'P');
    expect(bad).toMatchObject({ ok: false, code: 'invalid-output', message: expect.stringContaining('La respuesta no cumple el esquema de «improve»: proposals:') });
    const extra = await runImprove(fakeProvider({ ok: true, json: { proposals: [{ text: 'x', rationale: 'y', extra: 1 }] }, raw: '', model: 'f', usage: {}, elapsedMs: 1 }), fragment, 'P');
    expect(extra).toMatchObject({ ok: false, code: 'invalid-output' });
  });
});
