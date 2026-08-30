import { describe, expect, it } from 'vitest';

import { EMPTY_FORM, buildAnalyzeRequest, buildGenerateRequest, projectOptions, skillGroups } from './form';

describe('formulario de Generar', () => {
  it('construye el cuerpo mínimo y el completo, sin campos vacíos ni opciones que no aplican', () => {
    expect(buildGenerateRequest(EMPTY_FORM)).toEqual({ ok: true, body: { format: 'pdf', engine: 'pdfkit' } });
    expect(buildGenerateRequest({ ...EMPTY_FORM, format: 'md', engine: 'typst', theme: 'classic' })).toEqual({ ok: true, body: { format: 'md' } });
    expect(buildGenerateRequest({ ...EMPTY_FORM, engine: 'typst', theme: '' })).toEqual({ ok: true, body: { format: 'pdf', engine: 'typst' } });
    const full = buildGenerateRequest({
      specialty: 'backend',
      offerMode: 'text',
      offerText: '  Buscamos Kubernetes  ',
      offerFile: '',
      format: 'pdf',
      engine: 'typst',
      theme: 'classic',
      locale: ' en ',
      topN: '3',
      maxSkills: '0',
      maxProjects: '2',
      maxCertifications: '1',
      skills: ['PHP', 'Kubernetes'],
      projects: ['proj-a'],
      compact: true,
      output: 'mi-cv.pdf',
      build: true,
    });
    expect(full).toEqual({ ok: true, body: { specialty: 'backend', offer: { text: 'Buscamos Kubernetes' }, format: 'pdf', engine: 'typst', theme: 'classic', locale: 'en', output: 'mi-cv.pdf', build: true, topN: 3, maxSkills: 0, maxProjects: 2, maxCertifications: 1, skills: ['PHP', 'Kubernetes'], projects: ['proj-a'], compact: true } });
    expect(buildGenerateRequest({ ...EMPTY_FORM, offerMode: 'file', offerFile: ' ofertas/acme.txt ' })).toEqual({ ok: true, body: { offer: { workspaceFile: 'ofertas/acme.txt' }, format: 'pdf', engine: 'pdfkit' } });
  });

  it('rechaza ofertas vacías, límites que no son enteros y nombres de fichero con directorios', () => {
    expect(buildGenerateRequest({ ...EMPTY_FORM, offerMode: 'text', offerText: '  ' })).toMatchObject({ ok: false, message: expect.stringContaining('Pega el texto') });
    expect(buildGenerateRequest({ ...EMPTY_FORM, offerMode: 'file', offerFile: '' })).toMatchObject({ ok: false, message: expect.stringContaining('fichero de la oferta') });
    expect(buildGenerateRequest({ ...EMPTY_FORM, topN: '-1' })).toEqual({ ok: false, message: 'Top N debe ser un entero mayor o igual que 0' });
    expect(buildGenerateRequest({ ...EMPTY_FORM, maxSkills: '2.5' })).toEqual({ ok: false, message: 'Skills debe ser un entero mayor o igual que 0' });
    expect(buildGenerateRequest({ ...EMPTY_FORM, maxProjects: 'x' })).toMatchObject({ ok: false });
    expect(buildGenerateRequest({ ...EMPTY_FORM, maxCertifications: '99999999999999999999' })).toMatchObject({ ok: false });
    expect(buildGenerateRequest({ ...EMPTY_FORM, output: '../fuera.md' })).toMatchObject({ ok: false, message: expect.stringContaining('sin directorios') });
  });

  it('el análisis exige una oferta y lleva la especialidad y build si se piden', () => {
    expect(buildAnalyzeRequest(EMPTY_FORM)).toMatchObject({ ok: false, message: expect.stringContaining('hace falta una oferta') });
    expect(buildAnalyzeRequest({ ...EMPTY_FORM, offerMode: 'text', offerText: '' })).toMatchObject({ ok: false });
    expect(buildAnalyzeRequest({ ...EMPTY_FORM, offerMode: 'text', offerText: 'Kubernetes', specialty: 'backend', build: true })).toEqual({ ok: true, body: { offer: { text: 'Kubernetes' }, specialty: 'backend', build: true } });
    expect(buildAnalyzeRequest({ ...EMPTY_FORM, offerMode: 'file', offerFile: 'o.txt' })).toEqual({ ok: true, body: { offer: { workspaceFile: 'o.txt' } } });
  });
});

describe('selectores de skills y proyectos', () => {
  it('agrupa las skills por categoría y lista los proyectos; sin perfil, nada', () => {
    const profile = { skills: [{ name: 'PHP', category: 'language' }, { name: 'Kubernetes', category: 'platform' }, { name: 'Python', category: 'language' }], projects: [{ id: 'proj-a', name: 'A' }] } as never;
    expect(skillGroups(profile)).toEqual([
      { category: 'language', names: ['PHP', 'Python'] },
      { category: 'platform', names: ['Kubernetes'] },
    ]);
    expect(projectOptions(profile)).toEqual([{ id: 'proj-a', name: 'A' }]);
    expect(skillGroups(undefined)).toEqual([]);
    expect(projectOptions(undefined)).toEqual([]);
  });

  it('las listas seleccionadas viajan en el cuerpo y las vacías no', () => {
    expect(buildGenerateRequest({ ...EMPTY_FORM, skills: ['PHP'], projects: [] })).toEqual({ ok: true, body: { format: 'pdf', engine: 'pdfkit', skills: ['PHP'] } });
  });
});
