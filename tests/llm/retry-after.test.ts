/**
 * El «retry-after» del proveedor tiene que llegar entero hasta quien decide si espera (T-9.16). Antes se perdía
 * al interpretar la respuesta —el error conservaba el código y el mensaje pero no los segundos—, y con él se
 * perdía la única información que permite esperar lo justo. Aquí se comprueba en las cinco tareas de una vez,
 * porque el fallo estaba en las cinco.
 */
import { describe, expect, it } from 'vitest';

import { interpretImportMap, importMapFragment } from '../../src/llm/tasks/import-map';
import { buildImproveFragment, interpretImprove } from '../../src/llm/tasks/improve';
import { interpretOfferMap, offerMapFragment } from '../../src/llm/tasks/offer-map';
import { buildSuggestTagsFragment, interpretSuggestTags } from '../../src/llm/tasks/suggest-tags';
import { buildSummarizeFragment, interpretSummarize } from '../../src/llm/tasks/summarize';
import { closedDictionary } from '../../src/core/llm/tags';
import { parseMasterProfile } from '../../src/core/schema';
import { fullProfileInput } from '../fixtures/master-profile';
import type { LlmCompletion } from '../../src/llm/provider';

const profile = parseMasterProfile(fullProfileInput());
const [experience] = profile.experience;
const [achievement] = experience!.achievements;

/** Un 429 con su espera, y el mismo sin ella: el proveedor no siempre lo dice. */
const quota = (retryAfterSeconds?: number): LlmCompletion => ({ ok: false, code: 'quota-exceeded', message: 'cuota agotada', ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) });

describe('el «retry-after» sobrevive a la interpretación', () => {
  it('en las cinco tareas, con y sin segundos', () => {
    const mejorar = buildImproveFragment(profile, achievement!.id)!;
    expect(interpretImprove(mejorar, quota(11))).toMatchObject({ code: 'quota-exceeded', retryAfterSeconds: 11 });
    expect(interpretImprove(mejorar, quota())).not.toHaveProperty('retryAfterSeconds');

    expect(interpretSummarize(buildSummarizeFragment(profile), quota(12))).toMatchObject({ retryAfterSeconds: 12 });

    const dictionary = closedDictionary(profile);
    const etiquetar = dictionary.ok ? buildSuggestTagsFragment(profile, { text: 'Migré la plataforma' }, dictionary.dictionary) : undefined;
    expect(interpretSuggestTags(etiquetar!, quota(13))).toMatchObject({ retryAfterSeconds: 13 });

    const lineas = [{ n: 9, text: 'ACME, 2020 – 2021' }];
    expect(interpretImportMap(importMapFragment(lineas)!, lineas, quota(14))).toMatchObject({ retryAfterSeconds: 14 });

    const oferta = offerMapFragment('Buscamos mensajería', ['kafka']);
    expect(interpretOfferMap(oferta!, new Set(), quota(15))).toMatchObject({ retryAfterSeconds: 15 });
  });
});
