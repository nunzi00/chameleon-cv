/**
 * Comparar tus fuentes con el **informe de vida laboral** (T-9.28, encargo del PO del 4-sep: «a partir del
 * informe de vida laboral sugiere corrección de fechas de empresas, o actualizaciones de fechas de puestos»).
 *
 * Un CV se escribe de memoria y se copia de un CV anterior, así que las fechas se degradan solas. El informe de
 * la Tesorería General de la Seguridad Social es lo más cercano a la verdad que existe sobre eso: no es lo que
 * uno recuerda, es lo que consta. Aquí se usa **solo para las fechas**; los puestos, los logros y las
 * tecnologías no salen de ahí y no se tocan.
 *
 * Tres decisiones que sostienen que esto sugiera y no imponga:
 *
 * 1. **No escribe nada.** Devuelve apuntes; corregir una fecha sigue siendo una edición tuya.
 * 2. **Dice cómo emparejó.** La razón social del informe («YOUR LIFE CORREDURIA DE SEGUROS SL») casi nunca es
 *    la marca del CV («Life5»), así que cuando el nombre no casa se empareja **por el periodo** y se avisa: eso
 *    hay que mirarlo antes de hacer caso.
 * 3. **Un empleo con varias etapas se compara como un todo.** Cuatro puestos en la misma empresa son un alta
 *    sola en el informe: lo que se compara es el comienzo del primero y el final del último.
 *
 * Del informe **solo se leen empresas y fechas**. El nombre, el DNI, el número de la Seguridad Social y el
 * domicilio que trae el PDF no se devuelven, no se escriben y no se imprimen (C4).
 */
import { resolve } from 'node:path';

import type { Experience, MasterProfile } from '../core/schema';
import { employersOf, parseVidaLaboral, type VidaLaboralEmployer } from '../import/vida-laboral';
import type { AppContext } from './context';
import { loadSources } from './dataset';
import { organizationSignatureOf, similarity, SIMILARITY_THRESHOLD, type EntrySignature } from './duplicates';
import { dataError, environmentError, type AppError } from './errors';
import { describeError } from '../shared/errors';

export type VidaLaboralKind = 'start' | 'end' | 'still-open' | 'missing-in-profile' | 'missing-in-report';

export interface VidaLaboralItem {
  readonly kind: VidaLaboralKind;
  /** Empresa, como la dice el informe o como la dicen tus fuentes. */
  readonly company: string;
  readonly title: string;
  readonly detail?: string | undefined;
  /** Por el nombre, o solo por el periodo —y entonces hay que comprobarlo—. */
  readonly matchedBy?: 'name' | 'period' | undefined;
  /** Ficheros de tus fuentes a los que afecta. */
  readonly sources?: readonly string[] | undefined;
}

export interface VidaLaboralReport {
  /** Altas de empleo leídas del informe (sin las situaciones asimiladas). */
  readonly spells: number;
  readonly employers: number;
  readonly items: readonly VidaLaboralItem[];
}

export type VidaLaboralResult = { readonly ok: true; readonly report: VidaLaboralReport } | { readonly ok: false; readonly error: AppError };

/** Las fuentes escriben `YYYY-MM`; el informe, el día exacto. Se compara por mes, que es la precisión de un CV. */
function month(date: string): string {
  return date.slice(0, 7);
}

/**
 * ¿Dos etapas del perfil son de la **misma empresa**? Aquí no vale el umbral de parecido que se usa contra el
 * informe: «Baser Lugo» y «Concello de Lugo» comparten la mitad de sus palabras —la ciudad— y se agrupaban en
 * un solo empleo, con lo que las fechas de uno acababan propuestas para el otro. Se exige **contención**: el
 * nombre de una está entero dentro del de la otra, que es lo que pasa cuando una empresa se renombra
 * («Life5» dentro de «Life5 (antes Getlife)») y no cuando solo comparten dónde están.
 */
function sameCompany(a: EntrySignature, b: EntrySignature): boolean {
  const [short, long] = a.tokens.length <= b.tokens.length ? [a, b] : [b, a];
  return short.tokens.length > 0 && short.tokens.every((token) => long.tokens.includes(token));
}

/** Un grupo de etapas del perfil en la misma empresa, con su periodo completo. */
interface Stint {
  readonly company: string;
  readonly start: string;
  readonly end: string | undefined;
  readonly ids: readonly string[];
  readonly stages: number;
}

/**
 * Las experiencias del perfil agrupadas por empresa: cuatro etapas en Life5 son un empleo, no cuatro. Se
 * agrupan por **identidad de organización**, no por la cadena exacta: «Getlife (hoy Life5)», «Life5 (antes
 * Getlife)» y «Life5» son la misma empresa contada en tres momentos, y compararlas por separado contra un
 * único alta del informe daba dos «no aparece en el informe» que eran mentira.
 */
export function stintsOf(profile: MasterProfile): readonly Stint[] {
  const groups: Experience[][] = [];
  for (const item of profile.experience) {
    const signature = organizationSignatureOf(item.company);
    // Contra CUALQUIER etapa del grupo, no solo la primera: los renombrados se encadenan de dos en dos.
    const group = groups.find((candidate) => candidate.some((stage) => sameCompany(signature, organizationSignatureOf(stage.company))));
    if (group === undefined) {
      groups.push([item]);
    } else {
      group.push(item);
    }
  }
  return groups.map((stages) => {
    const starts = stages.map((stage) => stage.dates.start).sort();
    const ends = stages.map((stage) => stage.dates.end);
    return {
      company: (stages[0] as Experience).company,
      start: starts[0] as string,
      // Si alguna etapa sigue abierta, el empleo sigue abierto.
      end: ends.some((end) => end === undefined) ? undefined : (ends.filter((end): end is string => end !== undefined).sort().at(-1)),
      ids: stages.map((stage) => stage.id),
      stages: stages.length,
    };
  });
}

/** ¿Los dos periodos se pisan? Con un empleo abierto, cuenta desde su comienzo en adelante. */
function overlaps(stint: Stint, employer: VidaLaboralEmployer): boolean {
  const end = stint.end ?? '9999-12';
  return month(employer.start) <= end && month(employer.end) >= month(stint.start);
}

interface Pairing {
  readonly stint: Stint;
  readonly employer: VidaLaboralEmployer;
  readonly by: 'name' | 'period';
}

/**
 * Empareja cada empleo del perfil con su alta en el informe. Primero por **nombre** —cuando la razón social y
 * la marca se parecen— y, con lo que quede, por **periodo**: una empresa del informe que solape con un solo
 * empleo sin emparejar es, casi seguro, la misma con otro nombre. Casi seguro no es seguro, y por eso se dice.
 */
function pair(stints: readonly Stint[], employers: readonly VidaLaboralEmployer[]): readonly Pairing[] {
  const pairs: Pairing[] = [];
  const takenStints = new Set<Stint>();
  const takenEmployers = new Set<VidaLaboralEmployer>();
  for (const stint of stints) {
    const signature = organizationSignatureOf(stint.company);
    // Las altas de autónomo quedan fuera del emparejado por nombre: su «empresa» es la PROVINCIA, así que
    // «Baser Lugo» casaba con el alta de autónomo «LUGO» y le proponía las fechas de otra década.
    const candidates = employers
      .filter((employer) => !takenEmployers.has(employer) && !employer.selfEmployed && similarity(signature, organizationSignatureOf(employer.company)) >= SIMILARITY_THRESHOLD)
      // Con dos altas de nombre parecido gana la que además solapa: es el mismo empleo, no otro homónimo.
      .sort((a, b) => Number(overlaps(stint, b)) - Number(overlaps(stint, a)));
    const match = candidates[0];
    if (match !== undefined) {
      pairs.push({ stint, employer: match, by: 'name' });
      takenStints.add(stint);
      takenEmployers.add(match);
    }
  }
  for (const stint of stints) {
    if (takenStints.has(stint)) {
      continue;
    }
    const candidates = employers.filter((employer) => !takenEmployers.has(employer) && !employer.selfEmployed && overlaps(stint, employer));
    // Solo si no hay duda: con dos candidatas, emparejar sería elegir por el usuario.
    if (candidates.length === 1) {
      const employer = candidates[0] as VidaLaboralEmployer;
      pairs.push({ stint, employer, by: 'period' });
      takenStints.add(stint);
      takenEmployers.add(employer);
    }
  }
  return pairs;
}

/** Altas cortas que un CV no recoge a propósito: prácticas de días, una ETT, un curso. */
const SHORT_SPELL_DAYS = 30;

export interface VidaLaboralRequest {
  readonly data: string;
  /** Fichero del informe (PDF), relativo al directorio de trabajo o absoluto. */
  readonly report: string;
}

/** Lee el PDF del disco y compara. La web, que lo recibe subido, usa directamente `compareVidaLaboralText`. */
export async function compareVidaLaboral(context: AppContext, request: VidaLaboralRequest): Promise<VidaLaboralResult> {
  let text: string;
  try {
    const extracted = await context.pdfExtractor(await context.datasetFileSystem.readBinaryFile(resolve(context.cwd, request.report)));
    if (!extracted.ok) {
      return { ok: false, error: dataError(`No se pudo extraer el texto de «${request.report}»: ${extracted.message}`) };
    }
    text = extracted.text;
  } catch (error) {
    return { ok: false, error: environmentError(`No se pudo leer el informe «${request.report}»: ${describeError(error)}`) };
  }
  return compareVidaLaboralText(context, { data: request.data, text, origin: request.report });
}

export interface VidaLaboralTextRequest {
  readonly data: string;
  /** Texto ya extraído del PDF. */
  readonly text: string;
  /** Cómo nombrar el informe en los mensajes de error. */
  readonly origin?: string | undefined;
}

export async function compareVidaLaboralText(context: AppContext, request: VidaLaboralTextRequest): Promise<VidaLaboralResult> {
  const loaded = await loadSources(context, { data: request.data });
  if (!loaded.ok) {
    return { ok: false, error: loaded.error };
  }
  const rows = parseVidaLaboral(request.text);
  const employers = employersOf(rows);
  if (employers.length === 0) {
    return { ok: false, error: dataError(`${request.origin === undefined ? 'El fichero' : `«${request.origin}»`} no parece un informe de vida laboral: no se reconoce ninguna alta`) };
  }

  const stints = stintsOf(loaded.dataset.profile);
  const pairs = pair(stints, employers);
  const items: VidaLaboralItem[] = [];

  for (const { stint, employer, by } of pairs) {
    const shared = { company: stint.company, matchedBy: by, sources: stint.ids } as const;
    const verify = by === 'period' ? ` Emparejado por el periodo, no por el nombre («${employer.company}»): compruébalo antes de hacer caso.` : '';
    if (month(employer.start) !== month(stint.start)) {
      items.push({
        ...shared,
        kind: 'start',
        title: `${stint.company} empieza en ${stint.start} y el informe dice ${employer.start}`,
        detail: `${stint.stages > 1 ? `Es el comienzo de tu primera etapa allí (${stint.stages.toString()} en total).` : ''}${verify}`.trim(),
      });
    }
    if (stint.end === undefined) {
      items.push({
        ...shared,
        kind: 'still-open',
        title: `${stint.company} sigue abierta en tus fuentes y el informe registra la baja el ${employer.end}`,
        detail: `Si ya no estás allí, ponle fecha de fin; si sigues, el informe puede ir por detrás de la realidad.${verify}`.trim(),
      });
    } else if (month(employer.end) !== month(stint.end)) {
      items.push({
        ...shared,
        kind: 'end',
        title: `${stint.company} termina en ${stint.end} y el informe dice ${employer.end}`,
        detail: `${stint.stages > 1 ? 'Es el final de tu última etapa allí.' : ''}${verify}`.trim(),
      });
    }
  }

  const pairedEmployers = new Set(pairs.map((entry) => entry.employer));
  for (const employer of employers) {
    if (pairedEmployers.has(employer) || employer.days < SHORT_SPELL_DAYS) {
      continue;
    }
    items.push({
      kind: 'missing-in-profile',
      company: employer.company,
      title: `El informe registra ${employer.days.toString()} días en «${employer.company}» (${employer.start} → ${employer.end}) y tus fuentes no lo tienen`,
      detail: employer.selfEmployed ? 'Alta como autónomo: la «empresa» que consta es la provincia.' : 'Decide tú si entra en el CV: el informe registra empleos, no carreras.',
    });
  }

  const pairedStints = new Set(pairs.map((entry) => entry.stint));
  for (const stint of stints) {
    if (pairedStints.has(stint)) {
      continue;
    }
    items.push({
      kind: 'missing-in-report',
      company: stint.company,
      sources: stint.ids,
      title: `«${stint.company}» (${stint.start} → ${stint.end ?? 'actualidad'}) no aparece en el informe`,
      detail: 'El informe no cubre el trabajo en el extranjero, las becas sin alta ni los funcionarios: puede estar bien.',
    });
  }

  return { ok: true, report: { spells: rows.filter((row) => row.employment).length, employers: employers.length, items } };
}
