import { describe, expect, it } from 'vitest';

import { EMPTY_COPILOT_FORM, buildJobRequest, parseOnly } from './form';

describe('formulario del co-piloto', () => {
  it('improve: cuerpo mínimo, completo y validado', () => {
    expect(buildJobRequest(EMPTY_COPILOT_FORM)).toEqual({ ok: true, body: { kind: 'improve', body: {} } });
    const full = buildJobRequest({
      ...EMPTY_COPILOT_FORM,
      specialty: 'backend',
      offerMode: 'text',
      offerText: ' Kubernetes ',
      only: 'ach-1, ach-2 ach-1',
      proposals: '2',
      maxLength: '200',
      maxItems: '5',
      redactCompanies: true,
      locale: 'en',
      output: 'revision-mia.md',
      cache: false,
      provider: 'openai',
      model: 'gpt-x',
      topN: '3',
      compact: true,
    });
    expect(full).toEqual({ ok: true, body: { kind: 'improve', body: { provider: 'openai', model: 'gpt-x', cache: false, redactCompanies: true, locale: 'en', specialty: 'backend', offer: { text: 'Kubernetes' }, topN: 3, compact: true, only: ['ach-1', 'ach-2'], proposals: 2, maxLength: 200, maxItems: 5, output: 'revision-mia.md' } } });
    expect(buildJobRequest({ ...EMPTY_COPILOT_FORM, proposals: '4' })).toEqual({ ok: false, message: 'Propuestas debe estar entre 1 y 3' });
    expect(buildJobRequest({ ...EMPTY_COPILOT_FORM, maxLength: '10' })).toEqual({ ok: false, message: 'Longitud máxima debe estar entre 40 y 1000' });
    expect(buildJobRequest({ ...EMPTY_COPILOT_FORM, maxItems: '0' })).toEqual({ ok: false, message: 'Logros por ejecución debe estar entre 1 y 500' });
    expect(buildJobRequest({ ...EMPTY_COPILOT_FORM, maxItems: 'x' })).toMatchObject({ ok: false, message: expect.stringContaining('entero') });
    expect(buildJobRequest({ ...EMPTY_COPILOT_FORM, output: '../x.md' })).toMatchObject({ ok: false, message: expect.stringContaining('sin directorios') });
    expect(buildJobRequest({ ...EMPTY_COPILOT_FORM, offerMode: 'file', offerFile: '' })).toMatchObject({ ok: false });
    expect(buildJobRequest({ ...EMPTY_COPILOT_FORM, topN: '-1' })).toMatchObject({ ok: false, message: expect.stringContaining('Top N') });
  });

  it('summarize: párrafos y longitud con sus rangos', () => {
    expect(buildJobRequest({ ...EMPTY_COPILOT_FORM, kind: 'summarize', paragraphs: '2', proposals: '1', maxLength: '900', output: 'resumen.md' })).toEqual({ ok: true, body: { kind: 'summarize', body: { paragraphs: 2, proposals: 1, maxLength: 900, output: 'resumen.md' } } });
    expect(buildJobRequest({ ...EMPTY_COPILOT_FORM, kind: 'summarize', paragraphs: '4' })).toEqual({ ok: false, message: 'Párrafos debe estar entre 1 y 3' });
    expect(buildJobRequest({ ...EMPTY_COPILOT_FORM, kind: 'summarize', maxLength: '50' })).toEqual({ ok: false, message: 'Longitud máxima debe estar entre 100 y 5000' });
    expect(buildJobRequest({ ...EMPTY_COPILOT_FORM, kind: 'summarize', proposals: '0' })).toMatchObject({ ok: false });
    expect(buildJobRequest({ ...EMPTY_COPILOT_FORM, kind: 'summarize', offerMode: 'text', offerText: '' })).toMatchObject({ ok: false });
    expect(buildJobRequest({ ...EMPTY_COPILOT_FORM, kind: 'summarize', output: 'a/b' })).toMatchObject({ ok: false });
  });

  it('suggest-tags: texto suelto o logros del perfil, con etiquetas y presupuesto', () => {
    expect(buildJobRequest({ ...EMPTY_COPILOT_FORM, kind: 'suggest-tags', text: ' Migré a Kubernetes ', only: 'ach-1', untagged: true, maxTags: '3', maxItems: '10', specialty: 'backend' })).toEqual({ ok: true, body: { kind: 'suggest-tags', body: { text: 'Migré a Kubernetes', specialty: 'backend', maxTags: 3, maxItems: 10 } } });
    expect(buildJobRequest({ ...EMPTY_COPILOT_FORM, kind: 'suggest-tags', only: 'ach-1 ach-2', untagged: true })).toEqual({ ok: true, body: { kind: 'suggest-tags', body: { only: ['ach-1', 'ach-2'], untagged: true } } });
    expect(buildJobRequest({ ...EMPTY_COPILOT_FORM, kind: 'suggest-tags' })).toEqual({ ok: true, body: { kind: 'suggest-tags', body: {} } });
    expect(buildJobRequest({ ...EMPTY_COPILOT_FORM, kind: 'suggest-tags', maxTags: '0' })).toEqual({ ok: false, message: 'Etiquetas por logro debe estar entre 1 y 20' });
    expect(buildJobRequest({ ...EMPTY_COPILOT_FORM, kind: 'suggest-tags', maxItems: '9999' })).toMatchObject({ ok: false });
    expect(parseOnly('')).toBeUndefined();
    expect(parseOnly(' a,b  c ,a')).toEqual(['a', 'b', 'c']);
  });
});
