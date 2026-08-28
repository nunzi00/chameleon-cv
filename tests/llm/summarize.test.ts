import { describe, expect, it } from 'vitest';

import { parseMasterProfile } from '../../src/core/schema';
import { selectForSpecialty } from '../../src/core/selection';
import {
  MemoryLlmCache,
  SUMMARIZE_LIMITS,
  SUMMARIZE_PROMPT_VERSION,
  SUMMARY_ITEM_ID,
  SummarizeInputSchema,
  buildSummarizeFragment,
  loadSummarizePrompt,
  runSummarize,
  runSummarizeTask,
  summarizeJsonSchema,
  yearsOfExperience,
  type LlmCompletion,
  type LlmProvider,
  type LlmRequest,
} from '../../src/llm';
import { fullProfileInput } from '../fixtures/master-profile';

const NOW = new Date('2026-08-28T00:00:00Z');
const profile = parseMasterProfile(fullProfileInput());

function backend() {
  const selection = selectForSpecialty(profile, 'backend');
  if (!selection.ok) {
    throw new Error('selección');
  }
  return selection.selection.profile;
}

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

const ok = (proposals: ReadonlyArray<{ text: string; rationale: string }>): LlmCompletion => ({ ok: true, json: { proposals }, raw: JSON.stringify({ proposals }), model: 'fake-1', usage: { promptTokens: 300, completionTokens: 120 }, elapsedMs: 900 });

describe('buildSummarizeFragment (canon C4)', () => {
  it('representa el perfil filtrado sin contacto, con años calculados por código, corpus verificable y hechos clave demostrados', () => {
    const fragment = buildSummarizeFragment(backend(), { now: NOW, offerTerms: ['php', 'kafka'] });
    expect(SummarizeInputSchema.safeParse(fragment.input).success).toBe(true);
    expect(fragment.input).toMatchObject({
      locale: 'es-ES',
      paragraphs: SUMMARIZE_LIMITS.paragraphs,
      maxLength: SUMMARIZE_LIMITS.maxLength,
      proposals: SUMMARIZE_LIMITS.proposals,
      headline: 'Senior Backend Engineer',
      currentSummary: 'APIs y sistemas distribuidos.',
      yearsOfExperience: 5,
      offerTerms: ['php', 'kafka'],
    });
    // Orden de la vista (cronológico inverso), como en el CV.
    expect(fragment.input.experience.map((item) => [item.role, item.company, item.period, item.technologies, item.achievements])).toEqual([
      ['Tech Lead', 'Startup', 'jul 2024 – actualidad', '', []],
      ['Senior Backend Engineer', 'ACME Corp', 'mar 2021 – jun 2024', 'PHP 8, Symfony', ['Reduje la latencia p95 un 40 %. (-40 % p95)']],
    ]);
    expect(fragment.input.projects).toEqual([]);
    // En la fixture, PHP no declara categoría: cae en «Otras», tras las plataformas.
    expect(fragment.input.skills).toEqual([
      { category: 'Plataformas', names: 'Kubernetes' },
      { category: 'Otras', names: 'PHP' },
    ]);
    // El apellido de la fixture («Ejemplo») coincide con el nombre propio de la universidad: la seudonimización lo trata como nombre.
    expect(fragment.input.education).toEqual([{ degree: 'Grado en Ingeniería Informática', field: 'Software', institution: 'Universidad [NOMBRE]' }]);
    expect(fragment.input.certifications).toEqual(['CKA']);
    expect(fragment.input.languages).toEqual([
      { name: 'Español', level: 'nativo' },
      { name: 'Inglés', level: 'C1' },
    ]);
    expect(JSON.stringify(fragment.input)).not.toMatch(/example\.com|600 000|Madrid|github|Ada/);
    expect(fragment.corpus).toContain('ACME Corp');
    expect(fragment.corpus).toContain('Reduje la latencia p95 un 40 %. (-40 % p95)');
    // Hechos clave: tags de la especialidad y términos de la oferta que el perfil demuestra (kafka no).
    expect(fragment.keyFacts).toEqual(['php', 'kubernetes']);
  });

  it('seudonimiza el nombre y, si se pide, las empresas; deshace ambos; calcula los años con puestos en curso', () => {
    const input = fullProfileInput();
    input.personal = { ...input.personal, summary: 'Ada Ejemplo lidera equipos en ACME Corp.' };
    const redacted = buildSummarizeFragment(parseMasterProfile(input), { now: NOW, redactCompanies: true, paragraphs: 3, proposals: 1, maxLength: 500, locale: 'en' });
    expect(redacted.input.currentSummary).toBe('[NOMBRE] lidera equipos en [EMPRESA-1].');
    expect(redacted.input.experience.map((item) => item.company)).toEqual(['[EMPRESA-2]', '[EMPRESA-1]']);
    expect(redacted.input).toMatchObject({ paragraphs: 3, proposals: 1, maxLength: 500, locale: 'en' });
    expect(redacted.input.experience[0]?.period).toBe('Jul 2024 – present');
    expect(redacted.redaction.restore('[EMPRESA-2] y [NOMBRE]')).toBe('Startup y Ada Ejemplo');
    expect(yearsOfExperience(parseMasterProfile(input), NOW)).toBe(5);
    expect(yearsOfExperience(parseMasterProfile({ personal: { fullName: 'Ada' } }), NOW)).toBeUndefined();
    expect(yearsOfExperience(parseMasterProfile({ personal: { fullName: 'Ada' }, experience: [{ id: 'e', company: 'X', role: 'Y', dates: { start: '2020-01', end: '2020-06' } }] }), NOW)).toBe(0);
    const withProjects = buildSummarizeFragment(
      parseMasterProfile({
        personal: { fullName: 'Ada' },
        projects: [
          { id: 'p-1', name: 'Uno', role: 'Autora', technologies: ['Rust', 'Go'], dates: { start: '2020' }, achievements: [{ id: 'p-1-a', text: 'Publiqué la **versión** 1.', impact: '1k usuarios' }] },
          { id: 'p-2', name: 'Dos', achievements: [{ id: 'p-2-a', text: 'Mantuve el proyecto.' }] },
        ],
        education: [{ id: 'edu-1', institution: 'Escuela', degree: 'Máster' }],
      }),
    );
    expect(withProjects.input.education).toEqual([{ degree: 'Máster', institution: 'Escuela' }]);
    expect(withProjects.input.projects).toEqual([
      { name: 'Uno', role: 'Autora', technologies: 'Rust, Go', achievements: ['Publiqué la versión 1. (1k usuarios)'] },
      { name: 'Dos', technologies: '', achievements: ['Mantuve el proyecto.'] },
    ]);
    expect(withProjects.corpus).toContain('Rust, Go');
    const minimal = buildSummarizeFragment(parseMasterProfile({ personal: { fullName: 'Ada', headline: 'Titular' } }), { now: NOW });
    expect(minimal.input).toMatchObject({ headline: 'Titular', locale: 'es', experience: [] });
    expect('currentSummary' in minimal.input).toBe(false);
    expect('yearsOfExperience' in minimal.input).toBe(false);
    expect(minimal.keyFacts).toEqual([]);
  });
});

describe('prompt, esquema y ejecución', () => {
  it('el prompt versionado exige párrafos y prohíbe inventar; el esquema sale de zod; runSummarize valida y restaura', async () => {
    const prompt = await loadSummarizePrompt();
    expect(SUMMARIZE_PROMPT_VERSION).toBe('summarize.v1');
    expect(prompt).toContain('NO inventes cifras');
    expect(prompt).toContain('{"proposals": [{"text": "...", "rationale": "..."}]}');
    expect(summarizeJsonSchema()).toMatchObject({ type: 'object', required: ['proposals'] });

    const fragment = buildSummarizeFragment(backend(), { now: NOW, redactCompanies: true });
    const calls: LlmRequest[] = [];
    const result = await runSummarize(fakeProvider(ok([{ text: 'Ingeniera con experiencia en [EMPRESA-1] y PHP.\n\nReduje la latencia p95 un 40 %.', rationale: 'r' }]), calls), fragment, 'P', 500);
    expect(result).toMatchObject({ ok: true, proposals: [{ text: 'Ingeniera con experiencia en ACME Corp y PHP.\n\nReduje la latencia p95 un 40 %.', rationale: 'r' }], promptVersion: 'summarize.v1' });
    expect(calls[0]).toMatchObject({ schemaName: 'summarize', maxTokens: SUMMARIZE_LIMITS.maxTokens, timeoutMs: 500 });
    expect(await runSummarize(fakeProvider({ ok: false, code: 'timeout', message: 'tarde' }), fragment, 'P')).toEqual({ ok: false, code: 'timeout', message: 'tarde' });
    expect(await runSummarize(fakeProvider(ok([{ text: 'corto', rationale: 'r' }])), fragment, 'P')).toMatchObject({ ok: false, code: 'invalid-output' });
  });
});

describe('runSummarizeTask (canon C2 para síntesis: sin invención, cobertura de hechos clave)', () => {
  const fragment = buildSummarizeFragment(backend(), { now: NOW });
  const base = { profile, fragment, prompt: 'P', location: 'Resumen profesional · backend', now: () => NOW };

  it('acepta una síntesis fiel aunque use conectores nuevos, rechaza cifras o entidades inventadas y la falta total de hechos clave, e informa de la cobertura', async () => {
    const proposals = [
      { text: 'Senior Backend Engineer con 5 años de experiencia construyendo plataformas de pago con PHP y Kubernetes en ACME Corp; reduje la latencia p95 un 40 %.', rationale: 'fiel' },
      { text: 'Senior Backend Engineer con 12 años de experiencia en PHP, Kubernetes y AWS, liderando equipos de 30 personas.', rationale: 'inventa' },
      { text: 'Profesional con amplia experiencia en el desarrollo de software y el trabajo en equipo durante muchos años.', rationale: 'vacío' },
    ];
    const item = await runSummarizeTask({ ...base, provider: fakeProvider(ok(proposals)) });
    expect(item).toMatchObject({ id: SUMMARY_ITEM_ID, location: 'Resumen profesional · backend', original: 'APIs y sistemas distribuidos.', fromCache: false, elapsedMs: 900 });
    expect(item.proposals.map((proposal) => [proposal.verdict.accepted, proposal.verdict.violations.map((violation) => `${violation.code}:${violation.details.join('|')}`), proposal.verdict.coverage])).toEqual([
      [true, [], { mentioned: ['php', 'kubernetes'], missing: [] }],
      [false, ['VIOLATION_C2_NUMBER_ADDED:12|30', 'VIOLATION_C2_ENTITY_ADDED:AWS|aws'], { mentioned: ['php', 'kubernetes'], missing: [] }],
      [false, ['VIOLATION_C2_FACT_OMITTED:php|kubernetes'], { mentioned: [], missing: ['php', 'kubernetes'] }],
    ]);
  });

  it('usa la caché solo para respuestas válidas y devuelve el error del proveedor sin abortar', async () => {
    const cache = new MemoryLlmCache();
    const calls: LlmRequest[] = [];
    const proposals = [{ text: 'Senior Backend Engineer con PHP y Kubernetes; reduje la latencia p95 un 40 %.', rationale: 'r' }];
    const first = await runSummarizeTask({ ...base, provider: fakeProvider(ok(proposals), calls), cache });
    expect(first.fromCache).toBe(false);
    expect(cache.size).toBe(1);
    const second = await runSummarizeTask({ ...base, provider: fakeProvider(ok(proposals), calls), cache });
    expect(second).toMatchObject({ fromCache: true, elapsedMs: 0, usage: { promptTokens: 300, completionTokens: 120 } });
    expect(calls).toHaveLength(1);
    const key = [...(cache as unknown as { entries: Map<string, unknown> }).entries.keys()][0]!;
    await cache.set(key, { createdAt: 'x', model: 'm', raw: '{}', json: { proposals: [] }, usage: {}, elapsedMs: 0 });
    const third = await runSummarizeTask({ ...base, provider: fakeProvider(ok(proposals), calls), cache });
    expect(third.fromCache).toBe(false);
    expect(calls).toHaveLength(2);

    // Sin reloj inyectado, la entrada de caché lleva la fecha del sistema.
    const { now: _now, ...withoutClock } = base;
    const systemClock = new MemoryLlmCache();
    await runSummarizeTask({ ...withoutClock, provider: fakeProvider(ok(proposals)), cache: systemClock });
    expect(systemClock.size).toBe(1);

    const failed = await runSummarizeTask({ ...base, provider: fakeProvider({ ok: false, code: 'unreachable', message: 'caído' }) });
    expect(failed).toMatchObject({ error: 'unreachable: caído', proposals: [] });
    const noSummary = await runSummarizeTask({ ...base, fragment: buildSummarizeFragment(parseMasterProfile({ personal: { fullName: 'Ada' }, skills: [{ id: 's', name: 'PHP' }] }), { now: NOW }), provider: fakeProvider(ok([{ text: 'Perfil con conocimientos de PHP y vocación de servicio.', rationale: 'r' }])) });
    expect(noSummary.original).toBe('(sin resumen actual)');
    expect(noSummary.proposals[0]?.verdict).toEqual({ accepted: true, violations: [], coverage: { mentioned: [], missing: [] } });
  });
});
