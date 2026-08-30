/** P1, el estructurador heurístico (T-8.4): del texto plano de un CV al borrador con procedencia. */
import { describe, expect, it } from 'vitest';

import { structureCv } from '../../../scripts/spike/pdf-import/structure';

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
    const draft = structureCv('Solo un nombre\n\nUna frase que no es contacto ni titular porque termina en punto.\n');
    expect(draft.fullName).toBe('Solo un nombre');
    expect(draft.headline).toBeUndefined();
    expect(draft.summary).toBe('Una frase que no es contacto ni titular porque termina en punto.');
    expect(draft.experience).toEqual([]);
    expect(draft.sections).toEqual([]);
    const empty = structureCv('');
    expect(empty.fullName).toBeUndefined();
    expect(empty.unparsed).toEqual([]);
  });
});
