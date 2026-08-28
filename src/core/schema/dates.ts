/**
 * Fechas del esquema MasterProfile.
 *
 * Se admiten fechas ISO-8601 parciales — `YYYY`, `YYYY-MM` o `YYYY-MM-DD` — y se
 * conservan como texto para respetar la granularidad con la que el candidato las
 * expresó («2019», «2021-03»). Este módulo solo contiene funciones puras.
 */

/** Fecha ISO-8601 parcial: `YYYY`, `YYYY-MM` o `YYYY-MM-DD`. */
export type IsoDate = string;

/** Extremo de un periodo: decide cómo se completa una fecha parcial al compararla. */
export type RangeEdge = 'start' | 'end';

/** Patrón sintáctico de una fecha ISO parcial. */
export const ISO_DATE_PATTERN = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;

/** Año mínimo admitido en un CV. */
export const MIN_YEAR = 1900;

/** Año máximo admitido en un CV. */
export const MAX_YEAR = 2100;

type IsoDateParts =
  | { readonly kind: 'year'; readonly year: number }
  | { readonly kind: 'month'; readonly year: number; readonly month: number }
  | { readonly kind: 'day'; readonly year: number; readonly month: number; readonly day: number };

/** Descompone una fecha sintácticamente válida; `null` si no cumple el patrón. */
function parseIsoDate(value: string): IsoDateParts | null {
  if (!ISO_DATE_PATTERN.test(value)) {
    return null;
  }
  const year = Number(value.slice(0, 4));
  if (value.length === 4) {
    return { kind: 'year', year };
  }
  const month = Number(value.slice(5, 7));
  if (value.length === 7) {
    return { kind: 'month', year, month };
  }
  return { kind: 'day', year, month, day: Number(value.slice(8, 10)) };
}

/** Días del mes (`month` en base 1), bisiestos incluidos. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isValidMonth(month: number): boolean {
  return month >= 1 && month <= 12;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/**
 * Comprueba que `value` es una fecha ISO parcial válida en el calendario: patrón
 * correcto, año entre {@link MIN_YEAR} y {@link MAX_YEAR}, mes 01–12 y día existente
 * en ese mes. No recorta espacios: el saneado es responsabilidad del esquema.
 */
export function isValidIsoDate(value: string): boolean {
  const parts = parseIsoDate(value);
  if (parts === null || parts.year < MIN_YEAR || parts.year > MAX_YEAR) {
    return false;
  }
  switch (parts.kind) {
    case 'year':
      return true;
    case 'month':
      return isValidMonth(parts.month);
    case 'day':
      return isValidMonth(parts.month) && parts.day >= 1 && parts.day <= daysInMonth(parts.year, parts.month);
  }
}

/**
 * Expande una fecha parcial a `YYYY-MM-DD` para poder compararla lexicográficamente.
 * Como `start` se completa con el primer día posible («2021» → «2021-01-01») y como
 * `end` con el último («2021-02» → «2021-02-28»). Presupone una fecha que ha pasado
 * {@link isValidIsoDate}.
 *
 * @throws {TypeError} si `value` no cumple el patrón ISO parcial.
 */
export function expandIsoDate(value: IsoDate, edge: RangeEdge): string {
  const parts = parseIsoDate(value);
  if (parts === null) {
    throw new TypeError(`Fecha ISO inválida: "${value}"`);
  }
  const month = parts.kind === 'year' ? (edge === 'start' ? 1 : 12) : parts.month;
  const day = parts.kind === 'day' ? parts.day : edge === 'start' ? 1 : daysInMonth(parts.year, month);
  return `${pad(parts.year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/**
 * `true` si el periodo `[start, end]` está ordenado: `end` no es anterior a `start`
 * leyendo cada fecha parcial en su sentido más amplio (véase {@link expandIsoDate}).
 */
export function isOrderedRange(start: IsoDate, end: IsoDate): boolean {
  return expandIsoDate(start, 'start') <= expandIsoDate(end, 'end');
}
