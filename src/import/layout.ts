/**
 * Texto consciente de la maquetación (T-8.4b, docs/cv-import.md §2, núcleo P3 del spike T-8.4): a partir de los
 * *items* de pdf.js con coordenadas y tamaño de fuente, reconstruye un orden de lectura mejor que el del flujo del
 * PDF. Reglas: items con la misma línea base van juntos; dentro de una línea, un hueco horizontal grande o un cambio
 * brusco de tamaño de fuente separa celdas (unidas con « | »); una columna lateral independiente (celdas a la
 * izquierda apiladas de forma continua) se emite entera antes que el resto; las fechas al margen o las tablas se leen
 * fila a fila; las páginas consecutivas con la misma división se agrupan.
 */

import { findDateRange, findSingleDate } from './dates';
import { detectHeading, skillCategory } from './headings';

export interface TextItem {
  readonly page: number;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly fontSize: number;
}

export interface LayoutOptions {
  /** Tolerancia vertical para considerar dos items en la misma línea, en fracción del tamaño de fuente. */
  readonly lineTolerance?: number | undefined;
  /** Hueco horizontal (en puntos) a partir del cual dos items de una línea son celdas distintas. */
  readonly cellGap?: number | undefined;
  /** Diferencia relativa de tamaño de fuente que parte una línea en celdas. */
  readonly fontJump?: number | undefined;
}

export interface Segment {
  readonly x: number;
  readonly end: number;
  readonly text: string;
  readonly fontSize: number;
}

export interface Line {
  readonly y: number;
  readonly segments: readonly Segment[];
}

export const LAYOUT_DEFAULTS = { lineTolerance: 0.45, cellGap: 14, fontJump: 1.35, clusterWidth: 24, minColumnGap: 60, continuity: 0.5, rowBound: 0.5 } as const;

/**
 * Una celda que es solo una viñeta: los símbolos habituales o un carácter del área de uso privado, que es lo que
 * emite Word cuando la lista usa Symbol o Wingdings (U+F0B7 y vecinos). Sin esto, esa celda parece contenido.
 */
export function isBulletCell(text: string): boolean {
  return /^(?:[•▸◦‣▪■●○*\-–—]|[\uE000-\uF8FF])$/u.test(text.trim());
}

/**
 * Un glifo pintado DENTRO del tramo del item anterior no es la celda siguiente: es un acento que el PDF dibuja
 * sobre el hueco que el texto base deja («Lucas Nunzi L pez» + «ó» en x=125,4 dentro de 56,8–146,5). Se coloca en
 * su sitio, deducido de la geometría, y solo si ahí hay un hueco que ocupar; si no cuadra, se deja como estaba.
 */
function withOverlay(base: { readonly text: string; readonly x: number; readonly end: number }, item: TextItem): string | undefined {
  const span = base.end - base.x;
  if (span <= 0 || item.text.trim().length > 2) {
    return undefined;
  }
  const index = Math.round(((item.x - base.x) / span) * base.text.length);
  // El hueco puede caer un carácter a un lado por el redondeo de la anchura media.
  for (const at of [index, index - 1, index + 1]) {
    if (base.text[at] === ' ') {
      return `${base.text.slice(0, at)}${item.text}${base.text.slice(at + 1)}`;
    }
  }
  return undefined;
}

/** Dos items que se tocan son una palabra partida por el kerning («L» + «anguages»), salvo entre letra y cifra («Universitat» + «2014»: celdas contiguas). */
function joinTexts(left: string, right: string, gap: number, fontSize: number): string {
  if (/\s$/.test(left) || /^\s/.test(right)) {
    return left + right;
  }
  const boundary = (/\p{L}$/u.test(left) && /^\p{N}/u.test(right)) || (/\p{N}$/u.test(left) && /^\p{L}/u.test(right));
  return gap < 0.12 * fontSize && !boundary ? left + right : `${left} ${right}`;
}

/** Agrupa los items de una página en líneas (misma altura) y cada línea en celdas (huecos grandes o saltos de fuente). */
export function pageLines(items: readonly TextItem[], options: LayoutOptions = {}): Line[] {
  const lineTolerance = options.lineTolerance ?? LAYOUT_DEFAULTS.lineTolerance;
  const cellGap = options.cellGap ?? LAYOUT_DEFAULTS.cellGap;
  const fontJump = options.fontJump ?? LAYOUT_DEFAULTS.fontJump;
  const sorted = [...items].filter((item) => item.text.trim() !== '').sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: TextItem[][] = [];
  for (const item of sorted) {
    const current = groups.at(-1);
    const anchor = current?.[0];
    if (current !== undefined && anchor !== undefined && Math.abs(anchor.y - item.y) <= lineTolerance * Math.max(anchor.fontSize, item.fontSize)) {
      current.push(item);
    } else {
      groups.push([item]);
    }
  }
  return groups.map((group) => {
    const ordered = [...group].sort((a, b) => a.x - b.x);
    const segments: Array<{ x: number; end: number; text: string; fontSize: number }> = [];
    for (const item of ordered) {
      const last = segments.at(-1);
      const gap = last === undefined ? 0 : item.x - last.end;
      const jump = last !== undefined && (item.fontSize / last.fontSize >= fontJump || last.fontSize / item.fontSize >= fontJump);
      // Superpuesto sobre el anterior (empieza y acaba dentro de su tramo): acento pintado aparte, no celda nueva.
      const overlaid = last !== undefined && item.x < last.end && item.x + item.width <= last.end + 0.25 * item.fontSize ? withOverlay(last, item) : undefined;
      if (last !== undefined && overlaid !== undefined) {
        last.text = overlaid;
      } else if (last !== undefined && gap <= cellGap && !jump) {
        last.text = joinTexts(last.text, item.text, gap, Math.min(last.fontSize, item.fontSize));
        last.end = Math.max(last.end, item.x + item.width);
      } else {
        segments.push({ x: item.x, end: item.x + item.width, text: item.text, fontSize: item.fontSize });
      }
    }
    // La viñeta del área de uso privado (Word con Symbol/Wingdings) se normaliza a «•»: el resto del importador
    // ya sabe qué es una viñeta, y sin esto la celda parece contenido y rompe la detección de columnas.
    // Word maqueta las listas con un carácter del área de uso privado (U+F0B7 y vecinos) que NO se puede
    // interpretar: es un glifo sin mapear. Al principio de la celda hace de viñeta y se normaliza a «•»; en
    // cualquier otra posición no dice nada y se retira, porque invisible como es, estorba a todo lo que mire el
    // principio de la línea —y de hecho impedía reconocer la fecha de siete formaciones (B-11)—.
    const clean = (text: string): string => {
      const trimmed = text.replace(/\s+/g, ' ').trim();
      const bulleted = trimmed.replace(/^[\uE000-\uF8FF]\s*/u, '• ');
      return collapseSpacedDigits(
        bulleted
          .replace(/[\uE000-\uF8FF]/gu, '')
          .replace(/\s+/g, ' ')
          .trim(),
      );
    };
    return { y: group[0]!.y, segments: segments.map((segment) => ({ ...segment, text: clean(segment.text) })).filter((segment) => segment.text !== '') };
  });
}

/** Una celda que empieza por una etiqueta de habilidad y sigue con su valor («Bases de datos PostgreSQL, MySQL»). */
export function startsWithLabel(text: string): boolean {
  const words = text.split(' ');
  return [1, 2, 3].some((count) => words.length > count && skillCategory(words.slice(0, count).join(' ')) !== undefined);
}

/**
 * Columna lateral: de los dos grupos de celdas más poblados (por su x inicial), el izquierdo forma una columna propia si
 * sus líneas se apilan de forma continua (la mayoría a distancia de una línea de su vecina) y no están «atadas a la
 * fila»: una primera celda que es una fecha o un periodo, un título de sección o etiqueta de habilidad seguida de otra
 * celda en la misma línea base, o una etiqueta pegada a su valor, pertenece a una tabla o a una maquetación con fechas al
 * margen, que se lee fila a fila.
 */
export function detectColumns(lines: readonly Line[]): { readonly split: number } | undefined {
  const starts = lines.flatMap((line) => line.segments.map((segment) => segment.x));
  if (starts.length < 8) {
    return undefined;
  }
  const clusters: Array<{ x: number; count: number }> = [];
  for (const x of [...starts].sort((a, b) => a - b)) {
    const last = clusters.at(-1);
    if (last !== undefined && x - last.x <= LAYOUT_DEFAULTS.clusterWidth) {
      last.count += 1;
    } else {
      clusters.push({ x, count: 1 });
    }
  }
  const top = [...clusters].sort((a, b) => b.count - a.count).slice(0, 2).sort((a, b) => a.x - b.x);
  const [left, right] = top;
  if (left === undefined || right === undefined || right.x - left.x < LAYOUT_DEFAULTS.minColumnGap || right.count < lines.length * 0.2) {
    return undefined;
  }
  const split = (left.x + right.x) / 2;
  const leftLines = lines.filter((line) => line.segments.some((segment) => segment.x < split));
  if (leftLines.length < 4) {
    return undefined;
  }
  let stacked = 0;
  for (let index = 1; index < leftLines.length; index += 1) {
    const previous = leftLines[index - 1]!;
    const current = leftLines[index]!;
    const fontSize = Math.max(previous.segments[0]!.fontSize, current.segments[0]!.fontSize);
    if (previous.y - current.y <= 2.2 * fontSize) {
      stacked += 1;
    }
  }
  const rowBound = leftLines.filter((line) => {
    const first = line.segments[0]!.text;
    if (findDateRange(first) !== undefined || findSingleDate(first) !== undefined) {
      return true;
    }
    // Una fila de varias celdas cuya primera es solo una viñeta es justo eso, una fila: nunca una columna de prosa.
    return line.segments.length > 1 ? isBulletCell(first) || detectHeading(first) !== undefined || skillCategory(first) !== undefined : startsWithLabel(first);
  }).length;
  if (rowBound / leftLines.length >= LAYOUT_DEFAULTS.rowBound) {
    return undefined;
  }
  return stacked / (leftLines.length - 1) >= LAYOUT_DEFAULTS.continuity ? { split } : undefined;
}

/**
 * Algunas plantillas escriben con las letras separadas («S E P T I E M B R E  2 0 1 7 - P R E S E N T E»), y pdf.js
 * las entrega con un único espacio entre cada letra: la frontera entre palabras se pierde ahí dentro y ya no se
 * puede recuperar sin inventarla. Lo que sí se recompone sin inventar nada es lo que no depende de saber dónde
 * acaba una palabra —las cifras y el salto de letra a cifra—, que es justo lo que hace falta para reconocer las
 * fechas y abrir las entradas. Por eso solo se toca la línea espaciada que TRAE CIFRAS: un título espaciado sin
 * ellas se queda como está, porque «D E S A R R O L L A D O R  W E B» sin fronteras sería «DESARROLLADORWEB».
 */
export function collapseSpacedDigits(text: string): string {
  const tokens = text.split(' ');
  if (tokens.length < 4 || !/\d/.test(text) || tokens.filter((token) => token.length === 1).length < tokens.length * 0.8) {
    return text;
  }
  let out = '';
  for (const token of tokens) {
    const previous = out.at(-1);
    const boundary =
      previous === undefined ||
      previous === ' ' ||
      // Separadores de rango y saltos entre letras y cifras: ahí sí se sabe que acaba algo y empieza otra cosa.
      /[-–—/|]/.test(token) ||
      /[-–—/|]/.test(previous) ||
      /\d/.test(previous) !== /\d/.test(token);
    out += (boundary && out !== '' ? ' ' : '') + token;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Las celdas de una línea se unen con « | », separador que la heurística entiende (tablas: «Periodo | Puesto | Empresa»). */
const emit = (lines: readonly Line[]): string[] => lines.map((line) => line.segments.map((segment) => segment.text).join(' | ')).filter((text) => text !== '');

interface PageLayout {
  readonly lines: Line[];
  readonly split: number | undefined;
}

function side(lines: readonly Line[], keep: (segment: Segment) => boolean): Line[] {
  return lines.flatMap((line) => {
    const segments = line.segments.filter(keep);
    return segments.length === 0 ? [] : [{ y: line.y, segments }];
  });
}

/** Texto de todo el documento con el orden de lectura reconstruido; las páginas (o grupos de páginas con columna lateral) van separadas por una línea en blanco. */
export function layoutText(items: readonly TextItem[], options: LayoutOptions = {}): string {
  const pages = new Map<number, TextItem[]>();
  for (const item of items) {
    pages.set(item.page, [...(pages.get(item.page) ?? []), item]);
  }
  const layouts: PageLayout[] = [...pages.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, pageItems]) => {
      const lines = pageLines(pageItems, options);
      return { lines, split: detectColumns(lines)?.split };
    });
  const groups: PageLayout[][] = [];
  for (const layout of layouts) {
    const current = groups.at(-1);
    const first = current?.[0];
    if (current !== undefined && first?.split !== undefined && layout.split !== undefined && Math.abs(first.split - layout.split) <= LAYOUT_DEFAULTS.clusterWidth) {
      current.push(layout);
    } else {
      groups.push([layout]);
    }
  }
  return groups
    .map((group) => {
      const split = group[0]!.split;
      if (split === undefined) {
        return emit(group[0]!.lines).join('\n');
      }
      const left = group.flatMap((layout) => side(layout.lines, (segment) => segment.x < split));
      const right = group.flatMap((layout) => side(layout.lines, (segment) => segment.x >= split));
      return [...emit(left), ...emit(right)].join('\n');
    })
    .join('\n\n');
}
