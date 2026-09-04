/**
 * El **informe de vida laboral** de la Tesorería General de la Seguridad Social (T-9.28): la lista oficial de
 * altas y bajas de una persona. Para un CV es lo más cercano a la verdad que existe sobre **fechas**: no es lo
 * que uno recuerda ni lo que escribió en un CV de 2017, es lo que consta.
 *
 * Este fichero solo lee la **tabla de situaciones**. El informe trae además el nombre, el número de la
 * Seguridad Social, el DNI, la fecha de nacimiento y el domicilio, y **nada de eso sale de aquí**: no se
 * devuelve, no se escribe y no se imprime. El producto necesita empresas y fechas; lo demás es un dato personal
 * que no le hace falta a nadie (C4).
 */

/** Los regímenes con los que empieza una fila de la tabla. */
const REGIMES = ['GENERAL', 'AUTONOMO', 'AGRARIO', 'MAR', 'CARBON', 'HOGAR', 'ARTISTAS'] as const;

/**
 * Situaciones **asimiladas al alta**: no son un empleo. Están en la misma tabla y con la misma forma, así que
 * hay que reconocerlas para no proponer «te falta la empresa PRESTACION DESEMPLEO» en el CV.
 */
const NOT_EMPLOYMENT = [
  'VACACIONES RETRIBUIDAS',
  'PRESTACION DESEMPLEO',
  'PRESTACION POR DESEMPLEO',
  'SUBSIDIO',
  'CONVENIO ESPECIAL',
  'EXCEDENCIA',
  'SERVICIO MILITAR',
  'PRESTACION POR CUIDADO',
];

export interface VidaLaboralRow {
  /** Empresa tal como consta, con su razón social. */
  readonly company: string;
  /** Código de cuenta de cotización, cuando lo hay: distingue dos altas de la misma empresa. */
  readonly account?: string | undefined;
  readonly regime: string;
  /** `YYYY-MM-DD`. */
  readonly start: string;
  readonly end: string;
  readonly days: number;
  /** Situación asimilada al alta (paro, vacaciones no disfrutadas…): no es un empleo. */
  readonly employment: boolean;
}

/** `dd.mm.yyyy` → `YYYY-MM-DD`. */
function isoDate(spanish: string): string {
  const [day = '', month = '', year = ''] = spanish.split('.');
  return `${year}-${month}-${day}`;
}

/** El nombre de la empresa, que en el PDF puede venir partido en varias líneas. */
function companyName(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const ROW = new RegExp(
  // régimen · cuenta de cotización (o guiones) · empresa (puede ocupar varias líneas) · alta · efecto · baja · resto
  String.raw`^(${REGIMES.join('|')})\s+(\d{6,15}|-{3,})\s+([\s\S]*?)\s+(\d{2}\.\d{2}\.\d{4})\s+\d{2}\.\d{2}\.\d{4}\s+(\d{2}\.\d{2}\.\d{4})[^\n]*?(\d[\d.]*)\s*$`,
  'gm',
);

/**
 * Las filas de la tabla, en el orden del informe (de la más reciente a la más antigua). Lo que no encaje con la
 * forma de una fila —cabeceras, avisos legales, las referencias electrónicas de cada página— se ignora sin más:
 * el informe es un PDF pensado para leerse, no para analizarse, y la mitad del texto no es la tabla.
 */
export function parseVidaLaboral(text: string): readonly VidaLaboralRow[] {
  const rows: VidaLaboralRow[] = [];
  for (const match of text.matchAll(ROW)) {
    const [, regime = '', account = '', rawCompany = '', start = '', end = '', days = '0'] = match;
    const company = companyName(rawCompany);
    if (company === '') {
      continue;
    }
    const upper = company.toUpperCase();
    rows.push({
      company,
      ...(account.startsWith('-') ? {} : { account }),
      regime,
      start: isoDate(start),
      end: isoDate(end),
      days: Number(days.replace(/\./g, '')),
      employment: !NOT_EMPLOYMENT.some((label) => upper.startsWith(label)),
    });
  }
  return rows;
}

export interface VidaLaboralEmployer {
  readonly company: string;
  /** Alta como autónomo: la «empresa» que consta es la provincia, no una empresa. */
  readonly selfEmployed: boolean;
  /** El periodo completo: del alta más antigua a la baja más reciente, aunque hubiera varios contratos. */
  readonly start: string;
  readonly end: string;
  /** Cuántas altas distintas hubo con esa empresa. */
  readonly spells: number;
  readonly days: number;
}

/** Meses entre dos fechas `YYYY-MM-DD`. */
function monthsBetween(from: string, to: string): number {
  const [fromYear = 0, fromMonth = 0] = from.split('-').map(Number);
  const [toYear = 0, toMonth = 0] = to.split('-').map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

/**
 * Hasta cuánto puede separar dos altas de la misma empresa para seguir contando como el mismo empleo. Un año
 * cubre de sobra una renovación con verano por medio; más allá, volver a la misma empresa es **otro** empleo y
 * un CV lo cuenta aparte.
 */
const SAME_JOB_GAP_MONTHS = 12;

/**
 * Las empresas del informe, con su periodo completo. Se agrupan los contratos **encadenados** con la misma
 * empresa —renovaciones, cambios de contrato— porque en un CV eso es un empleo, no cinco; pero volver catorce
 * años después no se junta con la primera vez, que daría un tramo de dieciséis años que nadie vivió.
 */
export function employersOf(rows: readonly VidaLaboralRow[]): readonly VidaLaboralEmployer[] {
  const byCompany = new Map<string, VidaLaboralRow[]>();
  for (const row of rows) {
    if (!row.employment) {
      continue;
    }
    const key = row.company.toUpperCase();
    byCompany.set(key, [...(byCompany.get(key) ?? []), row]);
  }
  const runs: VidaLaboralRow[][] = [];
  for (const spells of byCompany.values()) {
    const sorted = [...spells].sort((a, b) => a.start.localeCompare(b.start));
    let run: VidaLaboralRow[] = [];
    for (const spell of sorted) {
      const previous = run.at(-1);
      if (previous !== undefined && monthsBetween(previous.end, spell.start) > SAME_JOB_GAP_MONTHS) {
        runs.push(run);
        run = [];
      }
      run.push(spell);
    }
    runs.push(run);
  }
  return runs
    .map((spells) => ({
      company: (spells[0] as VidaLaboralRow).company,
      selfEmployed: spells.every((spell) => spell.regime === 'AUTONOMO'),
      start: spells.map((spell) => spell.start).sort()[0] as string,
      end: spells.map((spell) => spell.end).sort().at(-1) as string,
      spells: spells.length,
      days: spells.reduce((total, spell) => total + spell.days, 0),
    }))
    .sort((a, b) => b.start.localeCompare(a.start));
}
