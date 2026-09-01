/**
 * Tarea `offer map` (T-9.10): el co-piloto lee una oferta y propone etiquetas del perfil que el emparejado
 * literal no vio. Lo que se prueba aquí son las dos guardas —la etiqueta ha de estar en el vocabulario enviado y
 * la evidencia ha de aparecer literalmente en la oferta— y la fusión, que jamás deja al modelo por encima de lo
 * que la oferta dice con todas sus letras.
 */
import { describe, expect, it } from 'vitest';

import { interpretOfferMap, offerMapFragment, offerMapJsonSchema } from '../../src/llm/tasks/offer-map';
import { mergeOfferMap, profileTags } from '../../src/app/offer-map';
import type { JobRequirements, Vocabulary } from '../../src/core/keywords';
import type { LlmCompletion } from '../../src/llm/provider';

const OFERTA = 'Buscamos una persona con experiencia en arquitectura orientada a eventos y en despliegue continuo. Valorable Python.';
const TAGS = ['kafka', 'arquitectura', 'ci-cd', 'python'];

function completion(json: unknown): LlmCompletion {
  return { ok: true, json, raw: JSON.stringify(json), model: 'm', usage: {}, elapsedMs: 3 };
}

const fragment = offerMapFragment(OFERTA, TAGS)!;

describe('interpretOfferMap: las dos guardas', () => {
  it('acepta la etiqueta del vocabulario cuya evidencia está literalmente en la oferta', () => {
    const result = interpretOfferMap(fragment, new Set(), completion({ mappings: [{ tag: 'kafka', emphasis: 'required', evidence: 'arquitectura orientada a eventos' }] }));
    expect(result.ok && result.mappings).toEqual([{ tag: 'kafka', emphasis: 'required', evidence: 'arquitectura orientada a eventos' }]);
  });

  it('descarta la etiqueta inventada y la evidencia que no está en la oferta, contando cada motivo', () => {
    const result = interpretOfferMap(
      fragment,
      new Set(),
      completion({
        mappings: [
          // Una etiqueta que no está en el vocabulario: el modelo no puede inventar competencias.
          { tag: 'rust', evidence: 'arquitectura orientada a eventos' },
          // Una evidencia que la oferta no dice: aquí es donde se caza la alucinación.
          { tag: 'python', evidence: 'diez años de experiencia con Django' },
        ],
      }),
    );
    expect(result.ok && result.mappings).toEqual([]);
    expect(result.ok && result.rejected).toMatchObject({ unknownTag: 1, unverifiedEvidence: 1 });
  });

  it('descarta lo repetido y lo que el emparejado literal ya había encontrado', () => {
    const result = interpretOfferMap(
      fragment,
      new Set(['python']),
      completion({
        mappings: [
          { tag: 'python', evidence: 'Valorable Python' },
          { tag: 'ci-cd', evidence: 'despliegue continuo' },
          { tag: 'ci-cd', evidence: 'despliegue continuo' },
        ],
      }),
    );
    expect(result.ok && result.mappings.map((mapping) => mapping.tag)).toEqual(['ci-cd']);
    expect(result.ok && result.rejected).toMatchObject({ alreadyKnown: 1, duplicate: 1 });
  });

  it('sin `emphasis` la propuesta vale, pero como «unknown»: no se le supone urgencia', () => {
    const result = interpretOfferMap(fragment, new Set(), completion({ mappings: [{ tag: 'ci-cd', evidence: 'despliegue continuo' }] }));
    expect(result.ok && result.mappings[0]).toMatchObject({ emphasis: 'unknown' });
  });

  it('una respuesta que no cumple el esquema se explica en vez de colarse', () => {
    expect(interpretOfferMap(fragment, new Set(), completion({ mapeos: [] }))).toMatchObject({ ok: false, code: 'invalid-output' });
    expect(interpretOfferMap(fragment, new Set(), { ok: false, code: 'timeout', message: 'tarde' })).toMatchObject({ ok: false, code: 'timeout' });
  });

  it('el esquema que se envía al proveedor restringe la etiqueta al vocabulario', () => {
    const schema = offerMapJsonSchema(TAGS) as { properties: { mappings: { items: { properties: { tag: { enum: string[] } } } } } };
    expect(schema.properties.mappings.items.properties.tag.enum).toEqual(TAGS);
  });

  it('«required» lista TODAS las propiedades: la salida estricta de Groq y OpenAI rechaza el esquema si falta una', () => {
    // Fallo real (1-sep) con Groq: HTTP 400 «/properties/mappings/items/required: … must be listed: emphasis»,
    // y con él la orden entera se caía. El esquema se envía tal cual, así que la guarda va sobre el esquema.
    const schema = offerMapJsonSchema(TAGS) as { properties: { mappings: { items: { required: string[]; properties: Record<string, unknown> } } } };
    expect(schema.properties.mappings.items.required).toEqual(Object.keys(schema.properties.mappings.items.properties));
  });

  it('sin oferta o sin etiquetas no hay nada que enviar', () => {
    expect(offerMapFragment('   ', TAGS)).toBeUndefined();
    expect(offerMapFragment(OFERTA, [])).toBeUndefined();
  });
});

describe('mergeOfferMap: el modelo añade, nunca manda', () => {
  const requirements: JobRequirements = {
    terms: [{ term: 'python', tags: ['python'], occurrences: 3, emphasis: 'required', weight: 1.5, contexts: ['Valorable Python'] }],
    tagWeights: { python: 1.5 },
    gaps: ['kafka', 'terraform'],
  };

  it('añade la etiqueta con el peso de una evidencia única y la saca de las carencias', () => {
    const merged = mergeOfferMap(requirements, [{ tag: 'kafka', emphasis: 'required', evidence: 'arquitectura orientada a eventos' }]);
    expect(merged.tagWeights).toEqual({ python: 1.5, kafka: 1 });
    // Sin refuerzo por frecuencia: el modelo aporta que el requisito existe, no cuántas veces se repite. Así una
    // propuesta suya nunca pesa más que un término que la oferta nombra tres veces.
    expect(merged.tagWeights['kafka']).toBeLessThan(merged.tagWeights['python']!);
    expect(merged.gaps).toEqual(['terraform']);
    expect(merged.terms.find((term) => term.tags.includes('kafka'))).toMatchObject({ source: 'copiloto', occurrences: 1 });
  });

  it('el peso sigue la escala del extractor: imprescindible pesa más que deseable, y lo indeterminado va en medio', () => {
    const pesos = (['required', 'desirable', 'unknown'] as const).map(
      (emphasis) => mergeOfferMap(requirements, [{ tag: 'kafka', emphasis, evidence: 'e' }]).tagWeights['kafka'],
    );
    expect(pesos[0]).toBeGreaterThan(pesos[2]!);
    expect(pesos[2]).toBeGreaterThan(pesos[1]!);
  });

  it('no baja el peso de una etiqueta que el emparejado literal ya puntuó más alto', () => {
    const merged = mergeOfferMap(requirements, [{ tag: 'python', emphasis: 'desirable', evidence: 'Valorable Python' }]);
    expect(merged.tagWeights['python']).toBe(1.5);
  });
});

describe('profileTags', () => {
  it('es lo único del candidato que sale hacia el modelo: sus etiquetas, sin nombres de skill', () => {
    const vocabulary: Vocabulary = new Map([
      ['apache kafka', new Set(['kafka', 'arquitectura'])],
      ['jenkins', new Set(['ci-cd'])],
    ]);
    expect(profileTags(vocabulary)).toEqual(['arquitectura', 'ci-cd', 'kafka']);
  });
});
