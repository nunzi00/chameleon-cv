/**
 * Leer un MAC de Manfred (T-9.22, docs/cv-import.md §12): el mapeo campo a campo, lo que se descarta a propósito
 * (la traza del autocompletado de Google Maps), lo que se avisa por no caber en el perfil y la tolerancia con un
 * fichero de otra versión o incompleto. El caso grande está tomado del MAC real del PO.
 */
import { describe, expect, it } from 'vitest';

import { importManfredMac } from '../../src/import/manfred';

/** Un MAC mínimo pero completo, con la forma exacta que exporta Manfred (v0.5). */
const MAC = {
  $schema: 'https://raw.githubusercontent.com/getmanfred/mac/v0.5/schema/schema.json',
  settings: { language: 'ES', MACVersion: '0.5' },
  aboutMe: {
    profile: {
      name: 'Lucas',
      surnames: 'Nunzi',
      title: 'Senior Developer',
      description: 'Specialties: php, mysql',
      location: { notes: 'Autocompleted using Google Maps API (id: ChIJi7xhMnjjQgwR7KNoB5Qs7KY)', country: 'España', municipality: 'Lugo' },
      contact: { contactMails: [{ email: 'lucas@example.com' }], phoneNumbers: [{ number: '+34 600 00 00 00' }] },
    },
    relevantLinks: [{ type: 'linkedin', URL: 'https://www.linkedin.com/in/lucas-nunzi' }],
  },
  experience: {
    jobs: [
      {
        organization: { name: 'Getlife', location: { municipality: 'Madrid' } },
        roles: [
          {
            name: 'Software Developer',
            startDate: '2022-04-01',
            notes: 'Backend y plataforma.',
            competences: [{ name: 'PHP', type: 'technology' }, { name: 'Kubernetes', type: 'technology' }],
            challenges: [{ description: 'Migrar el monolito', actions: [{ description: 'Extraje ms-tarifier' }, 'Automaticé los despliegues'] }],
          },
        ],
      },
      { organization: { name: 'Raiola Networks' }, roles: [{ name: 'Soporte', startDate: '2017-09-01', finishDate: '2021-06-01' }] },
    ],
    projects: [{ details: { name: 'chameleon-cv', URL: 'https://example.com/cv', description: 'Generador de CV' }, type: 'openSource', roles: [{ name: 'Autor', startDate: '2026-08-01' }] }],
  },
  knowledge: {
    languages: [
      { name: 'EN', fullName: 'Inglés', level: 'Limited working proficiency' },
      { name: 'ES', fullName: 'Español', level: 'Native or bilingual proficiency' },
      { name: 'GL', fullName: 'Gallego', level: 'Inventado' },
    ],
    hardSkills: [{ skill: { name: '.NET', type: 'technology' } }, { skill: { name: 'MySQL', type: 'technology' } }],
    softSkills: [{ skill: { name: 'Comunicación', type: 'soft' } }],
    studies: [
      { studyType: 'officialDegree', degreeAchieved: true, name: 'Desarrollo de Aplicaciones Web', startDate: '2011-09-01', finishDate: '2013-06-01', institution: { name: 'I.E.S Muralla Romana' } },
      { studyType: 'certification', degreeAchieved: true, name: 'Programador Java SE 6', startDate: '2012-02-01', finishDate: '2012-05-01', institution: { name: 'Oracle' } },
    ],
  },
  careerPreferences: { contact: { publicProfiles: [{ URL: 'https://github.com/lucas', type: 'github' }] }, preferences: { preferredRoles: ['Backend Developer'] }, status: 'searchingActively' },
  manfredSpecificData: { mainStackTechs: [{ name: 'Symfony', type: 'technology' }, { name: 'MySQL', type: 'technology' }] },
};

function read(value: unknown) {
  return importManfredMac(JSON.stringify(value));
}

describe('importManfredMac: el perfil', () => {
  it('junta nombre y apellidos, y toma titular, resumen y contacto', () => {
    const result = read(MAC);
    expect(result.ok && result.draft.fullName).toBe('Lucas Nunzi');
    expect(result.ok && result.draft.headline).toBe('Senior Developer');
    expect(result.ok && result.draft.summary).toBe('Specialties: php, mysql');
    expect(result.ok && result.draft.email).toBe('lucas@example.com');
    expect(result.ok && result.draft.phone).toBe('+34 600 00 00 00');
  });

  it('la ubicación se compone de municipio y país, y DESCARTA la traza del autocompletado', () => {
    // Manfred rellena `notes` con «Autocompleted using Google Maps API (id: …)», que no es una ubicación sino
    // cómo se obtuvo: meterla en el perfil sería basura visible en el CV.
    const result = read(MAC);
    expect(result.ok && result.draft.location).toBe('Lugo, España');
    expect(result.ok && result.draft.location).not.toContain('Google');
  });

  it('reúne los enlaces relevantes y los perfiles públicos, sin repetir', () => {
    const result = read(MAC);
    expect(result.ok && result.draft.links).toEqual(['https://www.linkedin.com/in/lucas-nunzi', 'https://github.com/lucas']);
  });
});

describe('importManfredMac: la experiencia', () => {
  it('un puesto por rol, con su empresa, sus fechas y la ubicación de la organización', () => {
    const result = read(MAC);
    const jobs = result.ok ? result.draft.experience : [];
    expect(jobs.map((job) => [job.title, job.subtitle, job.start, job.end])).toEqual([
      ['Software Developer', 'Getlife', '2022-04-01', undefined],
      ['Soporte', 'Raiola Networks', '2017-09-01', '2021-06-01'],
    ]);
    expect(jobs[0]?.location).toBe('Madrid');
    expect(jobs[0]?.summary).toBe('Backend y plataforma.');
  });

  it('los retos son logros —con sus acciones— y las competencias, tecnologías', () => {
    const result = read(MAC);
    const job = result.ok ? result.draft.experience[0] : undefined;
    expect(job?.technologies).toEqual(['PHP', 'Kubernetes']);
    // La acción viene como objeto o como cadena suelta según quién generó el MAC: valen las dos.
    expect(job?.achievements.map((item) => item.text)).toEqual(['Migrar el monolito', 'Extraje ms-tarifier', 'Automaticé los despliegues']);
  });

  it('los proyectos entran con su enlace y el rol como subtítulo', () => {
    const result = read(MAC);
    const project = result.ok ? result.draft.projects[0] : undefined;
    expect(project).toMatchObject({ title: 'chameleon-cv', subtitle: 'Autor', url: 'https://example.com/cv', summary: 'Generador de CV', start: '2026-08-01' });
  });
});

describe('importManfredMac: conocimiento', () => {
  it('separa la formación de las certificaciones por studyType, que es lo único que las distingue en MAC', () => {
    const result = read(MAC);
    expect(result.ok && result.draft.education.map((item) => item.title)).toEqual(['Desarrollo de Aplicaciones Web']);
    expect(result.ok && result.draft.certifications.map((item) => [item.title, item.subtitle, item.date])).toEqual([['Programador Java SE 6', 'Oracle', '2012-05-01']]);
  });

  it('traduce los cinco niveles de idioma al MCER y deja sin nivel lo que no reconoce', () => {
    const result = read(MAC);
    expect(result.ok && result.draft.languages).toEqual([
      { name: 'Inglés', level: 'B1' },
      { name: 'Español', level: 'native' },
      // Aproximar un idioma a ojo sería inventar: se queda sin nivel y el esquema lo dirá.
      { name: 'Gallego', level: undefined },
    ]);
  });

  it('junta las habilidades duras con el «stack principal» sin repetir, y las blandas van a su categoría', () => {
    const result = read(MAC);
    const groups = result.ok ? result.draft.skills : [];
    // MySQL está en hardSkills y en mainStackTechs: entra una sola vez.
    expect(groups[0]).toMatchObject({ category: undefined, names: ['.NET', 'MySQL', 'Symfony'] });
    expect(groups[1]).toMatchObject({ category: 'soft', names: ['Comunicación'] });
  });
});

describe('importManfredMac: lo que no cabe en el perfil', () => {
  it('se dice, no se calla ni se le busca un hueco forzado', () => {
    const result = read(MAC);
    const notes = result.ok ? result.notes : [];
    expect(notes.some((note) => note.includes('los puestos que buscas'))).toBe(true);
    expect(notes.some((note) => note.includes('tu estado de búsqueda'))).toBe(true);
  });

  it('avisa cuando varios estudios comparten la fecha de inicio y ninguno tiene fin', () => {
    // Es la forma que deja Manfred cuando rellenas la formación de una sentada sin recordar las fechas: en el
    // MAC real del PO, tres estudios con «2024-12-20». Se avisa, pero la fecha NO se toca: es lo que dice el fichero.
    const rellenado = {
      ...MAC,
      knowledge: {
        ...MAC.knowledge,
        studies: [
          { studyType: 'officialDegree', degreeAchieved: false, name: 'uno', startDate: '2024-12-20', institution: { name: 'ies piringalla' } },
          { studyType: 'officialDegree', degreeAchieved: false, name: 'dos', startDate: '2024-12-20', institution: { name: 'ies muralla romana' } },
        ],
      },
    };
    const result = read(rellenado);
    expect(result.ok && result.notes.some((note) => note.includes('2024-12-20'))).toBe(true);
    expect(result.ok && result.draft.education[0]?.start).toBe('2024-12-20');
  });

  it('avisa cuando la ubicación se queda en el país, porque acabará en el campo de ciudad', () => {
    const soloPais = { ...MAC, aboutMe: { ...MAC.aboutMe, profile: { ...MAC.aboutMe.profile, location: { country: 'España', notes: 'Autocompleted using Google Maps API' } } } };
    const result = read(soloPais);
    expect(result.ok && result.draft.location).toBe('España');
    expect(result.ok && result.notes.some((note) => note.includes('campo de ciudad'))).toBe(true);
    // Con municipio no hay nada que avisar: la ciudad es una ciudad.
    expect(read(MAC).ok && (read(MAC) as { notes: readonly string[] }).notes.some((note) => note.includes('campo de ciudad'))).toBe(false);
  });

  it('avisa de una versión de MAC que este lector no conoce, pero importa igual', () => {
    const result = read({ ...MAC, settings: { language: 'ES', MACVersion: '0.9' } });
    expect(result.ok && result.notes[0]).toContain('MAC 0.9');
    expect(result.ok && result.draft.experience).toHaveLength(2);
  });
});

describe('importManfredMac: entradas incompletas dentro de cada sección', () => {
  it('un reto sin descripción, una acción vacía y una competencia sin nombre no abren nada', () => {
    const result = read({
      ...MAC,
      experience: {
        jobs: [
          {
            organization: { name: 'Acme' },
            roles: [{ name: 'Backend', startDate: '2020-01-01', competences: [{ type: 'technology' }, { name: 'PHP' }], challenges: [{ actions: [{}, ''] }, { description: 'Un reto' }] }],
          },
        ],
      },
    });
    const job = result.ok ? result.draft.experience[0] : undefined;
    expect(job?.technologies).toEqual(['PHP']);
    expect(job?.achievements.map((item) => item.text)).toEqual(['Un reto']);
  });

  it('un estudio, un proyecto y un idioma sin nombre se ignoran en vez de entrar vacíos', () => {
    const result = read({
      ...MAC,
      experience: { jobs: [], projects: [{ details: { URL: 'https://example.org' }, roles: [] }] },
      knowledge: {
        languages: [{ level: 'Native or bilingual proficiency' }],
        studies: [{ studyType: 'officialDegree', degreeAchieved: true, startDate: '2010-01-01' }],
        hardSkills: [],
      },
      // El «stack principal» también aporta habilidades: sin él tampoco hay grupo que crear.
      manfredSpecificData: {},
    });
    expect(result.ok && result.draft.projects).toEqual([]);
    expect(result.ok && result.draft.education).toEqual([]);
    expect(result.ok && result.draft.languages).toEqual([]);
    // Sin habilidades no se crea un grupo vacío.
    expect(result.ok && result.draft.skills).toEqual([]);
  });

  it('una certificación sin fecha de fin toma la de inicio, que es la única que hay', () => {
    const result = read({
      ...MAC,
      knowledge: { ...MAC.knowledge, studies: [{ studyType: 'certification', degreeAchieved: true, name: 'CKA', startDate: '2024-03-01', institution: { name: 'CNCF', URL: 'https://cncf.io' } }] },
    });
    expect(result.ok && result.draft.certifications[0]).toMatchObject({ title: 'CKA', date: '2024-03-01', url: 'https://cncf.io' });
  });

  it('un idioma sin fullName se queda con su código ISO, y sin nivel se queda sin nivel', () => {
    const result = read({ ...MAC, knowledge: { ...MAC.knowledge, languages: [{ name: 'PT', level: 'Elementary proficiency' }, { name: 'IT' }] } });
    expect(result.ok && result.draft.languages).toEqual([
      { name: 'PT', level: 'A2' },
      { name: 'IT', level: undefined },
    ]);
  });

  it('avisa del salario y de los niveles de habilidad, que tampoco entran', () => {
    const result = read({
      ...MAC,
      aboutMe: { ...MAC.aboutMe, currentSalary: { amount: 60000, currency: 'EUR' }, recommendations: [{ title: 'Una' }], interestingFacts: [{ topic: 'x', fact: 'y' }] },
      experience: { ...MAC.experience, publicArtifacts: [{ type: 'talk', details: { name: 'Una charla' } }] },
      knowledge: { ...MAC.knowledge, hardSkills: [{ skill: { name: 'PHP', type: 'technology' }, level: 'expert' }] },
    });
    const notes = result.ok ? result.notes : [];
    expect(notes.some((note) => note.includes('salario'))).toBe(true);
    expect(notes.some((note) => note.includes('recomendaciones'))).toBe(true);
    expect(notes.some((note) => note.includes('interesting facts'))).toBe(true);
    expect(notes.some((note) => note.includes('artefactos públicos'))).toBe(true);
    expect(notes.some((note) => note.includes('niveles de las habilidades'))).toBe(true);
  });

  it('un MAC con BOM se lee igual: el byte invisible no lo invalida', () => {
    const result = importManfredMac(`\ufeff${JSON.stringify(MAC)}`);
    expect(result.ok && result.draft.fullName).toBe('Lucas Nunzi');
  });
});

describe('importManfredMac: lo que rechaza y lo que aguanta', () => {
  it('rechaza lo que no es JSON, lo que no es un objeto y lo que no parece un MAC', () => {
    expect(importManfredMac('esto no es json')).toMatchObject({ ok: false, message: expect.stringContaining('no es JSON válido') as string });
    expect(importManfredMac('[1,2]')).toMatchObject({ ok: false, message: expect.stringContaining('no es un objeto JSON') as string });
    expect(importManfredMac('{"cualquier":"cosa"}')).toMatchObject({ ok: false, message: expect.stringContaining('no parece un MAC') as string });
  });

  it('aguanta un MAC recortado: secciones ausentes, listas vacías y entradas sin nombre', () => {
    const result = importManfredMac(JSON.stringify({ settings: { MACVersion: '0.5' }, experience: { jobs: [{ organization: {}, roles: [{ startDate: '2020-01-01' }] }] }, knowledge: {} }));
    expect(result.ok).toBe(true);
    // Un rol sin nombre no abre una entrada vacía: se ignora.
    expect(result.ok && result.draft.experience).toEqual([]);
    expect(result.ok && result.draft.fullName).toBeUndefined();
    expect(result.ok && result.draft.unparsed).toEqual([]);
  });

  it('un MAC nunca deja nada «sin situar»: el fichero dice a qué sección pertenece cada dato', () => {
    const result = read(MAC);
    expect(result.ok && result.draft.unparsed).toEqual([]);
    expect(result.ok && result.draft.sections).toEqual([]);
  });

  it('se niega con un fichero desmesurado antes de intentar interpretarlo', () => {
    expect(importManfredMac(new Uint8Array(5 * 1024 * 1024))).toMatchObject({ ok: false, message: expect.stringContaining('no un archivo') as string });
  });
});
