/**
 * Formateo y ordenación para el modelo de vista (`docs/selector-engine.md` §5.3).
 * Funciones puras sobre los tipos del esquema.
 */
import { expandIsoDate, type DateRange, type IsoDate } from '../../core/schema';

/** `YYYY` → «2021»; `YYYY-MM` → «mar 2021»; `YYYY-MM-DD` → «15 mar 2021» (según locale). */
export function formatDate(iso: IsoDate, locale: string): string {
  if (iso.length === 4) {
    return iso;
  }
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  if (iso.length === 7) {
    return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(Date.UTC(year, month - 1, 1)),
    );
  }
  const day = Number(iso.slice(8, 10));
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

/** «mar 2021 – jun 2024» o «mar 2021 – actualidad». */
export function formatPeriod(dates: DateRange, locale: string, present: string): string {
  const end = dates.end === undefined ? present : formatDate(dates.end, locale);
  return `${formatDate(dates.start, locale)} – ${end}`;
}

interface Dated {
  readonly dates?: DateRange | undefined;
}

type WithDates<T> = T & { readonly dates: DateRange };

function hasDates<T extends Dated>(item: T): item is WithDates<T> {
  return item.dates !== undefined;
}

/** Comparación descendente de claves ya normalizadas. */
function descending(keyA: string, keyB: string): number {
  if (keyA === keyB) {
    return 0;
  }
  return keyA > keyB ? -1 : 1;
}

/**
 * Orden cronológico inverso: periodos en curso primero, después por inicio descendente;
 * los ítems sin fechas van al final en su orden original. Estable.
 */
export function chronological<T extends Dated>(items: readonly T[]): T[] {
  const dated = items.filter(hasDates);
  const undated = items.filter((item) => !hasDates(item));
  const sorted = [...dated].sort((a, b) => {
    const ongoingA = a.dates.end === undefined;
    const ongoingB = b.dates.end === undefined;
    if (ongoingA !== ongoingB) {
      return ongoingA ? -1 : 1;
    }
    return descending(expandIsoDate(a.dates.start, 'start'), expandIsoDate(b.dates.start, 'start'));
  });
  return [...sorted, ...undated];
}

interface SingleDated {
  readonly date?: IsoDate | undefined;
}

type WithDate<T> = T & { readonly date: IsoDate };

function hasDate<T extends SingleDated>(item: T): item is WithDate<T> {
  return item.date !== undefined;
}

/** Fecha descendente; sin fecha, al final en su orden original. Estable. */
export function byDateDescending<T extends SingleDated>(items: readonly T[]): T[] {
  const dated = items.filter(hasDate);
  const undated = items.filter((item) => !hasDate(item));
  const sorted = [...dated].sort((a, b) => descending(expandIsoDate(a.date, 'start'), expandIsoDate(b.date, 'start')));
  return [...sorted, ...undated];
}

/** Une partes opcionales con « · », ignorando las ausentes o vacías. */
export function joinParts(parts: ReadonlyArray<string | undefined>): string {
  return parts.filter((part): part is string => part !== undefined && part !== '').join(' · ');
}
