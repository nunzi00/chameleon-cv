import { describe, expect, it } from 'vitest';

import { findDateRange } from '../../src/import/dates';
import { LAYOUT_DEFAULTS, collapseSpacedDigits, detectColumns, isBulletCell, layoutText, pageLines, startsWithLabel, type TextItem } from '../../src/import/layout';

const item = (text: string, x: number, y: number, extra: Partial<TextItem> = {}): TextItem => ({ page: 1, text, x, y, width: text.length * 5, fontSize: 10, ...extra });
const stack = (texts: readonly string[], x: number, options: { top?: number; pitch?: number; page?: number } = {}): TextItem[] =>
  texts.map((text, index) => item(text, x, (options.top ?? 700) - index * (options.pitch ?? 14), { page: options.page ?? 1 }));
const numbered = (prefix: string, count: number): string[] => Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`);
const texts = (lines: ReturnType<typeof pageLines>): string[][] => lines.map((line) => line.segments.map((segment) => segment.text));

describe('pageLines', () => {
  it('agrupa por línea base con tolerancia, ordena por x y separa las líneas', () => {
    expect(texts(pageLines([item('mundo', 65, 700.4), item('Hola', 40, 700), item('Segunda', 40, 686)]))).toEqual([['Hola mundo'], ['Segunda']]);
  });

  it('une sin espacio los items que se tocan (kerning) y respeta los espacios explícitos', () => {
    expect(texts(pageLines([item('L', 40, 700), item('anguages', 45, 700), item('de ', 95, 700), item('nada', 110, 700)]))).toEqual([['Languages de nada']]);
    expect(texts(pageLines([item('Universitat', 40, 700), item('2014 – 2015', 95, 700), item('PHP', 40, 686), item('8', 55, 686)]))).toEqual([['Universitat 2014 – 2015'], ['PHP 8']]);
  });

  it('separa celdas en huecos grandes y en saltos de fuente; la tolerancia vertical sigue a la fuente mayor', () => {
    const lines = pageLines([item('2020', 40, 700), item('Título', 120, 700), item('Nombre', 40, 650, { fontSize: 24, width: 80 }), item('titular', 122, 650), item('pegado', 200, 641)]);
    expect(texts(lines)).toEqual([
      ['2020', 'Título'],
      ['Nombre', 'titular', 'pegado'],
    ]);
    expect(lines[1]?.segments[0]).toEqual({ x: 40, end: 120, text: 'Nombre', fontSize: 24 });
  });

  it('descarta items vacíos y normaliza los espacios', () => {
    expect(texts(pageLines([item('   ', 40, 700), item(' a  b ', 40, 700), item(' ', 40, 686)]))).toEqual([['a b']]);
  });

  it('admite opciones propias', () => {
    const lines = pageLines([item('2020', 40, 700), item('Título', 120, 700), item('Nombre', 40, 650, { fontSize: 24, width: 80 }), item('titular', 122, 650)], { cellGap: 100, fontJump: 3, lineTolerance: 0.1 });
    expect(texts(lines)).toEqual([['2020 Título'], ['Nombre titular']]);
  });
});

describe('detectColumns', () => {
  const body = numbered('Cuerpo', 20);

  it('necesita al menos ocho celdas', () => {
    expect(detectColumns(pageLines([item('a', 40, 700), item('b', 40, 686)]))).toBeUndefined();
  });

  it('descarta grupos demasiado próximos', () => {
    expect(detectColumns(pageLines([...stack(numbered('a', 8), 40), ...stack(numbered('b', 8), 80)]))).toBeUndefined();
  });

  it('exige que el grupo derecho tenga al menos una quinta parte de las líneas', () => {
    expect(detectColumns(pageLines([...stack(numbered('Izquierda', 20), 40), ...stack(numbered('Derecha', 2), 200)]))).toBeUndefined();
  });

  it('exige al menos cuatro líneas a la izquierda', () => {
    expect(detectColumns(pageLines([...stack(['Uno', 'Dos', 'Tres'], 40), ...stack(numbered('Derecha', 8), 200, { top: 500 })]))).toBeUndefined();
  });

  it('no ve columna en celdas izquierdas sueltas entre líneas del cuerpo', () => {
    const sparse = ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco'].map((text, index) => item(text, 40, 700 - index * 70));
    expect(detectColumns(pageLines([...sparse, ...stack(numbered('Cuerpo', 30), 200)]))).toBeUndefined();
  });

  it('no ve columna en un margen de fechas aunque se apile', () => {
    const dates = stack(['mar 2022 – actualidad', 'jun 2019 – feb 2022', 'ene 2017 – may 2019', '2015 – 2016', 'Resumen', 'Contacto'], 40);
    expect(detectColumns(pageLines([...dates, ...stack(body, 200)]))).toBeUndefined();
  });

  it('no ve columna en etiquetas o títulos de sección con su valor en la misma línea (tabla de habilidades)', () => {
    const labels = ['Habilidades', 'Lenguajes', 'Frameworks', 'Herramientas', 'Plataformas', 'Bases de datos', 'Cloud', 'Metodologías'];
    const table = labels.flatMap((label, index) => [item(label, 40, 700 - index * 14), item(`valor ${index}`, 200, 700 - index * 14)]);
    expect(detectColumns(pageLines([...table, ...stack(numbered('Cuerpo', 12), 200, { top: 580 })]))).toBeUndefined();
    const narrow = labels.flatMap((label, index) => [item(label, 40, 700 - index * 14), item(`valor ${index}`, 110, 700 - index * 14)]);
    expect(detectColumns(pageLines([...narrow, ...stack(numbered('Cuerpo', 12), 200, { top: 580 })]))).toBeUndefined();
    const glued = labels.map((label, index) => item(`${label} valor ${index}`, 100 - index * 4, 700 - index * 14));
    expect(detectColumns(pageLines([...glued, ...stack(numbered('Cuerpo', 12), 200, { top: 580 })]))).toBeUndefined();
    expect(startsWithLabel('Bases de datos PostgreSQL, MySQL')).toBe(true);
    expect(startsWithLabel('Cloud')).toBe(false);
    expect(startsWithLabel('Valencia, España')).toBe(false);
  });

  it('detecta una barra lateral apilada y devuelve la división', () => {
    const sidebar = stack(['CONTACTO', 'Valencia', 'correo', 'HABILIDADES', 'PHP', 'Python', 'Symfony', 'Docker', 'IDIOMAS', 'Inglés'], 40);
    expect(detectColumns(pageLines([...sidebar, ...stack(body, 200)]))).toEqual({ split: 120 });
    expect(LAYOUT_DEFAULTS.continuity).toBe(0.5);
  });
});

describe('layoutText', () => {
  const sidebar = (page: number, rightX = 200): TextItem[] => [...stack(numbered(`Lateral ${page} ·`, 10), 40, { page }), ...stack(numbered(`Cuerpo ${page} ·`, 20), rightX, { page })];

  it('lee fila a fila una página de una columna, une celdas con « | » y ordena las páginas', () => {
    const items = [item('Página dos', 40, 700, { page: 2 }), item('Hola', 40, 700), item('mundo', 65, 700), item('2020', 40, 686), item('Título', 120, 686)];
    expect(layoutText(items)).toBe('Hola mundo\n2020 | Título\n\nPágina dos');
  });

  it('emite la barra lateral de las páginas consecutivas y después el cuerpo de todas', () => {
    expect(layoutText([...sidebar(1), ...sidebar(2)])).toBe([...numbered('Lateral 1 ·', 10), ...numbered('Lateral 2 ·', 10), ...numbered('Cuerpo 1 ·', 20), ...numbered('Cuerpo 2 ·', 20)].join('\n'));
  });

  it('separa con una línea en blanco una página de una columna tras una con barra lateral', () => {
    const text = layoutText([...sidebar(1), ...stack(['Solo uno', 'Solo dos'], 40, { page: 2 })]);
    expect(text.endsWith('Cuerpo 1 · 20\n\nSolo uno\nSolo dos')).toBe(true);
  });

  it('no agrupa páginas cuya división difiere', () => {
    const text = layoutText([...sidebar(1), ...sidebar(2, 300)]);
    expect(text.split('\n\n')).toHaveLength(2);
    expect(text.indexOf('Lateral 2 · 1')).toBeGreaterThan(text.indexOf('Cuerpo 1 · 20'));
  });
});

describe('viñetas y glifos superpuestos (B-8 y B-9)', () => {
  it('reconoce como viñeta los símbolos y el área de uso privado que emite Word', () => {
    expect(isBulletCell('•')).toBe(true);
    expect(isBulletCell(' ▪ ')).toBe(true);
    // U+F0B7: el bullet de Symbol/Wingdings con el que Word maqueta sus listas.
    expect(isBulletCell('\uF0B7')).toBe(true);
    expect(isBulletCell('• y algo')).toBe(false);
    expect(isBulletCell('2011')).toBe(false);
  });

  it('la viñeta del área de uso privado se normaliza a « • », vaya sola o pegada al texto', () => {
    const lines = pageLines([item('\uF0B7', 40, 700, { width: 5 }), item('2011 - 2013.', 80, 700)]);
    expect(texts(lines)).toEqual([['•', '2011 - 2013.']]);
    // Pegada al contenido (B-11): al principio hace de viñeta; invisible como es, impedía ver la fecha detrás.
    expect(texts(pageLines([item('\uF0B7 2011 2013.', 40, 700)]))).toEqual([['• 2011 2013.']]);
    // En cualquier otra posición no dice nada y se retira, en vez de dejar un carácter que nadie puede leer.
    expect(texts(pageLines([item('Ciclo \uF0B7 Superior', 40, 700)]))).toEqual([['Ciclo Superior']]);
  });

  it('un acento pintado dentro del tramo anterior se coloca en su hueco, no al final', () => {
    // Firma real de «Nuevo2 Curriculum Lucas.pdf»: el texto deja el hueco y la «ó» se pinta encima.
    const base = item('Lucas Nunzi L pez', 56.8, 790, { width: 89.7 });
    const accent = item('ó', 125.4, 790, { width: 5.4 });
    expect(texts(pageLines([base, accent]))).toEqual([['Lucas Nunzi López']]);
  });

  it('si en la posición calculada no hay hueco que ocupar, no se inventa nada', () => {
    const base = item('Lucas Nunzi Lopez', 56.8, 790, { width: 89.7 });
    const accent = item('ó', 125.4, 790, { width: 5.4 });
    expect(texts(pageLines([base, accent]))).toEqual([['Lucas Nunzi Lopezó']]);
    // Tampoco cuando lo superpuesto es una palabra: eso no es un acento.
    const word = item('largo', 125.4, 790, { width: 5.4 });
    expect(texts(pageLines([item('Lucas Nunzi L pez', 56.8, 790, { width: 89.7 }), word]))).toEqual([['Lucas Nunzi L pezlargo']]);
  });

  it('una fila cuya primera celda es una viñeta no convierte la página en dos columnas', () => {
    // Ocho filas «viñeta | fecha | contenido»: es una tabla, no una barra lateral.
    const items = Array.from({ length: 8 }, (_, index) => {
      const y = 700 - index * 14;
      return [item('•', 40, y, { width: 5 }), item(`200${index} - 201${index}.`, 103, y), item(`Titulación ${index}`, 260, y)];
    }).flat();
    expect(detectColumns(pageLines(items))).toBeUndefined();
  });
});

describe('texto espaciado letra a letra (B-10)', () => {
  it('recompone lo que no depende de saber dónde acaba una palabra: cifras y saltos letra/cifra', () => {
    expect(collapseSpacedDigits('2 0 1 1 - 2 0 1 3')).toBe('2011 - 2013');
    expect(collapseSpacedDigits('1 9 9 9')).toBe('1999');
    expect(collapseSpacedDigits('S E P T I E M B R E 2 0 1 7 - P R E S E N T E')).toBe('SEPTIEMBRE 2017 - PRESENTE');
  });

  it('no toca lo que no puede recomponer sin inventarse la frontera entre palabras', () => {
    // Sin cifras no hay nada que delate dónde acaba una palabra: «DESARROLLADORWEB» sería peor que dejarlo.
    expect(collapseSpacedDigits('D E S A R R O L L A D O R W E B')).toBe('D E S A R R O L L A D O R W E B');
    // Ni el texto normal, aunque lleve cifras.
    expect(collapseSpacedDigits('Migración de macros a LibreOffice en 2016')).toBe('Migración de macros a LibreOffice en 2016');
    expect(collapseSpacedDigits('2011 - 2013')).toBe('2011 - 2013');
    expect(collapseSpacedDigits('a 1 b')).toBe('a 1 b');
  });
});

describe('rangos de dos años sin separador (B-11)', () => {
  it('los reconoce cuando la celda son solo los dos años, con o sin viñeta delante', () => {
    expect(findDateRange(' 2011 2013. | Ciclo Superior')).toMatchObject({ start: '2011', end: '2013', text: '2011 2013.' });
    expect(findDateRange('• 1986 1993.')).toMatchObject({ start: '1986', end: '1993' });
  });

  it('no confunde con un rango cualquier par de cifras', () => {
    // La puerta es estrecha a propósito: fuera de la celda, en desorden, o con años imposibles, no hay rango.
    expect(findDateRange('(Curso 1819)')).toBeUndefined();
    expect(findDateRange('2013 2011')).toBeUndefined();
    expect(findDateRange('Ada 2011 2013 fin')).toBeUndefined();
    expect(findDateRange('1900 2005')).toBeUndefined();
  });
});
