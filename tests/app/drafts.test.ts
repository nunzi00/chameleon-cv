/**
 * Los borradores de `import/` para quien los revisa (T-9.19): listarlos, agrupar lo que parece la misma cosa y
 * adoptar entradas sueltas en `data/sources/` sin pisar nada. Los casos de agrupado están tomados del corpus
 * real que destapó cada regla: el «Centro pendiente» que emparejaba siete titulaciones distintas, el encadenado
 * que unía dos ciclos por el nombre del instituto y el empleo de cuatro años que se tragaba tres cursos.
 */
import { describe, expect, it } from 'vitest';

import { ADOPTABLE_SECTIONS, adoptEntries, draftDuplicates, groupDuplicates, isBackupName, listDrafts, periodsOverlap, readReport, signatureOf, similarity, type DraftEntry, type DuplicateMember } from '../../src/app/drafts';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

/* ───────────────────────────── ayudas ───────────────────────────── */

const PROFILE = ['---', 'schemaVersion: 1', 'locale: es-ES', 'fullName: Ada Ejemplo', 'links: []', '---', ''].join('\n');

function experienceFile(company: string, role: string, start: string, end?: string): string {
  return ['---', `company: ${company}`, `role: ${role}`, `start: ${start}`, ...(end === undefined ? [] : [`end: ${end}`]), '---', ''].join('\n');
}

function educationFile(institution: string, degree: string, start?: string, end?: string): string {
  return ['---', `institution: ${institution}`, `degree: ${degree}`, ...(start === undefined ? [] : [`start: ${start}`]), ...(end === undefined ? [] : [`end: ${end}`]), '---', ''].join('\n');
}

const REPORT = [
  '# Informe del borrador importado',
  '',
  '- Origen: CV Lucas.pdf',
  '- Importado: 2026-09-02T12:08:17.894Z',
  '',
  '## Degradado o avisado',
  '',
  '- experiencia sin empresa reconocida: «Monbus» lleva «Empresa pendiente» (línea 61: «Monbus»)',
  '- formación sin centro reconocido: «COU» lleva «Centro pendiente» (línea 25: «COU»)',
  '',
  '## Sin situar (revísalo a mano)',
  '',
  '- línea 63: Informática',
  '- línea 65: Prácticas de formación.',
  '',
].join('\n');

/** Una entrada suelta para las reglas puras (sin disco). */
function entry(title: string, start?: string, end?: string, section: DraftEntry['section'] = 'experience'): DraftEntry {
  return { section, id: `x-${title.length}-${start ?? ''}`, title, start, end, path: `${section}/x.md` };
}

function member(draft: string | undefined, title: string, start?: string, end?: string, section: DraftEntry['section'] = 'experience'): DuplicateMember {
  return { draft, entry: entry(title, start, end, section) };
}

/* ───────────────────────────── reglas puras ───────────────────────────── */

describe('signatureOf: qué palabras cuentan para parecerse', () => {
  it('no cuenta lo que el importador escribe cuando NO reconoció el dato', () => {
    // «Centro pendiente» es la marca de que falta el centro, no el nombre de un centro: contarlo emparejaba
    // entre sí las siete formaciones de un mismo CV, porque todas lo llevan.
    expect(signatureOf('COU · Centro pendiente').tokens).toEqual(['cou'.length >= 4 ? 'cou' : 'cou'].filter((token) => token.length >= 4));
    expect(signatureOf('Bachillerato · Centro pendiente').tokens).toEqual(['bachillerato']);
    expect(signatureOf('Desarrollador · Empresa pendiente').tokens).toEqual(['desarrollador']);
  });

  it('descarta las palabras cortas, las vacías y las formas societarias', () => {
    expect(signatureOf('Soporte técnico a usuarios · RedCoruna S.L.U.').tokens).toEqual(['soporte', 'tecnico', 'usuarios', 'redcoruna']);
  });

  it('reconoce el texto espaciado letra a letra y guarda su cadena pegada', () => {
    const spaced = signatureOf('Desarrollador · C O N C E L L O D E L U G O');
    expect(spaced.spaced).toBe(true);
    expect(spaced.glued).toContain('concellodelugo');
    expect(signatureOf('Desarrollador · Concello de Lugo').spaced).toBe(false);
  });
});

describe('similarity: cuánto se parecen dos entradas', () => {
  it('empareja el mismo empleo aunque el CV cambie el orden de empresa y puesto', () => {
    // Medio corpus llega con company y role intercambiados; por eso se comparan las palabras de los dos juntas.
    const a = signatureOf('Servicio técnico sistemas · Baser Lugo');
    const b = signatureOf('Desarrollador web · Baser Lugo');
    expect(similarity(a, b)).toBeGreaterThanOrEqual(0.5);
  });

  it('busca las palabras dentro de la cadena pegada cuando el PDF espació el texto', () => {
    // «B A S E R  L U G O» llega ya sin la frontera entre palabras: comparar palabra a palabra da 0.
    const spaced = signatureOf('Desarrollador Web - Técnico Hardware/Sistemas · B A S E R L U G O');
    const plain = signatureOf('Servicio técnico sistemas · Baser Lugo');
    expect(spaced.spaced).toBe(true);
    expect(similarity(spaced, plain)).toBeGreaterThanOrEqual(0.5);
    expect(similarity(plain, spaced)).toBe(similarity(spaced, plain));
  });

  it('no empareja dos empleos que solo comparten la ciudad', () => {
    expect(similarity(signatureOf('Desarrollador · Concello de Lugo'), signatureOf('Servicio técnico sistemas · Baser Lugo'))).toBeLessThan(0.5);
  });
});

describe('periodsOverlap: cuándo dos periodos son el mismo', () => {
  it('exige solapamiento de verdad, no un mes compartido', () => {
    // «Graduado Escolar 1986–1993» y «Bachillerato 1993–1997» comparten 1993 y son dos cosas distintas.
    expect(periodsOverlap(entry('Graduado', '1986', '1993'), entry('Bachillerato', '1993', '1997'))).toBe(false);
  });

  it('un periodo largo no se traga uno corto que caiga dentro', () => {
    // Con la comparación contra el más corto, contener puntuaba siempre 1 y «Monitor Informática 2006–2009»
    // absorbía los tres cursos de tres meses que caen dentro.
    expect(periodsOverlap(entry('Monitor Informática', '2006', '2009'), entry('Monitor Informática curso 4078', '2007-05', '2007-07'))).toBe(false);
  });

  it('acepta el mismo empleo con los bordes movidos entre CV', () => {
    expect(periodsOverlap(entry('Concello', '2016-09', '2017-05'), entry('Concello', '2016-11', '2017-04'))).toBe(true);
    expect(periodsOverlap(entry('Baser', '2011-04', '2012-04'), entry('Baser', '2010-10', '2012-04'))).toBe(true);
  });

  it('empareja el empleo en curso de un CV con el mismo empleo ya cerrado en otro', () => {
    expect(periodsOverlap(entry('Raiola', '2017-09'), entry('Raiola', '2017-09', '2021-06'))).toBe(true);
  });

  it('sin fechas no descarta: deciden las palabras', () => {
    expect(periodsOverlap(entry('Informática de gestión'), entry('Informática de gestión', '1998', '2000'))).toBe(true);
  });
});

describe('groupDuplicates: agrupar sin decidir', () => {
  it('junta el mismo empleo de varios borradores y señala si ya está en las fuentes', () => {
    const groups = groupDuplicates([
      member(undefined, 'Backend Developer · Life5', '2022-05', '2022-12'),
      member('cv-a', 'Software Developer · Life5', '2022-04'),
      member('cv-b', 'Life5 · Software Developer', '2022-04'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toHaveLength(3);
    expect(groups[0]?.inSources).toBe(true);
  });

  it('dos titulaciones distintas del MISMO centro no caen en el mismo grupo', () => {
    // El caso real que obligó a dejar el encadenado: agrupando en cadena, «C. S. Administrador de Sistemas» y
    // «C. S. Desarrollo de Aplicaciones Web» acababan juntas porque compartían el nombre del instituto.
    const groups = groupDuplicates([
      member('cv-a', 'Ciclo Superior Administrador de Sistemas · I.E.S Muralla Romana', '2008', '2010', 'education'),
      member('cv-b', 'C . S . A D M I N I S T R A D O R D E S I S T E M A S · I.E.S Muralla Romana', '2008', '2010', 'education'),
      member('cv-c', 'Ciclo Superior Desarrollo de Aplicaciones Web · I.E.S Muralla Romana', '2011', '2013', 'education'),
      member('cv-d', 'C . S . D E S A R R O L L O D E A P L I C A C I O N E S W E B · I.E.S Muralla Romana', '2011', '2013', 'education'),
    ]);
    expect(groups).toHaveLength(2);
    const titles = groups.map((group) => group.members.map((each) => each.entry.title));
    expect(titles.some((group) => group.some((title) => title.includes('Administrador')) && group.some((title) => title.toLowerCase().includes('desarrollo')))).toBe(false);
  });

  it('LÍMITE CONOCIDO: una entrada sin fechas puede caer en un grupo con el que solo comparte el centro', () => {
    // Sin fechas no hay nada que separe, y el nombre del centro basta para llegar al umbral. Se deja así a
    // propósito: agrupar de menos esconde duplicados, y agrupar de más solo cuesta una mirada porque el grupo
    // es una PREGUNTA —quien revisa ve los miembros y elige—, no una fusión. Queda escrito para que se sepa.
    const groups = groupDuplicates([
      member('cv-a', 'C . S . A D M I N I S T R A D O R D E S I S T E M A S · I.E.S Muralla Romana', '2008', '2010', 'education'),
      member('cv-b', 'desarrollo de aplicaciones web · ies muralla romana', undefined, undefined, 'education'),
    ]);
    expect(groups).toHaveLength(1);
  });

  it('no mezcla secciones ni saca grupos de uno', () => {
    const groups = groupDuplicates([member('cv-a', 'Desarrollador · Acme', '2020-01', '2021-01'), member('cv-b', 'Desarrollador · Acme', '2020-01', '2021-01', 'education'), member('cv-c', 'Otra cosa distinta · Beta', '2005-01', '2006-01')]);
    expect(groups).toEqual([]);
  });
});

/* ───────────────────────────── sobre el disco ───────────────────────────── */

describe('listDrafts: lo que hay en import/', () => {
  it('sin carpeta import/ no hay error, hay cero borradores', async () => {
    expect(await listDrafts(appContext(new MemoryFileSystem({})))).toEqual({ ok: true, drafts: [] });
  });

  it('lista cada borrador con sus cuentas y lo que dice su informe, y deja fuera las copias de --replace', async () => {
    const fs = new MemoryFileSystem({
      '/work/import/mio/profile.md': PROFILE,
      '/work/import/mio/README.md': REPORT,
      '/work/import/mio/experience/acme.md': experienceFile('Acme', 'Backend', '2020-01', '2021-01'),
      '/work/import/mio/education/ies.md': educationFile('I.E.S.', 'Ciclo', '2008', '2010'),
      '/work/import/mio.20260902-140535.bak/profile.md': PROFILE,
    });
    const listed = await listDrafts(appContext(fs));
    expect(listed.ok && listed.drafts.map((draft) => draft.name)).toEqual(['mio']);
    const draft = listed.ok ? listed.drafts[0] : undefined;
    expect(draft?.counts).toMatchObject({ experience: 1, education: 1, projects: 0 });
    expect(draft?.report).toMatchObject({ origin: 'CV Lucas.pdf', importedAt: '2026-09-02T12:08:17.894Z', issues: 2, unparsed: 2 });
    expect(draft?.entries.map((each) => each.title)).toEqual(['Backend · Acme', 'Ciclo · I.E.S.']);
  });

  it('un borrador que no carga se devuelve con su motivo, sin tumbar la lista', async () => {
    const fs = new MemoryFileSystem({
      '/work/import/roto/profile.md': '---\nschemaVersion: 1\n---\n',
      '/work/import/sano/profile.md': PROFILE,
    });
    const listed = await listDrafts(appContext(fs));
    expect(listed.ok && listed.drafts).toHaveLength(2);
    expect(listed.ok && listed.drafts[0]?.problem).toEqual(expect.stringContaining('problema'));
    expect(listed.ok && listed.drafts[1]?.problem).toBeUndefined();
  });
});

describe('readReport / isBackupName', () => {
  it('cuenta los avisos y las líneas sin situar del informe', () => {
    expect(readReport(REPORT)).toMatchObject({ issues: 2, unparsed: 2 });
    expect(readReport('# Informe\n')).toMatchObject({ issues: 0, unparsed: 0, origin: undefined });
  });

  it('reconoce la copia que deja --replace y no un borrador que se llame parecido', () => {
    expect(isBackupName('mio.20260902-140535.bak')).toBe(true);
    expect(isBackupName('mio.20260902-140535.bak.2')).toBe(true);
    expect(isBackupName('mi-cv-bak')).toBe(false);
    expect(isBackupName('backup')).toBe(false);
  });
});

describe('draftDuplicates: los borradores entre sí y contra las fuentes', () => {
  it('compara también lo que ya está en data/sources', async () => {
    const fs = new MemoryFileSystem({
      '/work/data/sources/profile.md': PROFILE,
      '/work/data/sources/experience/life5.md': experienceFile('Life5', 'Backend Developer', '2022-05', '2022-12'),
      '/work/import/mio/profile.md': PROFILE,
      '/work/import/mio/experience/life5.md': experienceFile('Life5', 'Software Developer', '2022-04'),
    });
    const result = await draftDuplicates(appContext(fs), { data: 'data/sources' });
    expect(result.ok && result.result.compared).toBe(2);
    expect(result.ok && result.result.groups).toHaveLength(1);
    expect(result.ok && result.result.groups[0]?.inSources).toBe(true);
  });
});

/* ───────────────────────────── adoptar ───────────────────────────── */

function workspace(extra: Record<string, string> = {}): MemoryFileSystem {
  return new MemoryFileSystem({
    '/work/data/sources/profile.md': PROFILE,
    '/work/data/sources/experience/life5.md': experienceFile('Life5', 'Backend', '2022-05', '2022-12'),
    '/work/import/mio/profile.md': PROFILE,
    '/work/import/mio/experience/acme.md': experienceFile('Acme', 'Backend Senior', '2020-01', '2021-01'),
    '/work/import/mio/education/ies.md': educationFile('I.E.S. Muralla Romana', 'Ciclo Superior', '2008', '2010'),
    ...extra,
  });
}

describe('adoptEntries: añadir a las fuentes sin pisar nada', () => {
  it('escribe la entrada señalada como fichero nuevo y deja intacto lo que ya había', async () => {
    const fs = workspace();
    const before = fs.file('/work/data/sources/experience/life5.md')?.content;
    const result = await adoptEntries(appContext(fs), { data: 'data/sources', entries: [{ draft: 'mio', section: 'experience', id: 'exp-acme' }] });
    expect(result.ok && result.outcome.adopted).toEqual([{ draft: 'mio', section: 'experience', id: 'exp-acme', title: 'Backend Senior · Acme', path: 'experience/acme.md' }]);
    expect(fs.file('/work/data/sources/experience/acme.md')?.content).toContain('company: Acme');
    expect(fs.file('/work/data/sources/experience/life5.md')?.content).toBe(before);
  });

  it('adopta de varias secciones a la vez', async () => {
    const fs = workspace();
    const result = await adoptEntries(appContext(fs), {
      data: 'data/sources',
      entries: [
        { draft: 'mio', section: 'experience', id: 'exp-acme' },
        { draft: 'mio', section: 'education', id: 'edu-ies' },
      ],
    });
    expect(result.ok && result.outcome.adopted.map((each) => each.path)).toEqual(['experience/acme.md', 'education/ies.md']);
    expect(fs.file('/work/data/sources/education/ies.md')?.content).toContain('institution: I.E.S. Muralla Romana');
  });

  it('un id que ya está en las fuentes recibe el primer libre, y el fichero también', async () => {
    // Adoptar la misma entrada de dos borradores distintos es exactamente lo que se hace al comparar versiones.
    const fs = workspace({
      '/work/data/sources/experience/acme.md': experienceFile('Acme', 'Otro puesto', '2019-01', '2019-06'),
      '/work/import/otro/profile.md': PROFILE,
      '/work/import/otro/experience/acme.md': experienceFile('Acme', 'Backend Senior', '2020-01', '2021-01'),
    });
    const result = await adoptEntries(appContext(fs), {
      data: 'data/sources',
      entries: [
        { draft: 'mio', section: 'experience', id: 'exp-acme' },
        { draft: 'otro', section: 'experience', id: 'exp-acme' },
      ],
    });
    expect(result.ok && result.outcome.adopted.map((each) => [each.id, each.path])).toEqual([
      ['exp-acme-2', 'experience/acme-2.md'],
      ['exp-acme-3', 'experience/acme-3.md'],
    ]);
    // El id sigue derivándose del nombre del fichero («acme-2.md» → «exp-acme-2»), así que no hace falta
    // escribirlo: las fuentes adoptadas salen tan limpias como las que escribe `cv import`.
    expect(fs.file('/work/data/sources/experience/acme-2.md')?.content).not.toContain('id:');
    expect(fs.file('/work/data/sources/experience/acme.md')?.content).toContain('role: Otro puesto');
  });

  it('--dry-run enseña lo que escribiría y no escribe', async () => {
    const fs = workspace();
    const result = await adoptEntries(appContext(fs), { data: 'data/sources', entries: [{ draft: 'mio', section: 'experience', id: 'exp-acme' }], dryRun: true });
    expect(result.ok && result.outcome.dryRun).toBe(true);
    expect(result.ok && result.outcome.adopted).toHaveLength(1);
    expect(fs.file('/work/data/sources/experience/acme.md')).toBeUndefined();
  });

  it('una entrada que no existe se anota con su motivo y no impide las demás', async () => {
    const fs = workspace();
    const result = await adoptEntries(appContext(fs), {
      data: 'data/sources',
      entries: [
        { draft: 'mio', section: 'experience', id: 'exp-inventada' },
        { draft: 'mio', section: 'experience', id: 'exp-acme' },
      ],
    });
    expect(result.ok && result.outcome.adopted).toHaveLength(1);
    expect(result.ok && result.outcome.skipped[0]?.reason).toEqual(expect.stringContaining('no es una experiencia'));
  });

  it('sin nada que adoptar, o con unas fuentes que no cargan, no se escribe y se dice por qué', async () => {
    const fs = workspace();
    expect(await adoptEntries(appContext(fs), { data: 'data/sources', entries: [] })).toMatchObject({ ok: false, error: { code: 'invalid-data' } });
    expect(await adoptEntries(appContext(fs), { data: 'data/sources', entries: [{ draft: 'no-existe', section: 'experience', id: 'exp-acme' }] })).toMatchObject({ ok: false, error: { code: 'not-found' } });
    const broken = new MemoryFileSystem({ '/work/data/sources/profile.md': '---\nschemaVersion: 1\n---\n', '/work/import/mio/profile.md': PROFILE });
    expect(await adoptEntries(appContext(broken), { data: 'data/sources', entries: [{ draft: 'mio', section: 'experience', id: 'exp-acme' }] })).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('no cargan') as string },
    });
  });
});

describe('las secciones adoptables', () => {
  it('son exactamente aquellas en las que un fichero es una entrada', () => {
    // skills.csv, certifications.csv y achievements.md juntan muchas entradas en un fichero: adoptarlas
    // exigiría reescribir un fichero que ya es tuyo, y esa es otra tarea con otras garantías.
    expect([...ADOPTABLE_SECTIONS]).toEqual(['experience', 'education', 'projects']);
  });
});
