/**
 * Del borrador estructurado a los ficheros de fuentes (T-8.4b): validación entidad a entidad con degradación
 * al informe (nunca inventar), identificadores únicos, niveles de idioma MCER, banner de borrador y README.
 */
import { describe, expect, it } from 'vitest';

import { draftFiles, draftReport, mapLanguageLevel, unplacedFromReport, withProposals } from '../../src/import/draft';
import type { DraftProfile } from '../../src/import/structure';

const EMPTY: DraftProfile = {
  fullName: undefined,
  headline: undefined,
  email: undefined,
  phone: undefined,
  location: undefined,
  links: [],
  summary: undefined,
  experience: [],
  projects: [],
  education: [],
  certifications: [],
  skills: [],
  achievements: [],
  languages: [],
  sections: [],
  unparsed: [],
};

const PROV = { line: 3, text: 'línea de origen' };

function entry(overrides: Partial<DraftProfile['experience'][number]>): DraftProfile['experience'][number] {
  return { title: 'Puesto', subtitle: 'Empresa', location: undefined, start: '2020-01', end: '2021-06', current: false, date: undefined, url: undefined, field: undefined, summary: undefined, technologies: [], achievements: [], provenance: PROV, ...overrides };
}

describe('mapLanguageLevel', () => {
  it('traduce niveles libres al MCER y deja lo irreconocible sin nivel', () => {
    expect(mapLanguageLevel('Nativo')).toBe('native');
    expect(mapLanguageLevel('bilingüe')).toBe('native');
    expect(mapLanguageLevel('C1')).toBe('C1');
    expect(mapLanguageLevel('b2.')).toBe('B2');
    expect(mapLanguageLevel('Fluido')).toBe('C1');
    expect(mapLanguageLevel('advanced')).toBe('C1');
    expect(mapLanguageLevel('Intermedio')).toBe('B1');
    expect(mapLanguageLevel('básico')).toBe('A2');
    expect(mapLanguageLevel('regular')).toBeUndefined();
    expect(mapLanguageLevel(undefined)).toBeUndefined();
  });
});

describe('draftFiles', () => {
  it('sin nombre usa «Nombre pendiente» y lo avisa; los .md salen LIMPIOS (la procedencia vive en el README)', () => {
    const result = draftFiles(EMPTY);
    expect(result.profile.personal.fullName).toBe('Nombre pendiente');
    expect(result.issues.map((issue) => issue.reason).join(' ')).toContain('no se reconoció el nombre');
    for (const file of result.files) {
      expect(file.content).not.toContain('<!--');
    }
  });

  it('mapea contacto y enlaces (etiqueta del host); un enlace irrecuperable se degrada', () => {
    const result = draftFiles(
      { ...EMPTY, fullName: 'Ada Ejemplo', headline: 'Backend', email: 'ada@example.org', phone: '+34 600 000 000', location: 'Valencia', links: ['https://github.com/ada', 'www.ejemplo.dev', ':::'] });
    expect(result.profile.personal.links.map((link) => link.label)).toEqual(['Github', 'Ejemplo']);
    expect(result.issues.some((issue) => issue.reason.includes('enlace no reconocido'))).toBe(true);
    expect(result.profile.personal.location?.city).toBe('Valencia');
  });

  it('un campo personal que no cumple el esquema se retira con aviso y el resto sobrevive', () => {
    const result = draftFiles({ ...EMPTY, fullName: 'Ada', phone: 'x'.repeat(60) });
    expect(result.profile.personal.fullName).toBe('Ada');
    expect(result.profile.personal.phone).toBeUndefined();
    expect(result.issues.some((issue) => issue.reason.startsWith('phone descartado'))).toBe(true);
  });

  it('experiencia sin fechas va al informe con su línea; sin empresa lleva «Empresa pendiente» con aviso', () => {
    const result = draftFiles(
      { ...EMPTY, fullName: 'Ada', experience: [entry({ start: undefined }), entry({ subtitle: undefined, title: 'Backend' })] });
    expect(result.profile.experience).toHaveLength(1);
    expect(result.profile.experience[0]?.company).toBe('Empresa pendiente');
    expect(result.issues.some((issue) => issue.reason.includes('sin fechas reconocibles') && issue.provenance?.line === 3)).toBe(true);
  });

  it('proyectos, formación y certificaciones aceptan sus formas; los ids se deduplican', () => {
    const result = draftFiles(
      {
        ...EMPTY,
        fullName: 'Ada',
        projects: [entry({ title: 'Guardian', subtitle: 'Autora', url: 'https://x.dev', achievements: [{ text: 'Publiqué la 1.0.', impact: '30 equipos', provenance: PROV }] })],
        education: [entry({ title: 'Máster en Datos', subtitle: 'UV', field: 'Datos' }), entry({ title: 'Máster en Datos', subtitle: 'UV' })],
        certifications: [entry({ title: 'CKA', subtitle: 'CNCF', start: undefined, date: '2021-04' })],
      });
    expect(result.profile.projects[0]).toMatchObject({ name: 'Guardian', role: 'Autora', url: 'https://x.dev' });
    expect(result.profile.projects[0]?.achievements[0]?.impact).toBe('30 equipos');
    expect(result.profile.education.map((item) => item.id)).toEqual(['edu-master-en-datos-uv', 'edu-master-en-datos-uv-2']);
    expect(result.profile.certifications[0]).toMatchObject({ name: 'CKA', issuer: 'CNCF', date: '2021-04' });
  });

  it('el campo opcional culpable se retira (la entrada sobrevive) y una entrada irrecuperable se descarta', () => {
    const result = draftFiles(
      { ...EMPTY, fullName: 'Ada', projects: [entry({ title: 'Web', url: 'nourl' }), entry({ title: 'x'.repeat(200) })] });
    expect(result.profile.projects).toHaveLength(1);
    expect(result.profile.projects[0]?.url).toBeUndefined();
    expect(result.issues.some((issue) => issue.reason.includes('url descartado'))).toBe(true);
    expect(result.issues.some((issue) => issue.reason.startsWith('proyecto descartada') || issue.reason.startsWith('proyecto descartad'))).toBe(true);
  });

  it('habilidades con categoría del diccionario; idiomas con nivel provisional B2 avisado; logros generales', () => {
    const result = draftFiles(
      {
        ...EMPTY,
        fullName: 'Ada',
        skills: [{ category: 'language', names: ['PHP', 'PHP'], provenance: PROV }, { category: undefined, names: ['Kafka'], provenance: PROV }],
        languages: [{ name: 'Español', level: 'nativo' }, { name: 'Inglés', level: undefined }],
        achievements: [{ text: 'Ponente en PHP Valencia.', impact: undefined, provenance: PROV }],
      });
    expect(result.profile.skills.map((skill) => skill.id)).toEqual(['skill-php', 'skill-php-2', 'skill-kafka']);
    expect(result.profile.skills[0]?.category).toBe('language');
    expect(result.profile.skills[2]?.category).toBe('other');
    expect(result.profile.languages).toEqual([{ name: 'Español', level: 'native' }, { name: 'Inglés', level: 'B2' }]);
    expect(result.issues.some((issue) => issue.reason.includes('B2 provisional'))).toBe(true);
    expect(result.profile.achievements).toHaveLength(1);
  });
});

describe('draftReport', () => {
  it('resume lo reconocido y lista lo degradado y lo sin situar con sus líneas', () => {
    const result = draftFiles({ ...EMPTY, unparsed: [{ line: 9, text: 'algo suelto' }] });
    const report = draftReport(result, 'cv.pdf', '2026-08-30T21:00:00.000Z');
    expect(report).toContain('# Informe del borrador importado');
    expect(report).toContain('- Origen: cv.pdf');
    expect(report).toContain('0 experiencias · 0 proyectos');
    expect(report).toContain('## Sin situar');
    expect(report).toContain('línea 9: algo suelto');
    expect(report).toContain('## Degradado o avisado');
  });

  it('lista las propuestas del co-piloto sin aplicarlas, con y sin justificación (T-8.4b F2)', () => {
    const result = draftFiles({ ...EMPTY, unparsed: [{ line: 9, text: 'algo suelto' }] });
    const report = draftReport(result, 'cv.pdf', '2026-08-30T21:00:00.000Z', [
      { n: 9, section: 'experiencia', reason: 'entidad con fechas', text: 'algo suelto' },
      { n: 10, section: 'descartar', reason: '', text: 'C A B E C E R A' },
    ]);
    expect(report).toContain('## Propuestas del co-piloto (no aplicadas)');
    expect(report).toContain('- línea 9 → **experiencia**: algo suelto _(entidad con fechas)_');
    expect(report).toContain('- línea 10 → **descartar**: C A B E C E R A\n');
  });

  it('avisa de la formación abierta con una sola fecha (T-8.4b F2)', () => {
    const result = draftFiles({
      ...EMPTY,
      education: [{ title: 'Grado en Filología', subtitle: 'Universitat de València', start: '2014-05', singleDate: true, technologies: [], achievements: [], provenance: { line: 14, text: 'Grado en Filología | may 2014' } }],
    });
    expect(result.issues.map((issue) => issue.reason)).toContain('formación con una sola fecha: «Grado en Filología» la toma como inicio; ajústala si era la de graduación');
  });
});

describe('informe del borrador: lectura y actualización (T-8.18)', () => {
  const base = ['# Informe', '', '## Degradado o avisado', '', '- algo', '', '## Sin situar (revísalo a mano)', '', '- línea 9: algo suelto', '- ruido que no es una línea', '', '## Otra cosa', '', '- fin', ''].join('\n');

  it('lee solo las líneas sin situar de su sección y para en el título siguiente', () => {
    expect(unplacedFromReport(base)).toEqual([{ line: 9, text: 'algo suelto' }]);
    expect(unplacedFromReport('# Informe\n\n- Origen: cv.pdf\n')).toEqual([]);
  });

  it('inserta las propuestas antes de «Sin situar» y las sustituye si se repite el refinado', () => {
    const once = withProposals(base, [{ n: 9, section: 'experiencia', reason: 'con fechas', text: 'algo suelto' }]);
    expect(once).toContain('## Propuestas del co-piloto (no aplicadas)');
    expect(once.indexOf('## Propuestas')).toBeLessThan(once.indexOf('## Sin situar'));
    expect(once).toContain('- línea 9 → **experiencia**: algo suelto _(con fechas)_');
    const twice = withProposals(once, [{ n: 9, section: 'descartar', reason: '', text: 'algo suelto' }]);
    expect(twice.match(/## Propuestas del co-piloto/g)).toHaveLength(1);
    expect(twice).toContain('- línea 9 → **descartar**: algo suelto\n');
    expect(twice).toContain('## Otra cosa');
    // Sin propuestas la sección desaparece del informe.
    expect(withProposals(once, [])).not.toContain('## Propuestas del co-piloto');
  });

  it('sin sección «Sin situar» las propuestas van al final, y una sección final se sustituye entera', () => {
    const plain = '# Informe\n\n- Origen: cv.pdf\n';
    const added = withProposals(plain, [{ n: 4, section: 'idioma', reason: '', text: 'Inglés C1' }]);
    expect(added).toBe('# Informe\n\n- Origen: cv.pdf\n\n## Propuestas del co-piloto (no aplicadas)\n\nEl co-piloto solo PROPONE dónde iría cada línea sin situar; nada se ha escrito en el borrador. Muévelas tú si estás de acuerdo.\n\n- línea 4 → **idioma**: Inglés C1\n');
    expect(withProposals(added, [{ n: 4, section: 'habilidad', reason: '', text: 'Inglés C1' }])).toContain('- línea 4 → **habilidad**: Inglés C1');
    // Un informe sin salto final también termina con exactamente uno.
    expect(withProposals('# Informe', [{ n: 1, section: 'resumen', reason: '', text: 'Perfil' }])).toBe('# Informe\n\n## Propuestas del co-piloto (no aplicadas)\n\nEl co-piloto solo PROPONE dónde iría cada línea sin situar; nada se ha escrito en el borrador. Muévelas tú si estás de acuerdo.\n\n- línea 1 → **resumen**: Perfil\n');
  });
});
