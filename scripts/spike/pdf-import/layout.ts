/**
 * P3 · Texto consciente de la maquetación (T-8.4, docs/pdf-import-spike.md §4.2): a partir de los *items* de pdfjs con
 * coordenadas y tamaño de fuente, reconstruye un orden de lectura mejor que el del flujo del PDF y devuelve texto plano
 * para el mismo P1. Reglas: los items con la misma línea base van juntos; dentro de una línea, un hueco horizontal grande
 * o un cambio brusco de tamaño de fuente separa celdas (se emiten unidas con « | »); si la página tiene una columna lateral independiente (un grupo de
 * celdas a la izquierda cuyas líneas se apilan de forma continua, como una barra lateral), se emite primero esa columna
 * entera y después la otra; las fechas al margen o las tablas (celdas izquierdas sueltas) se leen fila a fila. Las
 * páginas consecutivas con la misma división se agrupan para que el flujo principal no se corte con la barra lateral.
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
      if (last !== undefined && gap <= cellGap && !jump) {
        last.text = joinTexts(last.text, item.text, gap, Math.min(last.fontSize, item.fontSize));
        last.end = Math.max(last.end, item.x + item.width);
      } else {
        segments.push({ x: item.x, end: item.x + item.width, text: item.text, fontSize: item.fontSize });
      }
    }
    return { y: group[0]!.y, segments: segments.map((segment) => ({ ...segment, text: segment.text.replace(/\s+/g, ' ').trim() })).filter((segment) => segment.text !== '') };
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
    return line.segments.length > 1 ? detectHeading(first) !== undefined || skillCategory(first) !== undefined : startsWithLabel(first);
  }).length;
  if (rowBound / leftLines.length >= LAYOUT_DEFAULTS.rowBound) {
    return undefined;
  }
  return stacked / (leftLines.length - 1) >= LAYOUT_DEFAULTS.continuity ? { split } : undefined;
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
