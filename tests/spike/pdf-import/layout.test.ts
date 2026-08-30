import { describe, expect, it } from 'vitest';

import { LAYOUT_DEFAULTS, detectColumns, layoutText, pageLines, startsWithLabel, type TextItem } from '../../../scripts/spike/pdf-import/layout';

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
