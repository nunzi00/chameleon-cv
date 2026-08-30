/** P1 frente a los patrones de maquetación medidos en el corpus (T-8.4): cada patrón, con el texto tal como lo devuelve el extractor. */
import { describe, expect, it } from 'vitest';

import { structureCv } from '../../src/import/structure';

describe('cabecera y contacto', () => {
  it('separa nombre y titular pegados o unidos por raya; une el teléfono partido; ignora glifos; las URL son enlaces; lo raro queda sin asignar', () => {
    const glued = structureCv('Lucía Ferrer MontalbánIngeniera de software · plataformas de pago y datos\nContacto\n✉ Valencia, España ·\nlucia.ferrer@example.org · +34 600 123\n456 ·\n☎ https://lucia.example.org · Texto extraño sin sentido aquí mismo, muy largo para ser lugar.\n');
    expect(glued).toMatchObject({ fullName: 'Lucía Ferrer Montalbán', headline: 'Ingeniera de software · plataformas de pago y datos', email: 'lucia.ferrer@example.org', phone: '+34 600 123 456', location: 'Valencia, España', links: ['https://lucia.example.org'] });
    expect(glued.unparsed).toEqual([{ line: 0, text: 'Texto extraño sin sentido aquí mismo, muy largo para ser lugar.' }]);
    const dashed = structureCv('Ada Example — Software Engineer\nSummary\nSummary. Once años construyendo plataformas.\n');
    expect(dashed).toMatchObject({ fullName: 'Ada Example', headline: 'Software Engineer', summary: 'Once años construyendo plataformas.' });
    expect(structureCv('Nombre Corto\n').fullName).toBe('Nombre Corto');
    expect(structureCv('Ana LópezCEO\n').fullName).toBe('Ana LópezCEO');
  });
});

describe('entradas: dónde está el título y dónde la fecha', () => {
  it('pastilla antes del título (fecha primero, título después) y título en dos líneas con continuación en minúscula o sin subtítulo', () => {
    const pillFirst = structureCv('Formación\n2014 – 2015\nMáster en Ciencia de Datos · Universitat de València\n');
    expect(pillFirst.education[0]).toMatchObject({ title: 'Máster en Ciencia de Datos', subtitle: 'Universitat de València', start: '2014', end: '2015', provenance: { line: 3 } });
    const twoLines = structureCv('Formación\nMáster en Ciencia de Datos · Universitat\nde València\n2014 – 2015\nGrado en Informática\nUniversitat Politècnica\n2009 – 2013\n');
    expect(twoLines.education.map((entry) => [entry.title, entry.subtitle])).toEqual([
      ['Máster en Ciencia de Datos', 'Universitat de València'],
      ['Grado en Informática', 'Universitat Politècnica'],
    ]);
    const clash = structureCv('Formación\nMáster · Universitat\nOtra línea suelta\n2014 – 2015\n');
    expect(clash.education[0]).toMatchObject({ title: 'Máster', subtitle: 'Universitat' });
    expect(clash.unparsed.map((item) => item.text)).toEqual(['Otra línea suelta']);
  });

  it('fecha debajo del título con el lugar al lado; subtítulo partido antes de las viñetas; tres líneas sueltas desbordan a «sin asignar»', () => {
    const below = structureCv('Experiencia\nStaff Backend Engineer · Nexo Pagos\nmar 2022 – actualidad · Valencia (remoto)\n• Diseñé la pasarela.\n');
    expect(below.experience[0]).toMatchObject({ title: 'Staff Backend Engineer', subtitle: 'Nexo Pagos', location: 'Valencia (remoto)', start: '2022-03', current: true });
    const split = structureCv('Experiencia\nData Engineer · Lumen sept 2015 – dic 2016\nanalytics\n• Construí la canalización.\n');
    expect(split.experience[0]).toMatchObject({ title: 'Data Engineer', subtitle: 'Lumen analytics' });
    const overflow = structureCv('Experiencia\nUna\nDos\nTres\nRol · Empresa mar 2022 – actualidad\n• Logro.\nLínea larga con punto final que no es título ni continuación porque la viñeta cerró la frase.\n');
    expect(overflow.experience[0]).toMatchObject({ title: 'Rol', subtitle: 'Empresa' });
    expect(overflow.unparsed.map((item) => item.text)).toEqual(['Una', 'Dos', 'Tres', 'Línea larga con punto final que no es título ni continuación porque la viñeta cerró la frase.']);
  });

  it('entrada en una sola línea: «Rol, Empresa (Lugar) — periodo. resumen. logro; logro. Technologies: …», y cuerpo sin «;» como resumen', () => {
    const inline = structureCv('EXPERIENCE\nStaff Backend Engineer, Nexo Pagos (Valencia (remoto)) — Mar 2022 – present. Pasarela de pagos B2B con muchas transacciones. Diseñé la arquitectura de la nueva pasarela. (0 incidentes); Reduje la latencia p99 de la API. (-56 % p99) Technologies: PHP 8.3, Kafka.\n');
    const entry = inline.experience[0]!;
    expect(entry).toMatchObject({ title: 'Staff Backend Engineer', subtitle: 'Nexo Pagos', location: 'Valencia (remoto)', start: '2022-03', current: true, technologies: ['PHP 8.3', 'Kafka'] });
    expect(entry.achievements.map((achievement) => [achievement.text, achievement.impact])).toEqual([
      ['Pasarela de pagos B2B con muchas transacciones. Diseñé la arquitectura de la nueva pasarela.', '0 incidentes'],
      ['Reduje la latencia p99 de la API.', '-56 % p99'],
    ]);
    const summaryOnly = structureCv('EXPERIENCE\nEngineer, Acme — Jan 2020 – Dec 2021. A long description of the position without any semicolon separated achievements at all here.\n');
    expect(summaryOnly.experience[0]?.summary).toBe('A long description of the position without any semicolon separated achievements at all here.');
    expect(summaryOnly.experience[0]?.achievements).toEqual([]);
  });
});

describe('certificaciones, habilidades, idiomas y logros transversales', () => {
  it('certificaciones: «(Emisor), fecha» en la línea siguiente, «Nombre (Emisor), fecha», nombre sin fecha seguido de otro, y una línea que solo es un enlace', () => {
    const draft = structureCv('Certificaciones\n☑ AWS Solutions Architect Associate\n(Amazon Web Services), sept 2021\n☑ CKA (CNCF), 20 abr 2021\nHashiCorp Terraform Associate · HashiCorp\nSymfony Certified Developer · SensioLabs\nenlace\n2018\nSin fecha final\n');
    expect(draft.certifications.map((entry) => [entry.title, entry.subtitle, entry.date])).toEqual([
      ['AWS Solutions Architect Associate', 'Amazon Web Services', '2021-09'],
      ['CKA', 'CNCF', '2021-04-20'],
      ['HashiCorp Terraform Associate', 'HashiCorp', undefined],
      ['Symfony Certified Developer', 'SensioLabs', '2018'],
      ['Sin fecha final', undefined, undefined],
    ]);
  });

  it('habilidades: etiqueta con dos puntos vacía, etiqueta seguida de viñetas, etiqueta pegada a los nombres, y listas sueltas que cierran el grupo', () => {
    const draft = structureCv('Habilidades\nLenguajes:\nPHP, Python\nFrameworks\n• Symfony\n• Spark\nHerramientas Terraform, Docker\nGo, Rust\nCloud\n');
    expect(draft.skills.map((group) => [group.category, group.names])).toEqual([
      ['language', ['PHP', 'Python']],
      ['framework', ['Symfony', 'Spark']],
      ['tool', ['Terraform', 'Docker']],
      [undefined, ['Go', 'Rust']],
    ]);
  });

  it('idiomas con nivel entre paréntesis, conocidos sin nivel, y desconocidos sin nivel a «sin asignar»; logros transversales con continuación y líneas sueltas', () => {
    const languages = structureCv('Idiomas\nEnglish (native); Spanish\nKlingon\nFrancés: B2\n');
    expect(languages.languages).toEqual([
      { name: 'English', level: 'native' },
      { name: 'Spanish' },
      { name: 'Francés', level: 'B2' },
    ]);
    expect(languages.unparsed.map((item) => item.text)).toEqual(['Klingon']);
    const achievements = structureCv('Logros destacados\nSuelta antes de la primera viñeta.\n• Ponente en dos ediciones de la\nconferencia PHP Valencia. (dos charlas)\n');
    expect(achievements.achievements).toEqual([{ text: 'Ponente en dos ediciones de la conferencia PHP Valencia.', impact: 'dos charlas', provenance: { line: 3, text: '• Ponente en dos ediciones de la' } }]);
    expect(achievements.unparsed.map((item) => item.text)).toEqual(['Suelta antes de la primera viñeta.']);
  });
});

describe('restos', () => {
  it('una línea corta tras las viñetas sin fecha después queda sin asignar; una fecha suelta sin nombre no crea certificación; dos idiomas seguidos sin nivel', () => {
    const tail = structureCv('Experiencia\nRol · Empresa mar 2022 – actualidad\n• Logro.\nLínea corta final\n');
    expect(tail.experience).toHaveLength(1);
    expect(tail.unparsed.map((item) => item.text)).toEqual(['Línea corta final']);
    expect(structureCv('Certificaciones\nsept 2021\n').certifications).toEqual([]);
    expect(structureCv('Idiomas\nSpanish · English\n').languages).toEqual([{ name: 'Spanish' }, { name: 'English' }]);
  });
});

describe('ramas menores', () => {
  it('contacto solo con etiquetas de enlace; título vacío tras una pastilla; logro en línea sin puntuación; continuaciones tras un impacto; etiqueta desconocida con dos puntos', () => {
    const labels = structureCv('Ada Example\nGitHub · LinkedIn\n');
    expect(labels.links).toEqual(['GitHub', 'LinkedIn']);
    const emptyTitle = structureCv('Formación\n2014 – 2015\n, ,\n');
    expect(emptyTitle.education[0]).toMatchObject({ title: '', start: '2014' });
    const inline = structureCv('EXPERIENCE\nEngineer, Acme — Jan 2020 – Dec 2021. Hice algo importante para el equipo; Otra cosa que también hice bien\n');
    expect(inline.experience[0]?.achievements.map((achievement) => achievement.text)).toEqual(['Hice algo importante para el equipo.', 'Otra cosa que también hice bien.']);
    const merged = structureCv('Experiencia\nRol · Empresa mar 2022 – actualidad\n• Logro con impacto (mucho)\ny continuación en minúscula.\nLogros destacados\n• Ponente (dos veces)\ny algo más.\n');
    expect(merged.experience[0]?.achievements).toEqual([{ text: 'Logro con impacto (mucho) y continuación en minúscula.', impact: undefined, provenance: { line: 3, text: '• Logro con impacto (mucho)' } }]);
    expect(merged.achievements).toEqual([{ text: 'Ponente (dos veces) y algo más.', impact: undefined, provenance: { line: 6, text: '• Ponente (dos veces)' } }]);
    const unknownLabel = structureCv('Habilidades\nOtras cosas:\nAjedrez, Cocina\n');
    expect(unknownLabel.skills).toEqual([{ category: undefined, names: ['Ajedrez', 'Cocina'], provenance: { line: 2, text: 'Otras cosas:' } }]);
  });
});
