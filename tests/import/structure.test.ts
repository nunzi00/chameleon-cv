/** P1, el estructurador heurístico (T-8.4): del texto plano de un CV al borrador con procedencia. */
import { describe, expect, it } from 'vitest';

import { nameScore, structureCv } from '../../src/import/structure';

const DEFAULT_LAYOUT = `Lucía Ferrer Montalbán
Ingeniera de software · plataformas de pago y datos
Valencia, España · lucia.ferrer@example.org · +34 600 123 456 · GitHub · LinkedIn · Web
Ingeniera de software con once años construyendo plataformas de pago.
He liderado equipos de hasta ocho ingenieros sin dejar de escribir código.
Experiencia
Staff Backend Engineer · Nexo Pagos mar 2022 – actualidad
Valencia (remoto)
Pasarela de pagos B2B con 9 M de transacciones al mes y disponibilidad comprometida del 99,95 %. Equipo de
plataforma de pagos de 8 personas.
• Diseñé la arquitectura de la nueva pasarela de pagos sobre Kafka y PostgreSQL, procesando 9 M de transacciones
al mes sin pérdida de eventos. (0 incidentes de pérdida de datos en 18 meses)
• Reduje la latencia p99 de la API de autorización de 480 ms a 210 ms. (-56 % p99)
Tecnologías: PHP 8.3, Symfony 7, Kafka, PostgreSQL 16
Data Engineer · Lumen Analytics sept 2015 – dic 2016
Barcelona
– Construí con Spark la canalización diaria de 2 TB de eventos de navegación. (2 TB/día)
Proyectos
Kafka Guardian · Autora y mantenedora jun 2023 – actualidad · https://example.org/kafka-guardian
Biblioteca de código abierto para detectar consumidores retrasados y particiones huérfanas en Kafka.
▸ Publiqué Kafka Guardian, adoptada por 30 organizaciones. (30 organizaciones)
Formación
Máster en Ciencia de Datos (Ingeniería de datos) · Universitat de València 2014 – 2015
Grado en Ingeniería Informática (Ingeniería del software) · Universitat Politècnica de València 2009 – 2013
Habilidades
Lenguajes: PHP, Python
Frameworks: Symfony, Spark
Certificaciones
AWS Solutions Architect Associate · Amazon Web Services · sept 2021 · enlace
CKA · CNCF · 20 abr 2021
Idiomas
Español · nativo · Valenciano · C1 · Inglés · C1
Lucía Ferrer Montalbán · 1 / 2
`;

describe('structureCv', () => {
  it('reconoce cabecera, contacto, resumen, experiencias con fechas, lugar, resumen, logros con impacto y tecnologías', () => {
    const draft = structureCv(DEFAULT_LAYOUT);
    expect(draft.fullName).toBe('Lucía Ferrer Montalbán');
    expect(draft.headline).toBe('Ingeniera de software · plataformas de pago y datos');
    expect(draft).toMatchObject({ email: 'lucia.ferrer@example.org', phone: '+34 600 123 456', location: 'Valencia, España', links: ['GitHub', 'LinkedIn', 'Web'] });
    expect(draft.summary).toBe('Ingeniera de software con once años construyendo plataformas de pago. He liderado equipos de hasta ocho ingenieros sin dejar de escribir código.');
    expect(draft.sections.map((section) => section.kind)).toEqual(['experience', 'projects', 'education', 'skills', 'certifications', 'languages']);
    expect(draft.experience).toHaveLength(2);
    const [nexo, lumen] = draft.experience;
    expect(nexo).toMatchObject({ title: 'Staff Backend Engineer', subtitle: 'Nexo Pagos', location: 'Valencia (remoto)', start: '2022-03', end: undefined, current: true, technologies: ['PHP 8.3', 'Symfony 7', 'Kafka', 'PostgreSQL 16'] });
    expect(nexo?.summary).toBe('Pasarela de pagos B2B con 9 M de transacciones al mes y disponibilidad comprometida del 99,95 %. Equipo de plataforma de pagos de 8 personas.');
    expect(nexo?.achievements.map((achievement) => [achievement.text, achievement.impact])).toEqual([
      ['Diseñé la arquitectura de la nueva pasarela de pagos sobre Kafka y PostgreSQL, procesando 9 M de transacciones al mes sin pérdida de eventos.', '0 incidentes de pérdida de datos en 18 meses'],
      ['Reduje la latencia p99 de la API de autorización de 480 ms a 210 ms.', '-56 % p99'],
    ]);
    expect(nexo?.provenance).toEqual({ line: 7, text: 'Staff Backend Engineer · Nexo Pagos mar 2022 – actualidad' });
    expect(lumen).toMatchObject({ title: 'Data Engineer', subtitle: 'Lumen Analytics', location: 'Barcelona', start: '2015-09', end: '2016-12', current: false });
    expect(lumen?.achievements[0]).toMatchObject({ text: 'Construí con Spark la canalización diaria de 2 TB de eventos de navegación.', impact: '2 TB/día' });
  });

  it('proyectos con URL, formación con campo, habilidades por categoría, certificaciones con fecha e idiomas con nivel; el pie de página se ignora', () => {
    const draft = structureCv(DEFAULT_LAYOUT);
    expect(draft.projects[0]).toMatchObject({ title: 'Kafka Guardian', subtitle: 'Autora y mantenedora', url: 'https://example.org/kafka-guardian', start: '2023-06', current: true });
    expect(draft.projects[0]?.achievements[0]).toMatchObject({ text: 'Publiqué Kafka Guardian, adoptada por 30 organizaciones.', impact: '30 organizaciones' });
    expect(draft.education.map((entry) => [entry.title, entry.field, entry.subtitle, entry.start, entry.end])).toEqual([
      ['Máster en Ciencia de Datos', 'Ingeniería de datos', 'Universitat de València', '2014', '2015'],
      ['Grado en Ingeniería Informática', 'Ingeniería del software', 'Universitat Politècnica de València', '2009', '2013'],
    ]);
    expect(draft.skills.map((group) => [group.category, group.names])).toEqual([
      ['language', ['PHP', 'Python']],
      ['framework', ['Symfony', 'Spark']],
    ]);
    expect(draft.certifications.map((entry) => [entry.title, entry.subtitle, entry.date])).toEqual([
      ['AWS Solutions Architect Associate', 'Amazon Web Services', '2021-09'],
      ['CKA', 'CNCF', '2021-04-20'],
    ]);
    expect(draft.languages).toEqual([
      { name: 'Español', level: 'nativo' },
      { name: 'Valenciano', level: 'C1' },
      { name: 'Inglés', level: 'C1' },
    ]);
    expect(draft.unparsed).toEqual([]);
  });

  it('maquetación lateral (modern): CONTACTO como sección, etiquetas de habilidades en su propia línea, certificación con la fecha en la línea siguiente y logros transversales', () => {
    const text = `Lucía Ferrer Montalbán
Data Engineer
CONTACTO
Valencia, España · lucia.ferrer@example.org
· +34 600 123 456 · GitHub · LinkedIn · Web
HABILIDADES
Lenguajes
Python
Frameworks
Spark
IDIOMAS
Español · nativo
Inglés · C1
CERTIFICACIONES
AWS Solutions Architect Associate · Amazon Web Services
sept 2021
CKA · CNCF
20 abr 2021 · enlace
LOGROS DESTACADOS
▸ Ponente en dos ediciones de la conferencia PHP Valencia con charlas sobre Kafka y observabilidad.
EXPERIENCIA
Staff Backend Engineer · Nexo Pagos
mar 2022 – actualidad
Valencia (remoto)
▸ Diseñé la arquitectura de la nueva pasarela. (0 incidentes)
Lucía Ferrer Montalbán · página 1 de 2
`;
    const draft = structureCv(text);
    expect(draft).toMatchObject({ fullName: 'Lucía Ferrer Montalbán', headline: 'Data Engineer', email: 'lucia.ferrer@example.org', phone: '+34 600 123 456', location: 'Valencia, España' });
    expect(draft.skills.map((group) => [group.category, group.names])).toEqual([
      ['language', ['Python']],
      ['framework', ['Spark']],
    ]);
    expect(draft.languages).toEqual([
      { name: 'Español', level: 'nativo' },
      { name: 'Inglés', level: 'C1' },
    ]);
    expect(draft.certifications.map((entry) => [entry.title, entry.subtitle, entry.date])).toEqual([
      ['AWS Solutions Architect Associate', 'Amazon Web Services', '2021-09'],
      ['CKA', 'CNCF', '2021-04-20'],
    ]);
    expect(draft.achievements).toEqual([{ text: 'Ponente en dos ediciones de la conferencia PHP Valencia con charlas sobre Kafka y observabilidad.', impact: undefined, provenance: { line: 20, text: expect.stringContaining('Ponente') } }]);
    expect(draft.experience[0]).toMatchObject({ title: 'Staff Backend Engineer', subtitle: 'Nexo Pagos', start: '2022-03', current: true, location: 'Valencia (remoto)' });
    expect(draft.experience[0]?.achievements).toEqual([{ text: 'Diseñé la arquitectura de la nueva pasarela.', impact: '0 incidentes', provenance: { line: 25, text: expect.stringContaining('Diseñé') } }]);
  });

  it('fechas al margen (academic), numeración de secciones, viñetas partidas, líneas sin asignar y CV inglés', () => {
    const text = `Ada Example
Software Engineer
1 Experience
Jan 2020 – Present Senior Engineer · Acme Corp · Remote
– Built the payments platform handling 3 M
transactions per month. (99.99 % uptime)
Some stray line that fits nowhere.
2 Education
2015 – 2019 BSc Computer Science · State University
3 Skills
Go, Rust, Kubernetes
4 Languages
English: native
Spanish: B2
Other things
Unknown stuff
`;
    const draft = structureCv(text);
    expect(draft.sections.map((section) => section.kind)).toEqual(['experience', 'education', 'skills', 'languages']);
    expect(draft.experience[0]).toMatchObject({ title: 'Senior Engineer', subtitle: 'Acme Corp', location: 'Remote', start: '2020-01', current: true });
    expect(draft.experience[0]?.achievements).toEqual([{ text: 'Built the payments platform handling 3 M transactions per month.', impact: '99.99 % uptime', provenance: { line: 5, text: expect.stringContaining('Built') } }]);
    expect(draft.experience[0]?.summary).toBeUndefined();
    expect(draft.education[0]).toMatchObject({ title: 'BSc Computer Science', subtitle: 'State University', start: '2015', end: '2019' });
    expect(draft.skills).toEqual([{ category: undefined, names: ['Go', 'Rust', 'Kubernetes'], provenance: { line: 11, text: 'Go, Rust, Kubernetes' } }]);
    expect(draft.languages).toEqual([
      { name: 'English', level: 'native' },
      { name: 'Spanish', level: 'B2' },
    ]);
    expect(draft.unparsed.map((item) => item.text)).toEqual(['Some stray line that fits nowhere.', 'Other things', 'Unknown stuff']);
  });

  it('sin secciones ni fechas no inventa nada: todo queda como cabecera o sin asignar', () => {
    // Una línea que no se parece a un nombre de persona ya no se toma como tal (T-9.1): va al titular y el
    // borrador avisa de que no se reconoció el nombre, en vez de bautizar el perfil con un título de página.
    const draft = structureCv('Solo un nombre\n\nUna frase que no es contacto ni titular porque termina en punto.\n');
    expect(draft.fullName).toBeUndefined();
    expect(draft.headline).toBe('Solo un nombre');
    expect(draft.summary).toBe('Una frase que no es contacto ni titular porque termina en punto.');
    expect(draft.experience).toEqual([]);
    expect(draft.sections).toEqual([]);
    // Con un nombre reconocible, la misma entrada sí lo identifica y la frase queda de resumen.
    const conNombre = structureCv('Ada Ejemplo\n\nUna frase que no es contacto ni titular porque termina en punto.\n');
    expect(conNombre.fullName).toBe('Ada Ejemplo');
    expect(conNombre.summary).toBe('Una frase que no es contacto ni titular porque termina en punto.');
    const empty = structureCv('');
    expect(empty.fullName).toBeUndefined();
    expect(empty.unparsed).toEqual([]);
  });
});

describe('structureCv · enlace bajo el título', () => {
  it('toma como URL del proyecto la línea que solo contiene un enlace y no la pega al subtítulo', () => {
    const draft = structureCv(
      [
        'Lucía Ferrer Montalbán',
        'Proyectos',
        'Kafka Guardian · Autora y mantenedora jun 2023 – actualidad',
        'https://example.org/kafka-guardian',
        'Biblioteca de código abierto para detectar consumidores retrasados.',
        '▸ Publiqué Kafka Guardian, adoptada por 30 organizaciones. (30 organizaciones)',
        'Módulos Terraform para AWS · Autora sept 2020 – ene 2022',
        'www.example.org/terraform',
        'https://example.org/otro',
        'Pipeline Demo · Autora may 2016 – dic 2016',
        'https://example.org/pipeline demo',
      ].join('\n'),
    );
    expect(draft.projects.map((project) => [project.title, project.subtitle, project.url, project.summary])).toEqual([
      ['Kafka Guardian', 'Autora y mantenedora', 'https://example.org/kafka-guardian', 'Biblioteca de código abierto para detectar consumidores retrasados.'],
      ['Módulos Terraform para AWS', 'Autora', 'www.example.org/terraform', undefined],
      ['Pipeline Demo', 'Autora', 'https://example.org/pipelinedemo', undefined],
    ]);
    expect(draft.projects[0]?.achievements).toHaveLength(1);
  });
});

describe('structureCv · tabla y bloques de detalle', () => {
  it('parte las celdas « | » en título, empresa y lugar y reabre la entrada cuyo título repite el bloque de detalle', () => {
    const draft = structureCv(
      [
        'Lucía Ferrer Montalbán',
        'Experiencia laboral',
        'Periodo | Puesto | Empresa | Lugar',
        'mar 2022 – actualidad | Staff Backend Engineer | Nexo Pagos | Valencia (remoto)',
        'jun 2019 – feb 2022 | Platform Engineer | Órbita Cloud | Madrid',
        'Staff Backend Engineer — Nexo Pagos',
        '— Diseñé la arquitectura de la nueva pasarela de pagos. (0 incidentes)',
        '— Reduje la latencia p99 de 480 ms a 210 ms.',
        'Tecnologías: PHP 8.3, Kafka',
        'Platform Engineer — Órbita Cloud',
        '— Construí la plataforma Kubernetes multi-tenant.',
        'Formación',
        '2014 – 2015 | Máster en Ciencia de Datos (Ingeniería de datos) | Universitat de València',
        'Máster en Ciencia de Datos — Universitat de València',
        '— Trabajo final sobre canalizaciones de datos.',
      ].join('\n'),
    );
    expect(draft.experience.map((entry) => [entry.title, entry.subtitle, entry.location, entry.start, entry.achievements.length, entry.technologies])).toEqual([
      ['Staff Backend Engineer', 'Nexo Pagos', 'Valencia (remoto)', '2022-03', 2, ['PHP 8.3', 'Kafka']],
      ['Platform Engineer', 'Órbita Cloud', 'Madrid', '2019-06', 1, []],
    ]);
    expect(draft.experience[0]?.achievements[0]).toMatchObject({ text: 'Diseñé la arquitectura de la nueva pasarela de pagos.', impact: '0 incidentes' });
    expect(draft.education.map((entry) => [entry.title, entry.field, entry.subtitle, entry.achievements.length])).toEqual([['Máster en Ciencia de Datos', 'Ingeniería de datos', 'Universitat de València', 1]]);
    expect(draft.unparsed.map((line) => line.text)).toEqual(['Periodo | Puesto | Empresa | Lugar']);
  });
});

describe('structureCv · texto con celdas « | » (P3)', () => {
  it('limpia los separadores de celda en habilidades, conserva el paréntesis de la formación, sigue el subtítulo en minúscula y omite la cabecera repetida de la entrada abierta', () => {
    const draft = structureCv(
      [
        'Lucía Ferrer Montalbán',
        'Experiencia',
        'Staff Backend Engineer · Nexo Pagos | mar 2022 – actualidad',
        'Staff Backend Engineer — Nexo Pagos',
        '▸ Diseñé la arquitectura de la nueva pasarela de pagos.',
        'Formación',
        'Máster en Ciencia de Datos (Ingeniería de datos) · Universitat | 2014 – 2015',
        'de València',
        'Grado en Ingeniería Informática (Ingeniería del software) | 2009 – 2013',
        'Habilidades',
        'Lenguajes: | PHP, Python',
        'Cloud: | AWS',
      ].join('\n'),
    );
    expect(draft.experience.map((entry) => [entry.title, entry.subtitle, entry.summary, entry.achievements.length])).toEqual([['Staff Backend Engineer', 'Nexo Pagos', undefined, 1]]);
    expect(draft.education.map((entry) => [entry.title, entry.field, entry.subtitle, entry.location, entry.start])).toEqual([
      ['Máster en Ciencia de Datos', 'Ingeniería de datos', 'Universitat de València', undefined, '2014'],
      ['Grado en Ingeniería Informática', 'Ingeniería del software', undefined, undefined, '2009'],
    ]);
    expect(draft.skills.map((group) => [group.category, group.names])).toEqual([
      ['language', ['PHP', 'Python']],
      ['cloud', ['AWS']],
    ]);
    expect(draft.unparsed).toEqual([]);
  });
});

describe('structureCv · idiomas sin separador', () => {
  it('separa el nivel final del nombre («Valenciano C1») y respeta los formatos con separador', () => {
    const draft = structureCv(['Lucía Ferrer', 'Idiomas', 'Español | nativo', 'Valenciano C1', 'Inglés (C1)', 'Klingon B2'].join('\n'));
    expect(draft.languages).toEqual([
      { name: 'Español', level: 'nativo' },
      { name: 'Valenciano', level: 'C1' },
      { name: 'Inglés', level: 'C1' },
      { name: 'Klingon', level: 'B2' },
    ]);
    expect(draft.unparsed).toEqual([]);
  });
});

describe('structureCv · reapertura sin subtítulo y título vacío', () => {
  it('reabre un proyecto sin rol por su título y deja vacío el título de una línea que solo tiene separadores', () => {
    const draft = structureCv(['Lucía Ferrer', 'Proyectos', 'Pipeline Demo | may 2016 – dic 2016', 'Kafka Guardian | jun 2023 – actualidad', 'Pipeline Demo', '▸ Construí una canalización de ejemplo.', 'Formación', '2009 – 2013', '— —'].join('\n'));
    expect(draft.projects.map((project) => [project.title, project.subtitle, project.achievements.length])).toEqual([
      ['Kafka Guardian', undefined, 0],
      ['Pipeline Demo', undefined, 1],
    ]);
    expect(draft.education.map((entry) => [entry.title, entry.start])).toEqual([['', '2009']]);
  });
});

describe('structureCv · fecha de graduación suelta (T-8.4b F2)', () => {
  it('abre la formación cuando la fecha cierra la línea tras un separador, y no con cualquier año suelto', () => {
    const draft = structureCv(
      [
        'Jane Doe',
        'Education',
        'Bachelor of Arts in English with an Emphasis in Creative Writing | May 2014',
        'CSU Channel Islands, Camarillo, CA',
        'Scholarship 2002',
        'Beca de estudios en 2019 concedida por la fundación',
        'promoción de honor, 2001',
        'MBA | 2016',
        'Ingeniería, 2015',
      ].join('\n'),
    );
    expect(draft.education.map((entry) => [entry.title, entry.start, entry.singleDate])).toEqual([['Bachelor of Arts in English with an Emphasis in Creative Writing', '2014-05', true]]);
  });
});

describe('structureCv · cabecera espaciada desconocida (T-8.4b F2)', () => {
  it('cierra la sección en curso y manda su contenido al informe en vez de colarlo en la anterior', () => {
    const draft = structureCv(['Jane Doe', 'Experiencia', 'Recepcionista · Salón mar 2016 – jul 2018', 'C A M P U S  I N V O L V M E N T', 'Finance Chair, Green Club sept 2018 – actualidad', 'Formación', 'Grado en Filología · UV 2009 – 2013'].join('\n'));
    expect(draft.experience.map((entry) => entry.title)).toEqual(['Recepcionista']);
    expect(draft.education.map((entry) => entry.title)).toEqual(['Grado en Filología']);
    expect(draft.unparsed.map((item) => item.text)).toEqual(['C A M P U S I N V O L V M E N T', 'Finance Chair, Green Club sept 2018 – actualidad']);
  });
});

describe('structureCv · habilidades con paréntesis (T-8.4b F2)', () => {
  it('no parte un nombre por las comas de dentro de un paréntesis o un corchete', () => {
    const draft = structureCv(['Jane Doe', 'Habilidades', 'Lenguajes: PHP (Symfony, Laravel), Python [pandas, numpy], Go)'].join('\n'));
    expect(draft.skills.map((group) => [group.category, group.names])).toEqual([['language', ['PHP (Symfony, Laravel)', 'Python [pandas, numpy]', 'Go)']]]);
  });
});

describe('structureCv · el nombre no es «la primera línea» (T-9.1)', () => {
  it('puntúa los candidatos de la cabecera: dos o tres palabras capitalizadas, sin cifras ni palabras de documento', () => {
    expect(nameScore('Jane Doe')).toBe(3);
    expect(nameScore('Lucía Ferrer Montalbán')).toBe(3);
    expect(nameScore('MARY SMITH')).toBe(3);
    expect(nameScore('María de la Cruz Pérez')).toBe(2);
    // Títulos de documento, de institución y datos de contacto: nunca son el nombre de la persona.
    expect(nameScore('EXAMPLE RESUME')).toBe(0);
    expect(nameScore('RESUMES/COVER LETTERS')).toBe(0);
    expect(nameScore('Purdue University')).toBe(0);
    expect(nameScore('Current Address')).toBe(0);
    expect(nameScore('Chronological')).toBe(0);
    expect(nameScore('jdoe@gmail.com x')).toBe(0);
    expect(nameScore('Calle Mayor 14')).toBe(0);
    expect(nameScore('Una frase larga que desde luego no es el nombre de nadie')).toBe(0);
    expect(nameScore('Ada')).toBe(0);
  });

  it('elige el mejor candidato aunque no sea la primera línea, y parte la línea por sus separadores', () => {
    // El caso real del corpus: la plantilla pone su categoría arriba y el nombre en la segunda línea, con «| Resume».
    const csuci = structureCv(['Chronological', 'Jane Doe | Resume', '(805) 123-4567', 'jdoe@gmail.com'].join('\n'));
    expect(csuci.fullName).toBe('Jane Doe');
    expect(csuci.headline).toBeUndefined();
    const plymouth = structureCv(['EXAMPLE RESUME', 'Jane Doe', '234 FAKE STREET. MODESTO, CA'].join('\n'));
    expect(plymouth.fullName).toBe('Jane Doe');
    // El titular que acompaña al nombre sí se conserva.
    expect(structureCv('Ada Ejemplo · Ingeniera de plataforma\n').headline).toBe('Ingeniera de plataforma');
  });

  it('sin ningún candidato no inventa un nombre: el borrador lo avisa', () => {
    const guia = structureCv(['Centro de Orientación e Información de Empleo', 'Universidad Complutense de Madrid', 'Información general'].join('\n'));
    expect(guia.fullName).toBeUndefined();
  });
});

describe('«Empresa: Puesto», la convención con dos puntos (B-8)', () => {
  const CV = [
    'Lucía Ferrer Montalbán',
    'Ingeniera de software',
    'Experiencia laboral.',
    '09/2016 – 05/2017 | Concello de Lugo: Desarrolladora.',
    'Estudios.',
    '2011 - 2013. | I.E.S. Muralla Romana: Ciclo Superior de Desarrollo Web.',
  ].join('\n');

  it('con dos puntos el orden es «dónde: qué», al revés que con «·»', () => {
    const draft = structureCv(CV);
    expect(draft.experience[0]).toMatchObject({ title: 'Desarrolladora', subtitle: 'Concello de Lugo' });
    expect(draft.education[0]).toMatchObject({ title: 'Ciclo Superior de Desarrollo Web', subtitle: 'I.E.S. Muralla Romana' });
  });

  it('no parte por los dos puntos lo que es una frase, ni lo que trae varios', () => {
    const prosa = structureCv(['Lucía Ferrer', 'Experiencia laboral.', '09/2016 – 05/2017 | Nexo Pagos', 'Funciones: llevé la pasarela. Nada más.'].join('\n'));
    expect(prosa.experience[0]).toMatchObject({ title: 'Nexo Pagos' });
  });
});

describe('títulos de sección espaciados partidos en dos líneas (B-10)', () => {
  it('la segunda línea espaciada es la cola del título, no una cabecera que cierre la sección', () => {
    const cv = ['Lucas Nunzi', 'E D U C A C I Ó N', 'P R E V I A', 'I.E.S Muralla Romana', '2011 - 2013'].join('\n');
    expect(structureCv(cv).education).toHaveLength(1);
  });

  it('una cabecera espaciada desconocida sigue cerrando la sección en curso', () => {
    const cv = ['Lucas Nunzi', 'E D U C A C I Ó N', 'I.E.S Muralla Romana', '2011 - 2013', 'C A M P U S I N V O L V M E N T', 'Otra cosa', '2014 - 2015'].join('\n');
    const draft = structureCv(cv);
    expect(draft.education).toHaveLength(1);
    expect(draft.unparsed.map((line) => line.text)).toContain('Otra cosa');
  });
});

describe('cuando espaciar es el estilo de la plantilla, no una marca de título (B-10)', () => {
  const spaced = (text: string): string => [...text].join(' ');

  it('un nombre de empresa espaciado ya no cierra su propia sección', () => {
    const cv = [
      'Lucas Nunzi',
      spaced('EXPERIENCIA'),
      'Soporte técnico',
      spaced('RAIOLA'),
      'SEPTIEMBRE 2017 - PRESENTE',
      'Desarrollador',
      spaced('CONCELLO'),
      'SEPTIEMBRE 2016 - MAYO 2017',
      spaced('EDUCACION'),
      'I.E.S Muralla Romana',
      spaced('CICLO'),
      '2011 - 2013',
      spaced('otra linea espaciada'),
      spaced('y una mas todavia'),
    ].join('\n');
    const draft = structureCv(cv);
    expect(draft.experience).toHaveLength(2);
    // El nombre sigue espaciado y así se queda: la frontera entre palabras no existe en lo que entrega pdf.js,
    // y recomponerla sería inventarla. Lo que importa es que la entrada EXISTA, con su puesto y sus fechas.
    expect(draft.experience[0]).toMatchObject({ title: 'Soporte técnico', subtitle: 'R A I O L A', start: '2017-09', current: true });
  });

  it('con el espaciado como excepción, la cabecera desconocida sigue cerrando la sección', () => {
    const cv = ['Lucas Nunzi', 'Experiencia', 'Desarrollador · Acme', '2016 - 2017', spaced('CAMPUS INVOLVMENT'), 'Tesorero del club', '2018 - 2019'].join('\n');
    const draft = structureCv(cv);
    expect(draft.experience).toHaveLength(1);
    expect(draft.unparsed.map((line) => line.text)).toContain('Tesorero del club');
  });

  it('la formación con el centro arriba y la titulación debajo se reparte al derecho', () => {
    const draft = structureCv(['Lucas Nunzi', 'Estudios', 'I.E.S Muralla Romana', 'C.S. Desarrollo de Aplicaciones Web', '2011 - 2013'].join('\n'));
    expect(draft.education[0]).toMatchObject({ title: 'C.S. Desarrollo de Aplicaciones Web', subtitle: 'I.E.S Muralla Romana' });
  });

  it('sin marca de centro en ninguna de las dos, el orden no se toca', () => {
    const draft = structureCv(['Lucas Nunzi', 'Estudios', 'Grado en Filología', 'INGABAD', '2011 - 2013'].join('\n'));
    expect(draft.education[0]).toMatchObject({ title: 'Grado en Filología', subtitle: 'INGABAD' });
  });
});

describe('la viñeta que abre la fila no es parte del título (B-11)', () => {
  it('se retira del título de la entrada, venga sola o pegada a la fecha', () => {
    const draft = structureCv(['Lucas Nunzi', 'Estudios.', '• 2011 2013. | Ciclo Superior Desarrollo de Aplicaciones Web.', 'I.E.S. Muralla Romana.'].join('\n'));
    expect(draft.education[0]).toMatchObject({ title: 'Ciclo Superior Desarrollo de Aplicaciones Web.', start: '2011', end: '2013' });
  });
});

describe('la duración que LinkedIn añade tras el rango', () => {
  it('no se toma por el título de la entrada', () => {
    const cv = ['Lucas Nunzi', 'Experiencia', 'Picas Rojas', 'Desarrollador web', 'noviembre de 2016 - abril de 2017 (6 meses)'].join('\n');
    const draft = structureCv(cv);
    // Lo que este arreglo garantiza: la duración no es el título y las fechas se leen. Que LinkedIn ponga la
    // empresa ANTES que el puesto —al revés de «Rol · Empresa»— se resuelve aparte (B-13) y solo cuando el
    // DOCUMENTO se identifica como su «Guardar como PDF»; en un CV suelto como este no hay marca que lo diga.
    expect(draft.experience[0]?.title).not.toContain('meses');
    expect(draft.experience[0]).toMatchObject({ start: '2016-11', end: '2017-04' });
  });

  it('un paréntesis que no es una duración se respeta', () => {
    const cv = ['Lucas Nunzi', 'Experiencia', '2016 - 2017 Desarrollador (remoto)'].join('\n');
    expect(structureCv(cv).experience[0]?.location).toBe('remoto');
  });
});

describe('el «Guardar como PDF» de un perfil de LinkedIn (B-13)', () => {
  /** El aplanado real de las dos columnas: la barra lateral primero y el nombre detrás, con su pie paginado. */
  const LINKEDIN = [
    'Contactar',
    '665979119 (Home)',
    'ada@example.com',
    'www.linkedin.com/in/ada-lovelace',
    '(LinkedIn)',
    'Aptitudes principales',
    'DevOps',
    'GCP',
    'Lucas Nunzi Lopez',
    'Senior Developer, devops',
    'Lugo, Galicia, España',
    'Extracto',
    'Specialties: php, mysql, linux.',
    'Experiencia',
    'Life5',
    'Software Developer',
    'abril de 2022 - Present (4 años 5 meses)',
    'Raiola Networks',
    'Soporte',
    'septiembre de 2017 - junio de 2021 (3 años 10 meses)',
    'concello de lugo',
    'tecnico de informática',
    'noviembre de 2016 - abril de 2017 (6 meses)',
    'Educación',
    'ies muralla romana',
    'Page 1 of 2',
    'desarrollo de aplicaciones web',
    'ies piringalla',
    'informatica de gestion',
  ].join('\n');
  /** El mismo documento con la URL de quien lo exporta, que es el caso real. */
  const MIO = LINKEDIN.replace('www.linkedin.com/in/ada-lovelace', 'www.linkedin.com/in/lucas-nunzi');

  it('el nombre se identifica por el slug de su propia URL, que es comprobar y no adivinar', () => {
    // La barra lateral empuja el nombre fuera de la ventana de cabecera: sin esto el borrador salía con «Nombre
    // pendiente» y con «Contactar» de titular.
    const draft = structureCv(MIO);
    expect(draft.fullName).toBe('Lucas Nunzi Lopez');
    expect(draft.headline).toBe('Senior Developer, devops');
    expect(draft.location).toBe('Lugo, Galicia, España');
  });

  it('si el slug no casa con ninguna línea, se lee como un CV cualquiera en vez de forzar el formato', () => {
    // Una URL personalizada («/in/devlucas») no dice el nombre: sin poder comprobarlo, no se aplican las reglas
    // de este formato —volver al lector general es lo que se hacía hasta ahora— y no se inventa ningún nombre.
    const draft = structureCv(LINKEDIN);
    expect(draft.fullName).toBeUndefined();
    expect(draft.experience[0]).toMatchObject({ title: 'Life5', subtitle: 'Software Developer' });
  });

  it('la empresa va arriba y el puesto debajo, y dos empleos seguidos no se funden en uno', () => {
    const draft = structureCv(MIO);
    expect(draft.experience.map((entry) => [entry.subtitle, entry.title])).toEqual([
      ['Life5', 'Software Developer'],
      ['Raiola Networks', 'Soporte'],
      ['concello de lugo', 'tecnico de informática'],
    ]);
    expect(draft.experience[1]).toMatchObject({ start: '2017-09', end: '2021-06' });
  });

  it('la formación se empareja por posición y NO se le inventa una fecha', () => {
    const draft = structureCv(MIO);
    expect(draft.education.map((entry) => [entry.subtitle, entry.title])).toEqual([
      ['ies muralla romana', 'desarrollo de aplicaciones web'],
      ['ies piringalla', 'informatica de gestion'],
    ]);
    expect(draft.education.every((entry) => entry.start === undefined && entry.end === undefined)).toBe(true);
    expect(draft.unparsed).toHaveLength(0);
  });

  it('si la titulación trae el rango, se aprovecha; y una tercera línea que es solo la fecha también', () => {
    const conFechas = MIO.replace('desarrollo de aplicaciones web', 'desarrollo de aplicaciones web · (2011 - 2013)').replace(
      'informatica de gestion',
      'informatica de gestion\n2008 - 2010',
    );
    const draft = structureCv(conFechas);
    expect(draft.education[0]).toMatchObject({ title: 'desarrollo de aplicaciones web', start: '2011', end: '2013' });
    expect(draft.education[1]).toMatchObject({ title: 'informatica de gestion', start: '2008', end: '2010' });
  });

  it('un centro sin titulación no se pierde: se avisa como línea sin situar', () => {
    const draft = structureCv(`${MIO}\nies suelto`);
    expect(draft.unparsed.map((line) => line.text)).toEqual(['ies suelto']);
  });

  it('lo que va tras la fecha es el cuerpo de ESE empleo, no la empresa del siguiente', () => {
    const conCuerpo = MIO.replace(
      'abril de 2022 - Present (4 años 5 meses)',
      'abril de 2022 - Present (4 años 5 meses)\n• Migré la plataforma de pagos.',
    );
    const draft = structureCv(conCuerpo);
    expect(draft.experience[0]?.achievements.map((achievement) => achievement.text)).toEqual(['Migré la plataforma de pagos.']);
    expect(draft.experience[1]?.subtitle).toBe('Raiola Networks');
  });

  it('una línea antes del primer empleo no se pierde, y un empleo sin par empresa/puesto se abre igual', () => {
    const raro = MIO.replace('Experiencia\nLife5', 'Experiencia\nNota suelta antes de nada\nLife5').replace(
      'Educación',
      'mayo de 2010 - junio de 2011 Becario\nEducación',
    );
    const draft = structureCv(raro);
    expect(draft.unparsed.map((line) => line.text)).toEqual(['Nota suelta antes de nada']);
    expect(draft.experience.at(-1)).toMatchObject({ title: 'Becario', subtitle: undefined, start: '2010-05', end: '2011-06' });
    // Y con UNA sola línea antes de la fecha, esa línea es el puesto y la empresa queda pendiente: no se reparte
    // a medias lo que el documento no dice.
    const unaLinea = structureCv(MIO.replace('Educación', 'Freelance\nenero de 2020 - marzo de 2021\nEducación'));
    expect(unaLinea.experience.at(-1)).toMatchObject({ title: 'Freelance', subtitle: undefined, start: '2020-01' });
  });

  it('el cuerpo del último empleo, con viñeta o sin ella, no se queda fuera', () => {
    const conCola = MIO.replace('Educación', 'Reduje la latencia del checkout.\nEducación');
    const draft = structureCv(conCola);
    expect(draft.experience.at(-1)?.achievements.map((achievement) => achievement.text)).toEqual(['Reduje la latencia del checkout.']);
  });

  it('sin titular ni ubicación tras el nombre, el resto se lee igual', () => {
    const escueto = MIO.replace('Senior Developer, devops\nLugo, Galicia, España\n', '');
    const draft = structureCv(escueto);
    expect(draft.fullName).toBe('Lucas Nunzi Lopez');
    expect(draft.headline).toBeUndefined();
    expect(draft.location).toBeUndefined();
    expect(draft.experience).toHaveLength(3);
  });

  it('una formación de la que solo consta el centro y sus fechas se guarda así, sin rellenar el hueco', () => {
    const soloCentro = MIO.replace('informatica de gestion', '2008 - 2010');
    expect(structureCv(soloCentro).education.at(-1)).toMatchObject({ title: 'ies piringalla', subtitle: undefined, start: '2008', end: '2010' });
  });

  it('hacen falta las DOS señales: un CV que solo cite su LinkedIn no entra por aquí', () => {
    // Sin el pie paginado no es una exportación de LinkedIn, y las reglas de este formato no se aplican.
    const suelto = ['Ada Lovelace', 'www.linkedin.com/in/ada-lovelace', 'Experiencia', 'Life5', 'Software Developer', 'abril de 2022 - Present'].join('\n');
    expect(structureCv(suelto).experience[0]).toMatchObject({ title: 'Life5', subtitle: 'Software Developer' });
  });

  it('«Contactar», «Aptitudes principales» y «Extracto» son títulos de sección, que es lo que LinkedIn escribe', () => {
    const draft = structureCv(MIO);
    expect(draft.email).toBe('ada@example.com');
    expect(draft.skills.flatMap((group) => group.names)).toEqual(['DevOps', 'GCP']);
    expect(draft.summary).toContain('Specialties');
  });
});

describe('un nombre maquetado letra a letra (B-14)', () => {
  /** Cabecera real de un CV del corpus: el nombre va espaciado y partido en una línea por palabra. */
  const CABECERA = ['L U C A S', 'N U N Z I', 'L Ó P E Z', 'D E S A R R O L L A D O R W E B', 'Soy un apasionado del desarrollo web.'];
  /** Con seis o más líneas espaciadas, espaciar es el estilo de la plantilla y no una marca de título (B-10). */
  const RESTO = ['E X P E R I E N C I A', 'ACME', 'Desarrollador', '2020 - 2021', 'F O R M A C I Ó N', 'I.E.S. Muralla Romana', 'Grado', '2010 - 2012'];

  it('se une por líneas —que es lo único que conserva la frontera entre palabras— y bautiza bien el borrador', () => {
    const draft = structureCv([...CABECERA, ...RESTO].join('\n'));
    expect(draft.fullName).toBe('LUCAS NUNZI LÓPEZ');
    // El titular se deja como viene: dentro de una línea espaciada la separación entre palabras se perdió sin
    // remedio, y «DESARROLLADORWEB» parecería correcto sin serlo. Espaciado se ve que hay que repasarlo.
    expect(draft.headline).toBe('D E S A R R O L L A D O R W E B');
    expect(draft.summary).toBe('Soy un apasionado del desarrollo web.');
  });

  it('no se traga la línea siguiente: al añadirla el nombre puntúa peor y se descarta', () => {
    const draft = structureCv([...CABECERA, ...RESTO].join('\n'));
    expect(draft.fullName).not.toContain('DESARROLLADOR');
  });

  it('un bloque espaciado que no está en la cabecera no es un nombre', () => {
    // «I N F O R M A C I Ó N» / «D E C O N T A C T O» puntuaría igual de bien que un nombre de dos palabras:
    // por eso la regla solo mira la cabecera, y se queda con el primer bloque que puntúe.
    const draft = structureCv(['Ada Lovelace', 'Ingeniera', 'I N F O R M A C I Ó N', 'D E C O N T A C T O', 'ada@example.com', 'E X P E R I E N C I A', 'ACME', 'Dev', '2020 - 2021', 'M Á S', 'C O S A S'].join('\n'));
    expect(draft.fullName).toBe('Ada Lovelace');
  });

  it('si el primer bloque espaciado no puede ser un nombre, se sigue buscando en el siguiente', () => {
    // «C U R R I C U L U M» / «V I T A E» es un rótulo, no una persona: el diccionario de T-9.1 lo descarta y
    // el nombre aparece en el bloque de debajo.
    const pegado = structureCv(['C U R R I C U L U M', 'V I T A E', 'L U C A S', 'N U N Z I', 'Desarrollador web', ...RESTO].join('\n'));
    expect(pegado.fullName).toBe('LUCAS NUNZI');
    // Y con el rótulo en un bloque aparte, separado por una línea normal, se descarta el bloque entero.
    const separado = structureCv(['C U R R I C U L U M', 'V I T A E', 'Actualizado en 2026', 'L U C A S', 'N U N Z I', ...RESTO].join('\n'));
    expect(separado.fullName).toBe('LUCAS NUNZI');
  });

  it('una sola línea espaciada no basta: hacen falta dos para que haya frontera entre palabras', () => {
    const draft = structureCv(['L U C A S', 'Desarrollador web', 'Experiencia', 'ACME', 'Dev', '2020 - 2021'].join('\n'));
    expect(draft.fullName).not.toBe('LUCAS');
  });
});
