/**
 * El co-piloto como segunda fuente de requisitos (T-9.10), de punta a punta con un proveedor falso: planificar,
 * consentir con la estimación ya hecha, verificar cada propuesta y fundirla en el análisis. Lo que se comprueba
 * es que **el modelo solo añade**: sin `--copilot` el análisis es exactamente el de siempre.
 */
import { describe, expect, it, vi } from 'vitest';

import { analyzeOffer } from '../../src/app/analyze';
import { executeOfferMap, offerMapEstimate, planOfferMap } from '../../src/app/offer-map';
import { buildVocabulary, extractJobRequirements } from '../../src/core/keywords';
import { parseMasterProfile } from '../../src/core/schema';
import type { LlmProvider } from '../../src/llm/provider';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const PROFILE = parseMasterProfile({
  meta: { schemaVersion: 1 },
  personal: { fullName: 'Ada Ejemplo', links: [] },
  specialties: [{ id: 'backend', title: 'Backend', tags: ['kafka', 'ci-cd'] }],
  experience: [
    {
      id: 'exp-acme',
      company: 'ACME',
      role: 'Backend',
      dates: { start: '2020-01' },
      technologies: [],
      tags: ['kafka'],
      achievements: [{ id: 'exp-acme-1', text: 'Diseñé el bus de eventos.', tags: ['kafka'] }],
    },
  ],
  projects: [],
  education: [],
  certifications: [],
  skills: [
    { id: 'skill-kafka', name: 'Apache Kafka', category: 'platform', aliases: ['kafka'], tags: ['kafka'] },
    { id: 'skill-jenkins', name: 'Jenkins', category: 'tool', aliases: [], tags: ['ci-cd'] },
  ],
  achievements: [],
  languages: [],
});

const OFERTA = 'Buscamos experiencia en arquitectura orientada a eventos y despliegue continuo.';

function provider(json: unknown): LlmProvider {
  return {
    id: 'ollama',
    kind: 'local',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen3:8b',
    complete: () => Promise.resolve({ ok: true as const, json, raw: JSON.stringify(json), model: 'qwen3:8b', usage: {}, elapsedMs: 4 }),
    health: () => Promise.resolve({ ok: true as const, version: undefined, models: ['qwen3:8b'], modelAvailable: true }),
  };
}

function workspace(): MemoryFileSystem {
  return new MemoryFileSystem({
    '/work/data/sources/profile.md': '---\nfullName: Ada Ejemplo\n---\n',
    '/work/data/dist/profile.json': { kind: 'file', content: JSON.stringify(PROFILE), mode: 0o600 },
    '/work/offers/oferta.txt': OFERTA,
  });
}

describe('planOfferMap y executeOfferMap', () => {
  const vocabulary = buildVocabulary(PROFILE);
  const requirements = extractJobRequirements(OFERTA, vocabulary);

  it('envía la oferta y las etiquetas del perfil, y funde lo verificado', async () => {
    const planned = planOfferMap(OFERTA, requirements, vocabulary);
    expect(planned.ok && planned.plan.tags).toEqual(['ci-cd', 'kafka']);
    if (!planned.ok) {
      return;
    }
    const executed = await executeOfferMap(appContext(workspace()), planned.plan, requirements, {
      provider: provider({ mappings: [{ tag: 'kafka', emphasis: 'required', evidence: 'arquitectura orientada a eventos' }] }),
      cache: false,
    });
    expect(executed.ok && executed.outcome.requirements.tagWeights['kafka']).toBe(1);
    expect(executed.ok && executed.outcome.mappings).toHaveLength(1);
  });

  it('sin descartes, el progreso no habla de descartes', async () => {
    const planned = planOfferMap(OFERTA, requirements, vocabulary);
    if (!planned.ok) {
      return;
    }
    const progress: string[] = [];
    await executeOfferMap(appContext(workspace()), planned.plan, requirements, {
      provider: provider({ mappings: [{ tag: 'kafka', emphasis: 'required', evidence: 'arquitectura orientada a eventos' }] }),
      cache: false,
      progress: (line) => progress.push(line),
    });
    expect(progress.join(' ')).toContain('1 etiqueta(s) verificadas');
    expect(progress.join(' ')).not.toContain('descartada');
  });

  it('la estimación cuenta la petición y respeta el suelo de salida del proveedor', async () => {
    const planned = planOfferMap(OFERTA, requirements, vocabulary);
    if (!planned.ok) {
      return;
    }
    const sinSuelo = await offerMapEstimate(appContext(workspace()), planned.plan);
    const conSuelo = await offerMapEstimate(appContext(workspace()), planned.plan, 9000);
    expect(sinSuelo).toMatchObject({ requests: 1 });
    expect(conSuelo.maxOutputTokens).toBeGreaterThan(sinSuelo.maxOutputTokens);
  });

  it('sin oferta no hay nada que planificar', () => {
    expect(planOfferMap('   ', requirements, vocabulary)).toMatchObject({ ok: false, error: { code: 'invalid-data' } });
  });

  it('un fallo del proveedor se traduce a error del entorno, y una respuesta inválida a error de datos', async () => {
    const planned = planOfferMap(OFERTA, requirements, vocabulary);
    if (!planned.ok) {
      return;
    }
    const roto: LlmProvider = { ...provider({}), complete: () => Promise.resolve({ ok: false as const, code: 'timeout', message: 'tarde' }) };
    expect(await executeOfferMap(appContext(workspace()), planned.plan, requirements, { provider: roto, cache: false })).toMatchObject({ ok: false, error: { code: 'environment' } });
    const invalido = await executeOfferMap(appContext(workspace()), planned.plan, requirements, { provider: provider({ nope: 1 }), cache: false });
    expect(invalido).toMatchObject({ ok: false, error: { code: 'invalid-data' } });
  });
});

describe('analyzeOffer con el co-piloto', () => {
  const request = { profile: 'data/dist/profile.json', data: 'data/sources', offer: { kind: 'file' as const, path: 'offers/oferta.txt' }, build: false };

  it('sin --copilot el análisis es el determinista de siempre', async () => {
    const result = await analyzeOffer(appContext(workspace()), request);
    expect(result.ok && result.analysis.copilot).toBeUndefined();
    expect(result.ok && Object.keys(result.analysis.requirements.tagWeights)).toEqual([]);
  });

  it('con --copilot añade lo verificado y lo cuenta aparte, para poder juzgarlo', async () => {
    const progress: string[] = [];
    const result = await analyzeOffer(appContext(workspace()), {
      ...request,
      copilot: {
        provider: provider({
          mappings: [
            { tag: 'kafka', emphasis: 'required', evidence: 'arquitectura orientada a eventos' },
            { tag: 'inventada', evidence: 'arquitectura orientada a eventos' },
          ],
        }),
        progress: (line) => progress.push(line),
      },
    });
    expect(result.ok && result.analysis.requirements.tagWeights['kafka']).toBe(1);
    expect(result.ok && result.analysis.copilot?.mappings).toHaveLength(1);
    expect(result.ok && result.analysis.copilot?.rejected.unknownTag).toBe(1);
    expect(progress.join(' ')).toContain('etiqueta(s) verificadas');
  });

  it('un perfil sin etiquetas no tiene nada que refinar, y un proveedor que falla no rompe el análisis a medias', async () => {
    const sinTags = { ...PROFILE, specialties: [], experience: [], skills: [], projects: [], achievements: [] };
    const fs = workspace();
    await fs.writeFile('/work/data/dist/profile.json', JSON.stringify(sinTags), 0o600);
    expect(await analyzeOffer(appContext(fs), { ...request, copilot: { provider: provider({ mappings: [] }) } })).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('nada que refinar') as string },
    });
    const roto: LlmProvider = { ...provider({}), complete: () => Promise.resolve({ ok: false as const, code: 'timeout', message: 'tarde' }) };
    expect(await analyzeOffer(appContext(workspace()), { ...request, copilot: { provider: roto } })).toMatchObject({ ok: false, error: { code: 'environment' } });
  });

  it('el consentimiento se pide con la estimación hecha, y decir que no no envía nada', async () => {
    const consent = vi.fn(async () => false);
    const complete = vi.fn();
    const result = await analyzeOffer(appContext(workspace()), {
      ...request,
      copilot: { provider: { ...provider({ mappings: [] }), complete }, consent },
    });
    expect(result).toMatchObject({ ok: false, error: { message: expect.stringContaining('no se envió nada') as string } });
    expect(consent).toHaveBeenCalledWith(expect.objectContaining({ requests: 1 }));
    expect(complete).not.toHaveBeenCalled();
  });
});
