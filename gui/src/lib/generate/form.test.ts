import { describe, expect, it } from 'vitest';

import { EMPTY_FORM, buildAnalyzeRequest, buildGenerateRequest, selectionSummary, projectOptions, skillGroups, specialtyPreview } from './form';

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
      skillsMode: 'include',
      projectsMode: 'include',
      compact: true,
      output: 'mi-cv.pdf',
      build: true,
      copilot: false,
      copilotProvider: '',
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

  it('la misma lista se envía como «solo estas» o como «todas menos estas» según el modo', () => {
    const con = { ...EMPTY_FORM, skills: ['PHP'], projects: ['proj-a'] };
    expect(buildGenerateRequest(con)).toMatchObject({ ok: true, body: { skills: ['PHP'], projects: ['proj-a'] } });
    const sin = buildGenerateRequest({ ...con, skillsMode: 'exclude', projectsMode: 'exclude' });
    expect(sin).toMatchObject({ ok: true, body: { excludeSkills: ['PHP'], excludeProjects: ['proj-a'] } });
    // Y no se envían las dos formas de la misma lista.
    expect(sin.ok && 'skills' in sin.body).toBe(false);
    // Sin nada elegido, el modo no manda nada: «todas menos ninguna» es «todas».
    expect(buildGenerateRequest({ ...EMPTY_FORM, skillsMode: 'exclude' })).toEqual({ ok: true, body: { format: 'pdf', engine: 'pdfkit' } });
  });

  it('el resumen de la selección dice si se queda o se quita, sin obligar a abrir el selector', () => {
    expect(selectionSummary([], 'include', 'todas')).toBe('todas');
    expect(selectionSummary([], 'exclude', 'todas')).toBe('todas');
    expect(selectionSummary(['PHP'], 'include', 'todas')).toBe('1');
    expect(selectionSummary(['PHP', 'Go'], 'exclude', 'todos')).toBe('todos menos 2');
  });

  it('el análisis exige una oferta y lleva la especialidad y build si se piden', () => {
    expect(buildAnalyzeRequest(EMPTY_FORM)).toMatchObject({ ok: false, message: expect.stringContaining('hace falta una oferta') });
    expect(buildAnalyzeRequest({ ...EMPTY_FORM, offerMode: 'text', offerText: '' })).toMatchObject({ ok: false });
    expect(buildAnalyzeRequest({ ...EMPTY_FORM, offerMode: 'text', offerText: 'Kubernetes', specialty: 'backend', build: true })).toEqual({ ok: true, body: { offer: { text: 'Kubernetes' }, specialty: 'backend', build: true } });
    expect(buildAnalyzeRequest({ ...EMPTY_FORM, offerMode: 'file', offerFile: 'o.txt' })).toEqual({ ok: true, body: { offer: { workspaceFile: 'o.txt' } } });
  });

  it('el co-piloto solo viaja si se pide, con su proveedor y con la confirmación del coste (T-9.10)', () => {
    const base = { ...EMPTY_FORM, offerMode: 'text' as const, offerText: 'Kubernetes' };
    // Sin la casilla no hay ni rastro de co-piloto en el cuerpo: cero red.
    expect(buildAnalyzeRequest(base)).toEqual({ ok: true, body: { offer: { text: 'Kubernetes' } } });
    expect(buildAnalyzeRequest({ ...base, copilot: true })).toEqual({ ok: true, body: { offer: { text: 'Kubernetes' }, copilot: {} } });
    expect(buildAnalyzeRequest({ ...base, copilot: true, copilotProvider: 'groq' }, 'e-1')).toEqual({
      ok: true,
      body: { offer: { text: 'Kubernetes' }, copilot: { provider: 'groq', consent: { estimateId: 'e-1' } } },
    });
    // El estimateId sin co-piloto no se cuela por su cuenta.
    expect(buildAnalyzeRequest(base, 'e-1')).toEqual({ ok: true, body: { offer: { text: 'Kubernetes' } } });
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

describe('specialtyPreview (T-8.6 S2)', () => {
  const profile = {
    specialties: [{ id: 'backend', title: 'Staff Backend Engineer', tags: ['go', 'kafka'] }],
    skills: [{ name: 'Go', category: 'language' }, { name: 'Kafka', category: 'platform' }],
    projects: [{ id: 'p1', name: 'P1', achievements: [{ id: 'a3', text: 'x', tags: ['kafka'] }] }],
    experience: [{ id: 'e1', achievements: [{ id: 'a1', text: 'x', tags: ['go'] }, { id: 'a2', text: 'y', tags: ['php'] }] }],
  } as never;

  it('sin perfil no hay vista previa; sin especialidad resume todo el perfil; con ella cuenta los logros que la reconocen', () => {
    expect(specialtyPreview(undefined, 'backend')).toBeUndefined();
    expect(specialtyPreview(profile, '')).toEqual({ headline: 'Todo el perfil, sin recortar', summary: '3 logros · 2 skills · 1 proyectos' });
    expect(specialtyPreview(profile, 'backend')).toEqual({ headline: 'Staff Backend Engineer', summary: '2 logros etiquetados · 2 skills · 1 proyectos' });
    expect(specialtyPreview(profile, 'nube')).toBeUndefined();
  });
});
