/** Utilidades puras del spike de importación desde PDF (T-8.4): normalización, similitud, fechas y títulos de sección. */
import { describe, expect, it } from 'vitest';

import { findDateRange, findSingleDate, parsePoint } from '../../src/import/dates';
import { detectHeading, headingKey, skillCategory } from '../../src/import/headings';
import { alphanumeric, contains, normalize, similarity } from '../../src/import/text';

describe('texto', () => {
  it('normaliza acentos, guiones tipográficos, comillas y espacios; la forma alfanumérica descarta el resto', () => {
    expect(normalize('  Máster en Ciencia de Datos — «Ingeniería» ')).toBe('master en ciencia de datos - ingenieria');
    expect(alphanumeric('Kafka-Guardian: 30 org.')).toBe('kafkaguardian30org');
  });

  it('la similitud de Dice vale 1 para iguales, 0 sin nada en común y tolera partición de palabras', () => {
    expect(similarity('Nexo Pagos', 'nexo pagos')).toBe(1);
    expect(similarity('a', 'b')).toBe(0);
    expect(similarity('PHP', 'Rust')).toBe(0);
    expect(similarity('disponibilidad compro- metida del 99,95 %', 'disponibilidad comprometida del 99,95 %')).toBeGreaterThan(0.95);
    expect(similarity('Staff Backend Engineer', 'Data Engineer')).toBeLessThan(0.6);
  });

  it('contains busca la verdad dentro del texto extraído sin puntuación ni espacios', () => {
    expect(contains('Reduje la latencia p99 de la API de autori-\nzación de 480 ms a 210 ms', 'de 480 ms a 210 ms')).toBe(true);
    expect(contains('nada', '')).toBe(false);
    expect(contains('nada', 'algo')).toBe(false);
  });
});

describe('fechas', () => {
  it('entiende puntos en el tiempo en español, inglés, numéricos y solo año', () => {
    expect(parsePoint('mar 2022')).toBe('2022-03');
    expect(parsePoint('sept 2015')).toBe('2015-09');
    expect(parsePoint('Septiembre de 2015')).toBe('2015-09');
    expect(parsePoint('Jan 2020')).toBe('2020-01');
    expect(parsePoint('03/2020')).toBe('2020-03');
    expect(parsePoint('13/2020')).toBeUndefined();
    expect(parsePoint('2014')).toBe('2014');
    expect(parsePoint('xyz 2020')).toBeUndefined();
    expect(parsePoint('hoy')).toBeUndefined();
  });

  it('reconoce rangos con distintos guiones, «actualidad», «Present», «hasta», solo años y numéricos', () => {
    expect(findDateRange('Staff Backend Engineer · Nexo Pagos mar 2022 – actualidad')).toMatchObject({ start: '2022-03', end: undefined, current: true, text: 'mar 2022 – actualidad' });
    expect(findDateRange('sept 2015 - dic 2016 Data Engineer')).toMatchObject({ start: '2015-09', end: '2016-12', current: false, index: 0 });
    expect(findDateRange('2014 – 2015 · Máster')).toMatchObject({ start: '2014', end: '2015' });
    expect(findDateRange('Jan 2020 — Present')).toMatchObject({ start: '2020-01', current: true });
    expect(findDateRange('03/2020 hasta 05/2021')).toMatchObject({ start: '2020-03', end: '2021-05' });
    expect(findDateRange('Sin fechas aquí')).toBeUndefined();
    expect(findDateRange('xyz 2020 – abc 2021')).toBeUndefined();
    expect(findDateRange('mar 2022 – 13/2021')).toBeUndefined();
  });

  it('encuentra una fecha suelta para certificaciones', () => {
    expect(findSingleDate('AWS Solutions Architect Associate · Amazon Web Services · sept 2021 · enlace')).toMatchObject({ value: '2021-09', text: 'sept 2021' });
    expect(findSingleDate('CKA · CNCF · 20 abr 2021')).toMatchObject({ value: '2021-04-20', text: '20 abr 2021' });
    expect(findSingleDate('CKA · CNCF · link Apr 20, 2021')).toMatchObject({ value: '2021-04-20' });
    expect(parsePoint('31 de diciembre de 2020')).toBe('2020-12-31');
    expect(parsePoint('xx 20, 2021')).toBeUndefined();
    expect(parsePoint('20 xyz 2021')).toBeUndefined();
    expect(detectHeading('L anguages')).toBe('languages');
    expect(findSingleDate('sin fecha')).toBeUndefined();
    expect(findSingleDate('foo 2099x')).toBeUndefined();
  });
});

describe('títulos de sección', () => {
  it('reconoce títulos en ambos idiomas, numerados, en mayúsculas espaciadas o con dos puntos; lo demás no', () => {
    expect(headingKey('1  Experiencia')).toBe('experiencia');
    expect(headingKey('E X P E R I E N C I A')).toBe('experiencia');
    expect(headingKey('Formación:')).toBe('formacion');
    expect(detectHeading('EXPERIENCIA')).toBe('experience');
    expect(detectHeading('Work Experience')).toBe('experience');
    expect(detectHeading('2. Proyectos')).toBe('projects');
    expect(detectHeading('LOGROS DESTACADOS')).toBe('achievements');
    expect(detectHeading('Contacto')).toBe('contact');
    expect(detectHeading('Idiomas')).toBe('languages');
    expect(detectHeading('Staff Backend Engineer · Nexo Pagos')).toBeUndefined();
    expect(detectHeading('')).toBeUndefined();
    expect(detectHeading('x'.repeat(41))).toBeUndefined();
    expect(detectHeading('W ork Experience')).toBe('experience');
  });

  it('traduce las etiquetas de categorías de habilidades al esquema', () => {
    expect(skillCategory('Lenguajes:')).toBe('language');
    expect(skillCategory('Bases de datos')).toBe('database');
    expect(skillCategory('Soft skills')).toBe('soft');
    expect(skillCategory('Cosas')).toBeUndefined();
  });
});
