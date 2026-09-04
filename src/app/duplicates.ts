/**
 * Qué es «la misma cosa» en dos entradas de un perfil (T-9.19, T-9.20; `docs/cv-import.md` §10.2): el modelo de
 * entrada común, la huella de palabras, la comparación de periodos y el agrupado. Vive aparte de `drafts.ts`
 * porque no es de los borradores: la misma regla agrupa las entradas de un borrador, las de varios entre sí y
 * las de TUS PROPIAS FUENTES contra sí mismas, que es lo que pide `cv duplicates`.
 *
 * La regla no decide nada: un grupo es una PREGUNTA para quien revisa. Cuando seis CV de la misma persona se
 * contradicen en las fechas del mismo empleo, elegir por el usuario sería inventar.
 */
import { normalize } from '../import/text';
import { entityFileName, type EntitySection } from '../parsers';
import type { Education, Experience, MasterProfile, Project } from '../core/schema';

/**
 * Las secciones en las que **un fichero es una entrada** (`docs/formato-dataset.md`). Son las únicas que se
 * pueden comparar y adoptar entrada a entrada: `skills.csv`, `certifications.csv` y `achievements.md` juntan
 * muchas en un solo fichero.
 */
export const ADOPTABLE_SECTIONS = ['experience', 'education', 'projects'] as const;
export type AdoptableSection = (typeof ADOPTABLE_SECTIONS)[number];

export const SECTION_LABEL: Readonly<Record<AdoptableSection, string>> = { experience: 'experiencia', education: 'formación', projects: 'proyecto' };

/** Una entrada de un perfil —de un borrador o de tus fuentes—, con lo justo para reconocerla y compararla. */
export interface ProfileEntry {
  readonly section: AdoptableSection;
  readonly id: string;
  /** Cómo se lee («Desarrollador · Concello de Lugo»). */
  readonly title: string;
  /**
   * Quién es el dueño de la entrada: la empresa, el centro o el nombre del proyecto. Es su **identidad**, y va
   * aparte del título porque comparar el título entero mete el puesto en la misma bolsa que la empresa (B-20).
   * Ausente cuando el importador no lo reconoció («Empresa pendiente»).
   */
  readonly organization?: string | undefined;
  /** El periodo tal cual está en la fuente; ausente si la entrada no lo trae. */
  readonly start?: string | undefined;
  readonly end?: string | undefined;
  /** Fichero de la entrada dentro de su raíz, para abrirlo y editarlo. */
  readonly path: string;
}

/** El periodo de una entrada, si lo tiene: experiencia siempre; formación y proyecto, opcional. */
function datesOf(item: Experience | Education | Project): { readonly start?: string | undefined; readonly end?: string | undefined } {
  const range = item.dates;
  return range === undefined ? {} : { start: range.start, end: range.end };
}

/**
 * De quién es la entrada: la empresa, el centro o el propio proyecto. Es lo que la identifica —dos puestos
 * parecidos en empresas distintas son dos empleos— y por eso se compara aparte del puesto o la titulación.
 */
export function organizationOf(section: AdoptableSection, item: Experience | Education | Project): string {
  if (section === 'experience') {
    return (item as Experience).company;
  }
  return section === 'education' ? (item as Education).institution : (item as Project).name;
}

/** Cómo se lee una entrada: «puesto · empresa», «titulación · centro» o el nombre del proyecto. */
export function titleOf(section: AdoptableSection, item: Experience | Education | Project): string {
  if (section === 'experience') {
    const experience = item as Experience;
    return `${experience.role} · ${experience.company}`;
  }
  if (section === 'education') {
    const education = item as Education;
    return `${education.degree} · ${education.institution}`;
  }
  return (item as Project).name;
}

/** Las entradas adoptables de un perfil, en el orden del perfil. */
export function entriesOf(profile: MasterProfile): readonly ProfileEntry[] {
  return ADOPTABLE_SECTIONS.flatMap((section) =>
    profile[section].map((item) => ({
      section,
      id: item.id,
      title: titleOf(section, item),
      organization: organizationOf(section, item),
      ...datesOf(item),
      path: `${section}/${entityFileName(section as EntitySection, item.id).fileName}.md`,
    })),
  );
}

/* ───────────────────────────── duplicados ───────────────────────────── */

/**
 * Palabras que no distinguen nada: preposiciones, artículos y las formas societarias, que en un corpus de
 * una sola persona aparecen en la mitad de las empresas.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'en', 'y', 'con', 'por', 'para', 'the', 'of', 'and', 'in', 'at',
  'sl', 'slu', 'sa', 'srl', 'sau', 'sln', 'slne', 'ett',
  // Los conectivos con los que se cuenta un renombrado: «Getlife (hoy Life5)» y «Life5 (antes Getlife)» son la
  // misma empresa, y sin quitarlos sus huellas no se contienen y salen dos empleos donde hay uno.
  'hoy', 'antes', 'ahora', 'antiguo', 'antigua', 'formerly', 'now',
]);

/** Solo cuentan las palabras con cuerpo: «de» y «web» no emparejan nada por sí solas. */
const MIN_TOKEN = 4;

/**
 * Lo que el importador escribe cuando NO reconoció el dato (`src/import/draft.ts`). No es información: es la
 * marca de que falta. Contarlo como palabra emparejaba entre sí las siete formaciones de un CV —todas llevan
 * «Centro pendiente»— y las encadenaba en un solo grupo de veinticuatro.
 */
const PLACEHOLDERS: readonly string[] = ['Empresa pendiente', 'Centro pendiente', 'Nombre pendiente'];

/**
 * La huella de una entrada para compararla con otra. Se guardan las palabras Y la cadena sin espacios porque
 * los CV maquetados letra a letra llegan con la frontera entre palabras ya perdida («C O N C E L L O D E
 * L U G O»): ahí lo único que queda es buscar las palabras de la otra entrada DENTRO de la cadena pegada.
 */
export interface EntrySignature {
  readonly tokens: readonly string[];
  readonly glued: string;
  /** La entrada venía espaciada letra a letra. */
  readonly spaced: boolean;
}

function signature(text: string, minToken: number): EntrySignature {
  const words = normalize(PLACEHOLDERS.reduce((rest, placeholder) => rest.replaceAll(placeholder, ' '), text))
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '');
  const single = words.filter((word) => word.length === 1).length;
  return {
    tokens: [...new Set(words.filter((word) => word.length >= minToken && !STOPWORDS.has(word)))],
    glued: words.join(''),
    // Más de la mitad de las «palabras» de una sola letra: el PDF espació el texto y no hay palabras que valgan.
    spaced: words.length >= 6 && single * 2 > words.length,
  };
}

export function signatureOf(...parts: ReadonlyArray<string | undefined>): EntrySignature {
  return signature(parts.filter((part): part is string => part !== undefined).join(' '), MIN_TOKEN);
}

/**
 * La huella de un **nombre propio** —una empresa, un centro, un proyecto—. Ahí no vale el mínimo de cuatro
 * letras del texto corrido: «IBM» y «SAP» son el nombre entero, y descartarlos por cortos dejaría a las dos
 * entradas sin identidad y las haría emparejar con cualquiera.
 */
export function nameSignatureOf(name: string | undefined): EntrySignature {
  return signature(name ?? '', 1);
}

/**
 * La huella de una organización **como aguja**: la que se busca dentro de la otra entrada. Igual que la de un
 * nombre propio, pero sin las iniciales sueltas cuando el nombre trae además palabras de verdad: «I.E.S Muralla
 * Romana» se busca por «muralla romana», porque el otro CV escribe «ies muralla romana» de una pieza y las tres
 * letras sueltas solo diluyen la proporción. Cuando las iniciales son TODO lo que hay («I.E.S» a secas), son el
 * nombre y se quedan.
 */
export function organizationSignatureOf(name: string | undefined): EntrySignature {
  const whole = nameSignatureOf(name);
  const solid = whole.tokens.filter((token) => token.length > 1);
  return solid.length === 0 ? whole : { ...whole, tokens: solid };
}

/** El periodo en meses; sin `end`, abierto. Una fecha «2011» abarca el año entero. */
function span(entry: ProfileEntry): readonly [number, number] | undefined {
  if (entry.start === undefined) {
    return undefined;
  }
  const bound = (date: string, last: boolean): number => {
    const [year, month] = date.split('-');
    return Number(year) * 12 + (month === undefined ? (last ? 12 : 1) : Number(month));
  };
  return [bound(entry.start, false), entry.end === undefined ? Number.POSITIVE_INFINITY : bound(entry.end, true)];
}

/** Desde cuánto solapamiento dos periodos son «el mismo»: la mitad de lo que duran, en media geométrica. */
const OVERLAP_RATIO = 0.5;

/**
 * Dos periodos son el mismo si se pisan al menos la mitad de lo que duran. Dos decisiones, las dos medidas
 * sobre el corpus real:
 *
 * - **Solaparse no basta**: «Graduado Escolar 1986–1993» y «Bachillerato 1993–1997» comparten un año y son dos
 *   cosas distintas.
 * - **Y se comparan con la media geométrica de los dos, no con el más corto**: contra el más corto, contener
 *   puntuaba siempre 1 y un empleo de «2006–2009» se tragaba los tres cursos de tres meses que caen dentro.
 *
 * Si a alguno le faltan las fechas no se descarta nada: deciden las palabras. Un periodo abierto («en curso»)
 * cuenta como un año desde el más tardío de los dos comienzos, que es lo que permite emparejar el empleo
 * actual de un CV con el mismo empleo ya cerrado en otro.
 */
export function periodsOverlap(a: ProfileEntry, b: ProfileEntry): boolean {
  const first = span(a);
  const second = span(b);
  if (first === undefined || second === undefined) {
    return true;
  }
  const open = Math.max(first[0], second[0]) + 11;
  const [aLo, aHi] = [first[0], Number.isFinite(first[1]) ? first[1] : open];
  const [bLo, bHi] = [second[0], Number.isFinite(second[1]) ? second[1] : open];
  const shared = Math.min(aHi, bHi) - Math.max(aLo, bLo) + 1;
  if (shared <= 0) {
    return false;
  }
  return shared >= OVERLAP_RATIO * Math.sqrt((aHi - aLo + 1) * (bHi - bLo + 1));
}

/**
 * Cuánto se parecen dos entradas, de 0 a 1: la proporción de palabras de la más corta que están también en la
 * otra. Con una entrada espaciada letra a letra se buscan las palabras de la otra dentro de la cadena pegada,
 * que es la única comparación posible cuando el PDF perdió los espacios.
 */
export function similarity(a: EntrySignature, b: EntrySignature): number {
  if (a.spaced || b.spaced) {
    const [glued, other] = a.spaced ? [a, b] : [b, a];
    // Si las dos vinieron espaciadas, la comparación honesta es entre las dos cadenas pegadas.
    if (other.spaced) {
      return glued.glued === other.glued || glued.glued.includes(other.glued) || other.glued.includes(glued.glued) ? 1 : 0;
    }
    if (other.tokens.length === 0) {
      return 0;
    }
    return other.tokens.filter((token) => glued.glued.includes(token)).length / other.tokens.length;
  }
  if (a.tokens.length === 0 || b.tokens.length === 0) {
    return 0;
  }
  const shared = a.tokens.filter((token) => b.tokens.includes(token)).length;
  return shared / Math.min(a.tokens.length, b.tokens.length);
}

/** Desde dónde dos entradas se consideran la misma cosa. La mitad de las palabras de la más corta. */
export const SIMILARITY_THRESHOLD = 0.5;

/** Las huellas de una entrada: la del título, la de su organización y la del título con las palabras cortas. */
export interface EntrySignatures {
  /** El título entero, solo con palabras de cuerpo: mide cuánto se parecen dos entradas. */
  readonly title: EntrySignature;
  /** La empresa, el centro o el proyecto: su identidad. Cuenta hasta «IBM» o «I.E.S». */
  readonly organization: EntrySignature;
  /**
   * El título entero tokenizado **como un nombre propio**. Es contra esto —y no contra `title`— contra lo que se
   * busca la organización de la otra entrada: un centro que se llama «I.E.S» es todo palabras de una letra, y
   * buscarlo entre las palabras de cuerpo del otro título no lo encontraría nunca.
   */
  readonly whole: EntrySignature;
}

/** ¿Se reconoce esta organización en el texto de la otra entrada? */
function recognizable(organization: EntrySignature, title: EntrySignature): boolean {
  return similarity(organization, title) >= SIMILARITY_THRESHOLD;
}

/**
 * ¿Cada entrada reconoce a la organización de la otra? Es la **primera** condición para que dos entradas sean
 * la misma cosa, y nació de un falso positivo del corpus real del PO (B-20): «Desarrollador / Administrador ·
 * Servigasa Special Jobs» y «Desarrollador/Administrador · Picas Rojas» compartían la mitad de sus palabras
 * —las del PUESTO— y solapaban fechas, así que se agrupaban. Y como un grupo se forma contra su semilla, ese
 * emparejamiento falso además **robaba** el miembro al grupo verdadero: las dos entradas de Picas Rojas, que sí
 * eran la misma, se quedaban sin agrupar.
 *
 * Se busca la organización **en el título entero de la otra**, no contra su campo `company`, y esa asimetría es
 * deliberada: medio corpus llega con la empresa y el puesto **intercambiados** (T-9.19), así que comparar campo
 * con campo rompería justo el caso que aquel hito resolvió. Lo que se exige es que la empresa de cada una se
 * reconozca en lo que dice la otra, venga en el campo que venga.
 *
 * Y la excepción, también deliberada: si a alguna **no se le conoce** la organización —«Empresa pendiente», que
 * es lo que escribe el importador cuando no la reconoció— no se descarta nada y deciden las palabras del
 * título. Es el caso para el que se hizo T-9.20: una mitad trae las fechas y «Centro pendiente», y la otra el
 * centro de verdad.
 */
export function sameOrganization(a: EntrySignatures, b: EntrySignatures): boolean {
  // Basta con que a UNA no se le conozca: la otra no puede reconocerse en un texto donde la empresa no está.
  if (a.organization.tokens.length === 0 || b.organization.tokens.length === 0) {
    return true;
  }
  return recognizable(a.organization, b.whole) && recognizable(b.organization, a.whole);
}

/** Una entrada dentro de un grupo de duplicados: de qué borrador viene, o de las fuentes de hoy. */
export interface DuplicateMember {
  /** Nombre del borrador; `undefined` = ya está en `data/sources/`. */
  readonly draft?: string | undefined;
  readonly entry: ProfileEntry;
}

export interface DuplicateGroup {
  readonly section: AdoptableSection;
  readonly members: readonly DuplicateMember[];
  /** Ya hay una entrada igual en las fuentes: adoptar otra la duplicaría de verdad. */
  readonly inSources: boolean;
}

export function signaturesOf(entry: ProfileEntry): EntrySignatures {
  return { title: signatureOf(entry.title), organization: organizationSignatureOf(entry.organization), whole: nameSignatureOf(entry.title) };
}

/**
 * Las entradas que parecen la misma cosa, agrupadas. Se comparan solo dentro de la misma sección, solo si son
 * de la **misma organización** —dos puestos parecidos en empresas distintas son dos empleos (B-20)— y solo si
 * los periodos coinciden de verdad: dos cursos de «Monitor Informática» de 2007 y de 2009 son dos cursos.
 *
 * Un grupo son las entradas que se parecen A LA PRIMERA, no las que se parecen en cadena. La diferencia no es
 * un detalle: encadenando, «C. S. Administrador de Sistemas» y «C. S. Desarrollo de Aplicaciones Web» —dos
 * titulaciones distintas, de años distintos— acababan en el mismo grupo porque una tercera entrada sin fechas
 * compartía con ambas el nombre del centro.
 *
 * Siembran primero **las entradas con fechas**, y entre ellas la más antigua: una entrada sin fechas empareja
 * con cualquier periodo, así que de semilla arrastra a su grupo cosas que no tienen que ver. De semilla ordena
 * la sección, la presencia de fechas, el comienzo y el título, así que el resultado no depende del orden en que
 * se leyeron los borradores.
 *
 * NO se decide nada: un grupo es una pregunta para quien revisa, no una fusión. Por eso se devuelven todos sus
 * miembros con su procedencia, incluida la entrada que ya esté en las fuentes.
 */
export function groupDuplicates(members: readonly DuplicateMember[]): readonly DuplicateGroup[] {
  const order = members
    .map((member, index) => ({ member, index, signature: signaturesOf(member.entry) }))
    .sort(
      (a, b) =>
        a.member.entry.section.localeCompare(b.member.entry.section) ||
        Number(a.member.entry.start === undefined) - Number(b.member.entry.start === undefined) ||
        (a.member.entry.start ?? '').localeCompare(b.member.entry.start ?? '') ||
        a.member.entry.title.localeCompare(b.member.entry.title, 'es') ||
        a.index - b.index,
    );
  const grouped = new Set<number>();
  const groups: DuplicateGroup[] = [];
  for (const seed of order) {
    if (grouped.has(seed.index)) {
      continue;
    }
    grouped.add(seed.index);
    const bucket = [seed.member];
    for (const candidate of order) {
      if (grouped.has(candidate.index) || candidate.member.entry.section !== seed.member.entry.section) {
        continue;
      }
      // Tres condiciones, y la organización va primero: sin ella, el puesto empareja empleos de empresas distintas.
      if (
        sameOrganization(seed.signature, candidate.signature) &&
        periodsOverlap(seed.member.entry, candidate.member.entry) &&
        similarity(seed.signature.title, candidate.signature.title) >= SIMILARITY_THRESHOLD
      ) {
        grouped.add(candidate.index);
        bucket.push(candidate.member);
      }
    }
    if (bucket.length > 1) {
      groups.push({ section: seed.member.entry.section, members: bucket, inSources: bucket.some((member) => member.draft === undefined) });
    }
  }
  return groups.sort((a, b) => b.members.length - a.members.length || a.members[0]!.entry.title.localeCompare(b.members[0]!.entry.title, 'es'));
}

export interface DuplicatesResult {
  readonly groups: readonly DuplicateGroup[];
  /** Entradas comparadas, de todos los borradores y de las fuentes. */
  readonly compared: number;
}

