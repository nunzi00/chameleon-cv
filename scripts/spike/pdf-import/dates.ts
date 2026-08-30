/**
 * Fechas y rangos en el texto de un CV (T-8.4, P1): «mar 2022 – actualidad», «2019–2021», «Jan 2020 – Present»,
 * «03/2020 - 05/2021», «sept 2015 – dic 2016». Devuelve el formato del esquema (`AAAA` o `AAAA-MM`) y si el
 * rango sigue abierto.
 */

const MONTHS: ReadonlyMap<string, number> = new Map([
  ...['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'].map((name, index): [string, number] => [name, index + 1]),
  ...['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].map((name, index): [string, number] => [name, index + 1]),
  ['sept', 9],
  ['enero', 1],
  ['febrero', 2],
  ['marzo', 3],
  ['abril', 4],
  ['mayo', 5],
  ['junio', 6],
  ['julio', 7],
  ['agosto', 8],
  ['septiembre', 9],
  ['setiembre', 9],
  ['octubre', 10],
  ['noviembre', 11],
  ['diciembre', 12],
  ['january', 1],
  ['february', 2],
  ['march', 3],
  ['april', 4],
  ['june', 6],
  ['july', 7],
  ['august', 8],
  ['september', 9],
  ['october', 10],
  ['november', 11],
  ['december', 12],
]);

const OPEN_END = new Set(['actualidad', 'actual', 'presente', 'present', 'hoy', 'now', 'current', 'today']);

/** Solo nombres de mes conocidos (los largos antes que sus abreviaturas), nunca a mitad de palabra («València 2014» no es «ncia 2014»). */
const MONTH_NAME = `(?<![a-záéíóúàèìòùñç])(?:${[...new Set(MONTHS.keys())].sort((a, b) => b.length - a.length).join('|')})\\.?(?![a-záéíóúàèìòùñç])`;
const YEAR = '(?:19|20)\\d{2}';
/** Un punto en el tiempo: «mar 2022», «marzo de 2022», «03/2022», «2022», y con día: «20 abr 2021», «Apr 20, 2021». */
const POINT = `(?<![0-9a-záéíóúàèìòùñç])(?:\\d{1,2}\\s+(?:de\\s+)?${MONTH_NAME}\\s+(?:de\\s+)?${YEAR}|${MONTH_NAME}\\s+\\d{1,2},\\s+${YEAR}|${MONTH_NAME}\\s+(?:de\\s+)?${YEAR}|\\d{1,2}/${YEAR}|${YEAR})(?![0-9a-záéíóúàèìòùñç])`;
const DASH = '\\s*(?:[-\\u2010-\\u2015]|hasta|to|a)\\s*';
const RANGE = new RegExp(`(${POINT})${DASH}(${POINT}|actualidad|actual|presente|present|hoy|now|current|today)`, 'i');

export interface DateRange {
  readonly start: string;
  readonly end: string | undefined;
  readonly current: boolean;
  /** Texto exacto que se reconoció. */
  readonly text: string;
  readonly index: number;
}

function pad(month: number): string {
  return String(month).padStart(2, '0');
}

/** «mar 2022» → «2022-03»; «2022» → «2022»; «03/2022» → «2022-03»; `undefined` si no se entiende. */
export function parsePoint(text: string): string | undefined {
  const trimmed = text.trim().toLowerCase().replace(/\.$/, '');
  const numeric = /^(\d{1,2})\/((?:19|20)\d{2})$/.exec(trimmed);
  if (numeric !== null) {
    const month = Number(numeric[1]);
    return month >= 1 && month <= 12 ? `${numeric[2]}-${pad(month)}` : undefined;
  }
  if (/^(?:19|20)\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const monthOf = (name: string): number | undefined => MONTHS.get(name.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  const dayFirst = /^(\d{1,2})\s+(?:de\s+)?([a-záéíóú]{3,10})\.?\s+(?:de\s+)?((?:19|20)\d{2})$/.exec(trimmed);
  if (dayFirst !== null) {
    const month = monthOf(dayFirst[2]!);
    return month === undefined ? undefined : `${dayFirst[3]}-${pad(month)}-${pad(Number(dayFirst[1]))}`;
  }
  const monthFirst = /^([a-záéíóú]{3,10})\.?\s+(\d{1,2}),\s+((?:19|20)\d{2})$/.exec(trimmed);
  if (monthFirst !== null) {
    const month = monthOf(monthFirst[1]!);
    return month === undefined ? undefined : `${monthFirst[3]}-${pad(month)}-${pad(Number(monthFirst[2]))}`;
  }
  const named = /^([a-záéíóú]{3,10})\.?\s+(?:de\s+)?((?:19|20)\d{2})$/.exec(trimmed);
  if (named === null) {
    return undefined;
  }
  const month = monthOf(named[1]!);
  return month === undefined ? undefined : `${named[2]}-${pad(month)}`;
}

/** El primer rango de fechas de una línea, si lo hay. */
export function findDateRange(line: string): DateRange | undefined {
  const match = RANGE.exec(line);
  if (match === null) {
    return undefined;
  }
  const start = parsePoint(match[1]!);
  if (start === undefined) {
    return undefined;
  }
  const endText = match[2]!.toLowerCase();
  if (OPEN_END.has(endText)) {
    return { start, end: undefined, current: true, text: match[0], index: match.index };
  }
  const end = parsePoint(endText);
  return end === undefined ? undefined : { start, end, current: false, text: match[0], index: match.index };
}

/** Una fecha suelta («sept 2021», «2018»), para certificaciones. */
export function findSingleDate(line: string): { readonly value: string; readonly text: string; readonly index: number } | undefined {
  const match = new RegExp(`(${POINT})`, 'i').exec(line);
  if (match === null) {
    return undefined;
  }
  const value = parsePoint(match[1]!);
  return value === undefined ? undefined : { value, text: match[0], index: match.index };
}
