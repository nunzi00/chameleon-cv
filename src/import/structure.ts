/**
 * Estructurador heurístico de un CV (T-8.4b, docs/cv-import.md §2): del texto plano a un borrador de perfil con
 * procedencia por campo. Determinista, sin modelo: títulos de sección (diccionario es/en), rangos de fechas, viñetas
 * como logros, línea «rol · empresa · lugar», contacto por expresiones regulares. Lo que no entiende lo deja en
 * `unparsed`: NUNCA inventa (la ayuda del co-piloto llega aparte, como revisión C2).
 *
 * Patrones de maquetación reconocidos (medidos en el corpus del spike T-8.4): título y fecha en la misma línea;
 * fecha en la línea siguiente (con o sin lugar); fecha en la línea anterior (pastillas); título en dos líneas
 * (tablas, columnas); entradas en una sola línea con logros separados por «;»; viñetas partidas; etiquetas de
 * habilidades con dos puntos, en su propia línea, seguidas de viñetas o pegadas a los nombres; certificaciones con
 * «(emisor), fecha» en la línea siguiente; nombre y titular pegados o separados por raya.
 */
import { findDateRange, findSingleDate } from './dates';
import { SKILL_CATEGORY_LABELS, detectHeading, isSpacedHeading, skillCategory, type SectionKind } from './headings';
import { normalize, similarity } from './text';

export interface Provenance {
  /** Línea (base 1) del texto extraído. */
  readonly line: number;
  readonly text: string;
}

export interface DraftAchievement {
  readonly text: string;
  readonly impact?: string | undefined;
  readonly provenance: Provenance;
}

export interface DraftEntry {
  /** Rol (experiencia), nombre (proyecto), título (formación) o nombre (certificación). */
  readonly title: string;
  /** Empresa, institución o emisor. */
  readonly subtitle?: string | undefined;
  readonly field?: string | undefined;
  readonly location?: string | undefined;
  readonly start?: string | undefined;
  readonly end?: string | undefined;
  readonly current?: boolean | undefined;
  /** Fecha única (certificaciones). */
  readonly date?: string | undefined;
  /** La formación abrió con una sola fecha (graduación): se tomó como inicio y hay que revisarla. */
  readonly singleDate?: boolean | undefined;
  readonly url?: string | undefined;
  readonly summary?: string | undefined;
  readonly technologies: readonly string[];
  readonly achievements: readonly DraftAchievement[];
  readonly provenance: Provenance;
}

export interface DraftSkillGroup {
  readonly category: string | undefined;
  readonly names: readonly string[];
  readonly provenance: Provenance;
}

export interface DraftLanguage {
  readonly name: string;
  readonly level?: string | undefined;
}

export interface DraftProfile {
  readonly fullName?: string | undefined;
  readonly headline?: string | undefined;
  readonly email?: string | undefined;
  readonly phone?: string | undefined;
  readonly location?: string | undefined;
  readonly links: readonly string[];
  readonly summary?: string | undefined;
  readonly experience: readonly DraftEntry[];
  readonly projects: readonly DraftEntry[];
  readonly education: readonly DraftEntry[];
  readonly certifications: readonly DraftEntry[];
  readonly skills: readonly DraftSkillGroup[];
  readonly achievements: readonly DraftAchievement[];
  readonly languages: readonly DraftLanguage[];
  readonly sections: ReadonlyArray<{ readonly kind: SectionKind; readonly line: number; readonly title: string }>;
  readonly unparsed: readonly Provenance[];
}

interface Line {
  readonly number: number;
  readonly text: string;
}

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
/** Al menos tres grupos de dígitos (seis cifras o más): un año o un número de página no bastan. */
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}/;
const URL = /https?:\/\/[^\s)]+|www\.[^\s)]+/i;
// Un enlace solo en su línea; admite un espacio interior (algunas fuentes devuelven el guion como espacio).
const CELL_AFTER = /^\s*\|\s/;
const PROSE = /[.;](?:\s|$)/;
const URL_ONLY = /^\s*(?:https?:\/\/|www\.)[^\s)]+(?:\s[^\s)]+)?\s*$/i;
const BULLET = /^(?:[•▸◦‣▪■●○☑☐✓✔\-–—*]|\d+[.)])\s+/;
const CONTACT_GLYPHS = /[✉☎☏⌂]/g;
const SEPARATORS = / · | — | – | \| | • /;
const FOOTER = /(?:·|—|-)\s*(?:\d+\s*\/\s*\d+|p[aá]gina\s+\d+\s+de\s+\d+|page\s+\d+\s+of\s+\d+)\s*$/i;
/** La duración que LinkedIn añade tras el rango («(2 años 4 meses)», «(6 months)»): no es el título de nada. */
const DURATION = /\s*\((?:\d+\s*(?:años?|years?|meses|months?)\s*)+\)\s*$/i;
const TECHNOLOGIES = /^(?:tecnolog[ií]as|technologies|tech|stack)\s*:\s*(.+?)\.?$/i;
const INLINE_TECHNOLOGIES = /\s*(?:tecnolog[ií]as|technologies|stack)\s*:\s*([^;]+?)\.?\s*$/i;
const LINK_LABELS = new Set(['github', 'linkedin', 'web', 'website', 'portfolio', 'twitter', 'x', 'gitlab', 'blog', 'enlace', 'link']);
const TRAILING_LEVEL = /^(\S.*?)\s+((?:nativ[oa]|native|biling[üu]e|bilingual|fluido|fluent|[abc][12]|b[aá]sico|basic|intermedio|intermediate|avanzado|advanced|profesional|professional)\.?)$/i;
const LEVEL = /^(?:nativo|nativa|native|bilingüe|bilingual|fluido|fluent|[abc][12]|b[aá]sico|basic|intermedio|intermediate|avanzado|advanced|profesional|professional|mother tongue|lengua materna)\b/i;
const KNOWN_LANGUAGES = new Set(['espanol', 'castellano', 'spanish', 'ingles', 'english', 'catalan', 'valenciano', 'valencian', 'gallego', 'galician', 'euskera', 'vasco', 'basque', 'frances', 'french', 'aleman', 'german', 'italiano', 'italian', 'portugues', 'portuguese', 'chino', 'chinese', 'mandarin', 'japones', 'japanese', 'arabe', 'arabic', 'ruso', 'russian', 'neerlandes', 'holandes', 'dutch', 'sueco', 'swedish', 'polaco', 'polish', 'griego', 'greek', 'turco', 'turkish', 'coreano', 'korean', 'hindi', 'rumano', 'romanian']);
/** Un cuerpo largo tras la fecha en la misma línea: la entrada va «en una línea» (resumen y logros separados por «;»). */
const INLINE_BODY_MIN = 60;

function toLines(text: string): Line[] {
  return text
    .split(/\r?\n/)
    .map((raw, index) => ({ number: index + 1, text: raw.replace(/\s+/g, ' ').trim() }))
    // Números de página sueltos (1–3 dígitos) y pies «Nombre · 1 / 2»; un año suelto («2018») sí es contenido.
    .filter((line) => line.text !== '' && !FOOTER.test(line.text) && !/^\d{1,3}$/.test(line.text) && !/^(?:p[aá]gina|page)\s+\d+/i.test(line.text));
}

/**
 * El «Guardar como PDF» de un perfil de LinkedIn (B-13). Se pide EL DOCUMENTO, no una línea: dos señales
 * independientes —la URL del perfil y el pie paginado que LinkedIn escribe siempre— para que un CV corriente que
 * se limite a listar su LinkedIn no entre por aquí. Solo con las dos se aplican las reglas de este formato, que
 * son las contrarias a las del resto (la empresa va ANTES que el puesto, y la formación no trae fechas).
 */
const LINKEDIN_PROFILE_URL = /(?:^|[\s(])(?:www\.)?linkedin\.com\/in\/([\w%.-]+)/i;
const LINKEDIN_PAGE_FOOTER = /^\s*(?:p[aá]gina|page)\s+\d+\s+(?:de|of)\s+\d+\s*$/im;

export function linkedInPdfSlug(text: string): string | undefined {
  const url = LINKEDIN_PROFILE_URL.exec(text);
  return url === null || !LINKEDIN_PAGE_FOOTER.test(text) ? undefined : normalize(decodeURIComponent(url[1]!).replace(/-/g, ' '));
}

/**
 * La barra lateral de LinkedIn (contacto y aptitudes) va ANTES del nombre al aplanar las dos columnas, así que el
 * nombre queda fuera de la ventana de cabecera y el borrador salía «Nombre pendiente». Aquí se identifica por el
 * slug de su propia URL —comprobación, no adivinanza— y se lleva al principio con su titular; la ubicación se
 * devuelve aparte para el contacto, que es su sitio.
 */
function hoistLinkedInIdentity(lines: readonly Line[], slug: string): { readonly lines: Line[]; readonly location: string | undefined } | undefined {
  const words = slug.split(' ').filter((word) => word !== '');
  const index = lines.findIndex((line) => {
    const parts = normalize(line.text).split(' ');
    return words.length > 0 && words.every((word) => parts.includes(word)) && nameScore(line.text) > 0;
  });
  // Sin una línea que case con el slug no se sabe de quién es el documento —una URL personalizada («/in/devlucas»)
  // no dice el nombre—, y entonces se lee como un CV cualquiera: es lo que se hacía hasta ahora, y es preferible
  // a aplicar las reglas de un formato del que ya no estamos seguros.
  if (index === -1) {
    return undefined;
  }
  const identity = [lines[index]!];
  const next = lines[index + 1];
  if (next !== undefined && detectHeading(next.text) === undefined && !isContactLine(next.text)) {
    identity.push(next);
  }
  const after = lines[index + identity.length];
  const location = after !== undefined && detectHeading(after.text) === undefined && looksLikeLocation(after.text) ? after : undefined;
  const consumed = new Set([...identity, ...(location === undefined ? [] : [location])]);
  return { lines: [...identity, ...lines.filter((line) => !consumed.has(line))], location: location?.text };
}

function provenance(line: Line): Provenance {
  return { line: line.number, text: line.text };
}

function trimSeparators(text: string): string {
  return text.replace(/^[·|—–,;:.\s-]+|[·|—–,;:\s-]+$/g, '').trim();
}

function splitParts(text: string): string[] {
  return text
    .split(SEPARATORS)
    .map(trimSeparators)
    .filter((part) => part !== '');
}

function isBullet(text: string): boolean {
  return BULLET.test(text);
}

function stripBullet(text: string): string {
  return text.replace(BULLET, '').trim();
}

/** «Texto del logro. (impacto)» → texto e impacto; el impacto es el paréntesis final. */
export function splitImpact(text: string): { readonly text: string; readonly impact: string | undefined } {
  const match = /^(.*\S)\s+\(([^()]{3,})\)\.?$/.exec(text);
  return match === null ? { text, impact: undefined } : { text: match[1]!, impact: match[2]! };
}

/** Una línea continúa la viñeta anterior si esta no cerró la frase o si la línea empieza en minúscula o con un paréntesis. */
function isContinuation(previous: string, text: string): boolean {
  return !/[.!?)]$/.test(previous) || /^[a-záéíóúñ(]/.test(text);
}

/**
 * Marcas de centro educativo. Sirve para decidir el reparto cuando la formación llega en dos líneas: unas
 * plantillas ponen la titulación primero y el centro debajo, y otras al revés. Solo decide cuando UNA de las dos
 * lleva marca y la otra no; sin marca clara no se toca nada, que es mejor que invertirlo al azar.
 */
const INSTITUTION = /\b(?:i\.?e\.?s|universi(?:dad|ty|tat|dade|té)|college|school|escuela|instituto|facultad|academia|polit[eé]cnico|colegio)\b/i;

function looksLikeInstitution(text: string): boolean {
  return INSTITUTION.test(text);
}

function looksLikeLocation(text: string): boolean {
  return text !== '' && text.length <= 48 && !/[.:;]/.test(text) && !isBullet(text) && findDateRange(text) === undefined && !/\d{4}/.test(text);
}

function startsLowercase(text: string): boolean {
  return /^[a-záéíóúñ]/.test(text);
}

interface ContactDraft {
  email?: string | undefined;
  phone?: string | undefined;
  location?: string | undefined;
  links: string[];
  leftovers: string[];
}

function isContactLine(text: string): boolean {
  return EMAIL.test(text) || URL.test(text) || PHONE.test(text) || splitParts(text).some((part) => LINK_LABELS.has(normalize(part)));
}

function parseContact(text: string, draft: ContactDraft): void {
  for (const part of splitParts(text.replace(CONTACT_GLYPHS, ' '))) {
    const email = EMAIL.exec(part);
    if (email !== null) {
      draft.email ??= email[0];
      continue;
    }
    const url = URL.exec(part);
    if (url !== null) {
      draft.links.push(url[0]);
      continue;
    }
    if (PHONE.test(part)) {
      draft.phone ??= part.replace(/^(?:tel|tlf|phone)\.?\s*:?\s*/i, '');
      continue;
    }
    if (LINK_LABELS.has(normalize(part))) {
      draft.links.push(part);
      continue;
    }
    if (draft.location === undefined && looksLikeLocation(part)) {
      draft.location = part;
      continue;
    }
    draft.leftovers.push(part);
  }
}

/** «Rol · Empresa · Lugar», «Rol, Empresa (Lugar)» o «Nombre — Rol». */
function parseTitle(text: string, keepParenthesis = false): { readonly title: string; readonly subtitle: string | undefined; readonly location: string | undefined } {
  let rest = trimSeparators(text);
  if (rest === '') {
    return { title: '', subtitle: undefined, location: undefined };
  }
  // «Concello de Lugo: Desarrollador» — con dos puntos el orden español es «dónde: qué», al revés que con «·»,
  // así que la parte derecha es el puesto (o la titulación) y la izquierda la empresa (o el centro). Solo con un
  // par limpio: dos lados con cuerpo, sin más signos y sin la longitud de una frase.
  // La prosa se reconoce por la DERECHA («Funciones: llevé la pasarela. Nada más.»); a la izquierda los puntos son
  // siglas del centro o de la empresa («I.E.S. Muralla Romana»), así que ahí no se puede exigir lo mismo.
  const colon = /^([^:]{2,80}?)\s*:\s*([^:]{2,80}?)\.?$/.exec(rest);
  if (colon !== null && !PROSE.test(colon[2]!)) {
    return { title: trimSeparators(colon[2]!), subtitle: trimSeparators(colon[1]!), location: undefined };
  }
  let location: string | undefined;
  const parenthesized = keepParenthesis ? null : /^(.*?\S)\s*\((.+)\)$/.exec(rest);
  if (parenthesized !== null) {
    rest = parenthesized[1]!;
    location = parenthesized[2]!;
  }
  const parts = SEPARATORS.test(rest) ? splitParts(rest) : rest.split(/\s*,\s*/).map(trimSeparators).filter((part) => part !== '');
  if (parts.length >= 3) {
    // El paréntesis final califica al lugar («Valencia (remoto)»), no lo sustituye.
    return { title: parts[0]!, subtitle: parts[1], location: location === undefined ? parts[2] : `${parts[2]} (${location})` };
  }
  return { title: parts[0]!, subtitle: parts[1], location };
}

function parseDegree(text: string): { readonly degree: string; readonly field: string | undefined } {
  const match = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(text);
  return match === null ? { degree: text, field: undefined } : { degree: match[1]!, field: match[2]! };
}

type EntryKind = 'experience' | 'projects' | 'education';

interface OpenEntry {
  singleDate?: boolean;
  title: string;
  subtitle: string | undefined;
  location: string | undefined;
  url: string | undefined;
  start: string;
  end: string | undefined;
  current: boolean;
  summary: string[];
  technologies: string[];
  achievements: Array<{ text: string; impact: string | undefined; provenance: Provenance }>;
  provenance: Provenance;
  sawBullet: boolean;
  /** La fecha llegó antes que el título (pastilla en su propia línea): la siguiente línea es el título. */
  needsTitle: boolean;
}

function achievementsFromInline(body: string, line: Line): Array<{ text: string; impact: string | undefined; provenance: Provenance }> {
  return body
    .split(/;\s*/)
    .map((piece) => trimSeparators(piece))
    .filter((piece) => piece !== '')
    .map((piece) => ({ ...splitImpact(piece.replace(/\.$/, '') + (/[.!?)]$/.test(piece) ? '' : '.')), provenance: provenance(line) }));
}

/** Entradas con rango de fechas (experiencia, proyectos, formación). */
/** Similitud mínima entre una línea y «título subtítulo» de una entrada cerrada para tratarla como su bloque de detalle. */
const REPEATED_TITLE = 0.75;

/** Separadores que anuncian una fecha de graduación tras el título («Grado en Filología | mayo 2014»). */
const DATE_GLUE = ['|', '·', ',', '\u2013', '\u2014', '-', '(', '\u2010', '\u2011'];

/**
 * Si una fecha suelta abre una formación: cierra la línea, va tras un separador y
 * el título que queda delante tiene cuerpo. Sin esto, cualquier año dentro de una guía abre una entrada falsa.
 */
function opensWithSingleDate(text: string, single: NonNullable<ReturnType<typeof findSingleDate>>): boolean {
  const line = text.trim();
  if (!line.endsWith(single.text)) {
    return false;
  }
  const before = line.slice(0, single.index);
  const title = trimSeparators(before);
  if (title.length < 10 || title.split(/\s+/).length < 2 || !/^\p{Lu}/u.test(title)) {
    return false;
  }
  return DATE_GLUE.includes(before.trimEnd().slice(-1));
}

function parseEntries(lines: readonly Line[], kind: EntryKind, unparsed: Provenance[]): DraftEntry[] {
  const entries: DraftEntry[] = [];
  /** La entrada abierta tal como estaba al cerrarse, por si un bloque de detalle posterior la reabre. */
  const closed: OpenEntry[] = [];
  const pending: Line[] = [];
  let current: OpenEntry | undefined;
  const keepPending = (line: Line): void => {
    pending.push(line);
    if (pending.length > 2) {
      unparsed.push(provenance(pending.shift()!));
    }
  };
  const dropPending = (): void => {
    for (const line of pending.splice(0)) {
      unparsed.push(provenance(line));
    }
  };
  const flush = (): void => {
    if (current === undefined) {
      return;
    }
    const degree = kind === 'education' ? parseDegree(current.title) : { degree: current.title, field: undefined };
    entries.push({
      title: degree.degree,
      subtitle: current.subtitle,
      field: degree.field,
      location: current.location,
      url: current.url,
      start: current.start,
      end: current.end,
      current: current.current,
      ...(current.singleDate === true ? { singleDate: true } : {}),
      summary: current.summary.length === 0 ? undefined : current.summary.join(' '),
      technologies: current.technologies,
      achievements: current.achievements,
      provenance: current.provenance,
    });
    closed.push(current);
    current = undefined;
  };
  /** El título viene en una o dos líneas anteriores: «Rol · Empresa» + «de València» (continuación) o «Título» + «Centro» (tabla). */
  const titleFromPending = (entry: OpenEntry): void => {
    const [first, second] = pending.splice(0);
    if (first === undefined) {
      entry.needsTitle = true;
      return;
    }
    // «I.E.S Muralla Romana» / «C.S. Desarrollo de Aplicaciones Web»: aquí el centro va ARRIBA y la titulación
    // debajo, al revés de lo habitual. Con una marca de centro en una sola de las dos líneas se sabe cuál es cuál.
    const swap =
      kind === 'education' && second !== undefined && looksLikeInstitution(first.text) && !looksLikeInstitution(second.text) && !SEPARATORS.test(first.text);
    const [titleLine, subtitleLine] = swap ? [second, first] : [first, second];
    const parsed = parseTitle(titleLine.text, kind === 'education');
    entry.title = parsed.title;
    entry.subtitle = parsed.subtitle;
    entry.location ??= parsed.location;
    entry.provenance = provenance(titleLine);
    const second_ = subtitleLine;
    if (second_ !== undefined) {
      const continuation = trimSeparators(second_.text);
      if (parsed.subtitle !== undefined && startsLowercase(continuation)) {
        entry.subtitle = `${parsed.subtitle} ${continuation}`;
      } else if (parsed.subtitle === undefined) {
        entry.subtitle = continuation;
      } else {
        unparsed.push(provenance(second_));
      }
    }
  };
  const open = (line: Line, range: NonNullable<ReturnType<typeof findDateRange>>, singleDate = false): void => {
    flush();
    let before = trimSeparators(line.text.slice(0, range.index));
    let after = trimSeparators(line.text.slice(range.index + range.text.length));
    let url: string | undefined;
    for (const candidate of [before, after]) {
      const link = URL.exec(candidate);
      if (link !== null) {
        url = link[0];
      }
    }
    if (url !== undefined) {
      before = trimSeparators(before.replace(url, ''));
      after = trimSeparators(after.replace(url, ''));
    }
    const entry: OpenEntry = { title: '', subtitle: undefined, location: undefined, url, start: range.start, end: range.end, current: range.current, summary: [], technologies: [], achievements: [], provenance: provenance(line), sawBullet: false, needsTitle: false };
    // Cuerpo en línea tras la fecha solo si parece prosa (frases con punto o punto y coma) y no es una fila de tabla («Periodo | Puesto | Empresa»);
    // «2014 – 2015 Máster en Ciencia de Datos · Universitat de València» es un título largo, no un cuerpo.
    const inlineBody = after.length >= INLINE_BODY_MIN && PROSE.test(after) && !CELL_AFTER.test(line.text.slice(range.index + range.text.length)) ? after : undefined;
    const joined = trimSeparators((inlineBody === undefined ? `${before} ${after}` : before).replace(DURATION, ''));
    // La viñeta que abre la fila («• | 2011 2013. | Ciclo Superior…») no es parte del título de la entrada.
    const titleText = isBullet(joined) ? stripBullet(joined) : joined;
    // «mar 2022 – actualidad · Valencia (remoto)» debajo del título: lo que queda junto a la fecha es el lugar, no un título.
    const restIsLocation = pending.length > 0 && titleText !== '' && !SEPARATORS.test(titleText) && looksLikeLocation(titleText);
    if (titleText === '' || restIsLocation) {
      entry.location = titleText === '' ? undefined : titleText;
      titleFromPending(entry);
    } else {
      dropPending();
      const parsed = parseTitle(titleText, kind === 'education');
      entry.title = parsed.title;
      entry.subtitle = parsed.subtitle;
      entry.location = parsed.location;
    }
    if (inlineBody !== undefined) {
      let body = inlineBody;
      const technologies = INLINE_TECHNOLOGIES.exec(body);
      if (technologies !== null) {
        entry.technologies.push(...technologies[1]!.split(/\s*,\s*/).map((name) => name.trim()).filter((name) => name !== ''));
        body = trimSeparators(body.slice(0, technologies.index));
      }
      if (body.includes(';')) {
        entry.achievements.push(...achievementsFromInline(body, line));
        entry.sawBullet = true;
      } else {
        entry.summary.push(body);
      }
    }
    entry.singleDate = singleDate;
    current = entry;
  };
  const dateAt = lines.map((line) => findDateRange(line.text) !== undefined);
  const titleLike = (line: Line): boolean => line.text.length <= 90 && !/[.!?]$/.test(line.text) && !isBullet(line.text) && !TECHNOLOGIES.test(line.text) && !URL_ONLY.test(line.text);
  for (const [index, line] of lines.entries()) {
    const range = findDateRange(line.text);
    if (range !== undefined) {
      open(line, range);
      continue;
    }
    // «Grado en Filología | mayo 2014»: en formación la fecha de graduación viene sola; se toma como inicio y se avisa.
    const single = kind === 'education' ? findSingleDate(line.text) : undefined;
    if (single !== undefined && titleLike(line) && opensWithSingleDate(line.text, single)) {
      open(line, { start: single.value, end: undefined, current: false, text: single.text, index: single.index }, true);
      continue;
    }
    if (current === undefined) {
      keepPending(line);
      continue;
    }
    // La fecha de la entrada siguiente viene una o dos líneas más abajo: esta línea corta es su título, no cuerpo de la actual.
    const next = lines[index + 1];
    const continuation = startsLowercase(line.text) && line.text.length <= 40 && current.subtitle !== undefined && current.summary.length === 0;
    const startsNextEntry = !current.needsTitle && !continuation && titleLike(line) && (dateAt[index + 1] === true || (dateAt[index + 2] === true && next !== undefined && titleLike(next)));
    if (startsNextEntry) {
      flush();
      keepPending(line);
      continue;
    }
    // Bloque de detalle que repite el título de una entrada ya cerrada («Staff Backend Engineer — Nexo Pagos» tras la tabla): se reabre.
    const repeated = titleLike(line) ? entries.findIndex((entry) => similarity(`${entry.title} ${entry.subtitle ?? ''}`, line.text) >= REPEATED_TITLE) : -1;
    if (repeated !== -1) {
      flush();
      entries.splice(repeated, 1);
      current = closed.splice(repeated, 1)[0];
      continue;
    }
    if (titleLike(line) && similarity(`${current.title} ${current.subtitle ?? ''}`, line.text) >= REPEATED_TITLE) {
      // Cabecera del bloque de detalle de la entrada abierta: no es resumen.
      continue;
    }
    if (current.needsTitle) {
      const parsed = parseTitle(line.text, kind === 'education');
      current.title = parsed.title;
      current.subtitle = parsed.subtitle;
      current.location ??= parsed.location;
      current.provenance = provenance(line);
      current.needsTitle = false;
      continue;
    }
    const technologies = TECHNOLOGIES.exec(line.text);
    if (technologies !== null) {
      current.technologies.push(...technologies[1]!.split(/\s*[,;]\s*/).map((name) => name.trim()).filter((name) => name !== ''));
      continue;
    }
    if (isBullet(line.text)) {
      const { text, impact } = splitImpact(stripBullet(line.text));
      current.achievements.push({ text, impact, provenance: provenance(line) });
      current.sawBullet = true;
      continue;
    }
    const last = current.achievements.at(-1);
    if (current.sawBullet && last !== undefined && isContinuation(`${last.text}${last.impact === undefined ? '' : ` (${last.impact})`}`, line.text)) {
      const merged = splitImpact(`${last.text}${last.impact === undefined ? '' : ` (${last.impact})`} ${line.text}`);
      last.text = merged.text;
      last.impact = merged.impact;
      continue;
    }
    if (!current.sawBullet) {
      if (URL_ONLY.test(line.text)) {
        // Enlace del proyecto en su propia línea, bajo el título; un segundo enlace queda sin asignar.
        if (current.url === undefined) {
          current.url = line.text.replace(/\s+/g, '');
        } else {
          unparsed.push(provenance(line));
        }
      } else if (current.subtitle !== undefined && current.summary.length === 0 && startsLowercase(line.text) && line.text.length <= 40) {
        // Continuación del subtítulo partido por la maquetación («Universitat» + «de València»).
        current.subtitle = `${current.subtitle} ${trimSeparators(line.text)}`;
      } else if (current.location === undefined && current.summary.length === 0 && looksLikeLocation(line.text)) {
        current.location = line.text;
      } else {
        current.summary.push(line.text);
      }
      continue;
    }
    // Tras las viñetas, una línea corta sin punto final puede ser el título de la entrada siguiente (fecha más abajo).
    if (line.text.length <= 90 && !/[.!?]$/.test(line.text)) {
      keepPending(line);
      continue;
    }
    unparsed.push(provenance(line));
  }
  flush();
  dropPending();
  return entries;
}

/**
 * Experiencia en el PDF de LinkedIn (B-13): grupos rígidos de «empresa / puesto / rango con su duración», con la
 * empresa ARRIBA —al revés de «Rol · Empresa»— y el cuerpo, si lo hay, detrás de la fecha. El lector general
 * trataba esas líneas como continuación de la entrada abierta y fundía dos empleos en uno; aquí se agrupan por la
 * posición, que es justo lo que este formato garantiza. Lo que precede al par empresa/puesto es el cuerpo del
 * empleo ANTERIOR, que es donde LinkedIn lo escribe.
 */
function parseLinkedInExperience(lines: readonly Line[], unparsed: Provenance[]): DraftEntry[] {
  const entries: DraftEntry[] = [];
  let pending: Line[] = [];
  const body = (line: Line): void => {
    const previous = entries.at(-1);
    if (previous === undefined) {
      unparsed.push(provenance(line));
      return;
    }
    const text = isBullet(line.text) ? stripBullet(line.text) : line.text;
    const split = splitImpact(text);
    entries[entries.length - 1] = { ...previous, achievements: [...previous.achievements, { text: split.text, impact: split.impact, provenance: provenance(line) }] };
  };
  for (const line of lines) {
    const range = findDateRange(line.text);
    if (range === undefined) {
      pending.push(line);
      continue;
    }
    // Las dos últimas líneas antes de la fecha son la empresa y el puesto; lo anterior, cuerpo del empleo previo.
    const head = pending.splice(Math.max(0, pending.length - 2));
    for (const before of pending) {
      body(before);
    }
    pending = [];
    const [company, role] = head.length === 2 ? head : [undefined, head[0]];
    const title = role === undefined ? trimSeparators(line.text.replace(range.text, '').replace(DURATION, '')) : trimSeparators(role.text);
    entries.push({
      title,
      subtitle: company === undefined ? undefined : trimSeparators(company.text),
      start: range.start,
      end: range.end,
      current: range.current,
      technologies: [],
      achievements: [],
      provenance: provenance(company ?? role ?? line),
    });
  }
  for (const line of pending) {
    body(line);
  }
  return entries;
}

/**
 * Formación en el PDF de LinkedIn (B-13): pares «centro / titulación», y muchas veces **sin ninguna fecha**. El
 * lector general abre las entradas por la fecha, así que allí estas seis líneas acababan sin situar y el perfil
 * salía con cero formaciones. Aquí se emparejan por posición —que es lo que el formato garantiza— y **no se
 * inventa una fecha**: la formación sin fechas es válida en el esquema, y es preferible a adivinarla. Si la
 * titulación trae el rango entre paréntesis, o va en una tercera línea suelta, se aprovecha.
 */
function parseLinkedInEducation(lines: readonly Line[], unparsed: Provenance[]): DraftEntry[] {
  const entries: DraftEntry[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const institution = lines[index]!;
    const degreeLine = lines[index + 1];
    if (degreeLine === undefined) {
      unparsed.push(provenance(institution));
      break;
    }
    index += 1;
    let range = findDateRange(degreeLine.text);
    let title = range === undefined ? degreeLine.text : trimSeparators(degreeLine.text.replace(range.text, '').replace(/\(\s*\)/, ''));
    const tail = lines[index + 1];
    // Una tercera línea que sea SOLO el rango pertenece a esta entrada, no a la siguiente.
    if (range === undefined && tail !== undefined) {
      const only = findDateRange(tail.text);
      if (only !== undefined && trimSeparators(tail.text.replace(only.text, '')) === '') {
        range = only;
        index += 1;
      }
    }
    title = trimSeparators(title.replace(DURATION, ''));
    const degree = parseDegree(title === '' ? institution.text : title);
    entries.push({
      title: degree.degree,
      subtitle: title === '' ? undefined : institution.text,
      field: degree.field,
      start: range?.start,
      end: range?.end,
      current: range?.current,
      technologies: [],
      achievements: [],
      provenance: provenance(institution),
    });
  }
  return entries;
}

/** Certificaciones: «Nombre · Emisor · fecha · enlace», «Nombre (Emisor), fecha», o el nombre en una línea y «(Emisor), fecha» en la siguiente. */
function parseCertifications(lines: readonly Line[]): DraftEntry[] {
  const entries: DraftEntry[] = [];
  let carry: { readonly title: string; readonly subtitle: string | undefined; readonly provenance: Provenance } | undefined;
  const push = (entry: { readonly title: string; readonly subtitle: string | undefined; readonly provenance: Provenance }, date: string | undefined): void => {
    const parsed = /^(.*\S)\s*\(([^()]+)\)$/.exec(entry.title);
    entries.push({ title: parsed === null ? entry.title : parsed[1]!, subtitle: entry.subtitle ?? parsed?.[2], date, technologies: [], achievements: [], provenance: entry.provenance });
  };
  for (const line of lines) {
    const text = stripBullet(line.text);
    const date = findSingleDate(text);
    const remainder = date === undefined ? text : trimSeparators(text.replace(date.text, ''));
    const parts = splitParts(remainder).filter((part) => !LINK_LABELS.has(normalize(part)));
    const issuerOnly = /^\(([^()]+)\)$/.exec(remainder);
    if (parts.length === 0 && date === undefined) {
      continue; // solo un enlace o separadores
    }
    if (carry !== undefined && (parts.length === 0 || issuerOnly !== null)) {
      push({ ...carry, subtitle: carry.subtitle ?? issuerOnly?.[1] }, date?.value);
      carry = undefined;
      continue;
    }
    if (parts.length === 0) {
      continue;
    }
    const entry = { title: parts[0]!, subtitle: parts[1], provenance: provenance(line) };
    if (date !== undefined) {
      push(entry, date.value);
      carry = undefined;
    } else {
      if (carry !== undefined) {
        push(carry, undefined);
      }
      carry = entry;
    }
  }
  if (carry !== undefined) {
    push(carry, undefined);
  }
  return entries;
}

/** Trocea «PHP (Symfony, Laravel), Python»: los separadores dentro de paréntesis pertenecen al nombre. */
function splitNames(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(' || char === '[') {
      depth += 1;
    } else if ((char === ')' || char === ']') && depth > 0) {
      depth -= 1;
    } else if (depth === 0 && (char === ',' || char === ';' || char === '·')) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((name) => trimSeparators(stripBullet(name.trim()))).filter((name) => name !== '');
}

/** «Lenguajes PHP, Python» (etiqueta sin dos puntos, como en un margen): la etiqueta conocida al principio. */
function splitLabelledLine(text: string): { readonly label: string; readonly names: string } | undefined {
  const key = normalize(text);
  for (const [label] of SKILL_CATEGORY_LABELS) {
    if (key.startsWith(`${label} `) && key.length > label.length + 1) {
      return { label, names: trimSeparators(text.slice(label.length)) };
    }
  }
  return undefined;
}

/** Habilidades: «Lenguajes: PHP, Python», etiqueta en su propia línea seguida de nombres o de viñetas, «Lenguajes PHP, Python», o listas sueltas. */
function parseSkills(lines: readonly Line[]): DraftSkillGroup[] {
  const groups: Array<{ category: string | undefined; names: string[]; provenance: Provenance }> = [];
  let label: Line | undefined;
  for (const line of lines) {
    const labelled = /^([^:]{2,40}):\s*(.*)$/.exec(line.text);
    if (labelled !== null && labelled[2]!.trim() !== '') {
      groups.push({ category: skillCategory(labelled[1]!), names: splitNames(labelled[2]!), provenance: provenance(line) });
      label = undefined;
      continue;
    }
    if (skillCategory(line.text) !== undefined || (labelled !== null && labelled[2]!.trim() === '')) {
      label = line;
      groups.push({ category: skillCategory(line.text.replace(/:$/, '')), names: [], provenance: provenance(line) });
      continue;
    }
    const prefixed = splitLabelledLine(line.text);
    if (prefixed !== undefined) {
      groups.push({ category: skillCategory(prefixed.label), names: splitNames(prefixed.names), provenance: provenance(line) });
      label = undefined;
      continue;
    }
    const group = label === undefined ? undefined : groups.at(-1);
    if (group !== undefined && (isBullet(line.text) || group.names.length === 0)) {
      group.names.push(...splitNames(line.text));
      continue;
    }
    label = undefined;
    groups.push({ category: undefined, names: splitNames(line.text), provenance: provenance(line) });
  }
  return groups.filter((group) => group.names.length > 0);
}

/** Idiomas: «Español · nativo · Inglés · C1», «Español: nativo», «Español (nativo)» o uno por línea; sin nivel, solo si es un idioma conocido. */
function parseLanguages(lines: readonly Line[], unparsed: Provenance[]): DraftLanguage[] {
  const languages: DraftLanguage[] = [];
  const accept = (name: string, line: Line): void => {
    if (KNOWN_LANGUAGES.has(normalize(name))) {
      languages.push({ name });
    } else {
      unparsed.push({ line: line.number, text: name });
    }
  };
  for (const line of lines) {
    // «Valenciano C1» sin separador: el nivel final se separa del nombre.
    const parts = splitParts(stripBullet(line.text).replace(/[;,]\s*/g, ' · ').replace(/:\s*/g, ' · ').replace(/\s*\(([^()]+)\)/g, ' · $1').replace(TRAILING_LEVEL, '$1 · $2'));
    let candidate: string | undefined;
    for (const part of parts) {
      if (LEVEL.test(part) && candidate !== undefined) {
        languages.push({ name: candidate, level: part.replace(/\.$/, '') });
        candidate = undefined;
        continue;
      }
      if (candidate !== undefined) {
        accept(candidate, line);
      }
      candidate = part.replace(/\.$/, '');
    }
    if (candidate !== undefined) {
      accept(candidate, line);
    }
  }
  return languages;
}

function parseAchievements(lines: readonly Line[], unparsed: Provenance[]): DraftAchievement[] {
  const achievements: DraftAchievement[] = [];
  for (const line of lines) {
    if (isBullet(line.text)) {
      const { text, impact } = splitImpact(stripBullet(line.text));
      achievements.push({ text, impact, provenance: provenance(line) });
    } else if (achievements.length > 0) {
      const last = achievements.at(-1)!;
      const merged = splitImpact(`${last.text}${last.impact === undefined ? '' : ` (${last.impact})`} ${line.text}`);
      achievements[achievements.length - 1] = { text: merged.text, impact: merged.impact, provenance: last.provenance };
    } else {
      unparsed.push(provenance(line));
    }
  }
  return achievements;
}

/**
 * Palabras que descartan un candidato a nombre: títulos de documento y de institución. Salen del corpus real
 * (T-9.1): «Chronological», «EXAMPLE RESUME», «SAMPLE RESUMES», «Purdue University», «Centro de Orientación…»
 * se tomaban como el nombre de la persona, y el nombre de verdad acababa en el titular o perdido.
 */
const NAME_STOPWORDS: ReadonlySet<string> = new Set([
  'resume', 'resumen', 'curriculum', 'vitae', 'cv', 'sample', 'samples', 'template', 'plantilla',
  'chronological', 'functional', 'combination', 'hybrid', 'guide', 'guia', 'handout', 'copyright', 'page', 'pagina',
  'university', 'universidad', 'college', 'instituto', 'institute', 'centro', 'center', 'vicerrectorado', 'facultad', 'department', 'departamento', 'school', 'oficina', 'office', 'hall',
  'student', 'estudiante', 'employee', 'empleo', 'cover', 'letter', 'letters', 'carta', 'cartas', 'address', 'direccion',
]);

/** Partículas que van en minúscula dentro de un nombre («María de la Cruz Pérez»). */
const NAME_PARTICLES: ReadonlySet<string> = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'das', 'dos', 'di', 'du', 'van', 'von', 'of', 'the']);

/**
 * Cuánto se parece un fragmento al nombre de una persona: 0 si no lo parece. Dos o tres palabras capitalizadas
 * (con partículas en minúscula) puntúan más que cuatro o cinco; nada con cifras, arrobas, enlaces o palabras
 * de documento.
 */
export function nameScore(text: string): number {
  const trimmed = trimSeparators(text).trim();
  if (trimmed.length < 4 || trimmed.length > 60 || /[0-9@]|https?:/i.test(trimmed)) {
    return 0;
  }
  // «RESUMES/COVER LETTERS»: la barra separa palabras, así que se parte también por ella para juzgarlas.
  const words = trimmed.split(/[\s/]+/);
  if (words.length < 2 || words.length > 5) {
    return 0;
  }
  const plain = words.map((word) => normalize(word).replace(/[^a-z]/g, ''));
  if (plain.some((word) => NAME_STOPWORDS.has(word))) {
    return 0;
  }
  const shaped = words.every((word, index) => /^\p{Lu}/u.test(word) || (index > 0 && NAME_PARTICLES.has(plain[index]!)));
  if (!shaped) {
    return 0;
  }
  return words.length <= 3 ? 3 : 2;
}

/** La primera línea puede traer nombre y titular pegados («Nombre — Titular», o sin salto de línea entre una banda y otra). */
function splitNameLine(text: string): { readonly name: string; readonly headline: string | undefined } {
  const dashed = /^(.{3,80}?)\s+[—–]\s+(.+)$/.exec(text);
  if (dashed !== null) {
    return { name: dashed[1]!, headline: dashed[2]! };
  }
  const glued = /^((?:\S+\s+){1,5}\S*[a-záéíóúñ])([A-ZÁÉÍÓÚÑ][^·]*(?:·.*)?)$/.exec(text);
  if (glued !== null && glued[2]!.split(' ').length >= 2) {
    return { name: glued[1]!, headline: glued[2]! };
  }
  return { name: text, headline: undefined };
}

/**
 * El mejor candidato a nombre entre las primeras líneas de la cabecera: cada línea se trocea por sus separadores
 * («Jane Doe | Resume») y, si no los tiene, se prueba también la partición de nombre y titular pegados. Gana la
 * puntuación más alta y, a igualdad, la línea más arriba.
 */
/**
 * Un nombre maquetado letra a letra llega partido por palabras, una por línea: «L U C A S» / «N U N Z I» /
 * «L Ó P E Z» (B-14). Cada línea se colapsa por separado —el salto de línea es lo único que conserva la
 * frontera entre palabras, que dentro de una línea espaciada se pierde sin remedio— y se prueban las uniones de
 * dos líneas en adelante, quedándose con la más larga que siga puntuando como nombre. Así «DESARROLLADORWEB»,
 * que viene detrás y también espaciado, no se cuela: al añadirlo el nombre pasa de tres palabras a cuatro y
 * puntúa menos.
 */
function spacedNameCandidate(header: readonly Line[]): { readonly lines: readonly number[]; readonly name: string; readonly score: number } | undefined {
  // Solo la cabecera, la misma ventana que mira `chooseName`: más abajo, un bloque espaciado es un título de
  // sección («I N F O R M A C I Ó N» / «D E C O N T A C T O»), no un nombre, y puntúa igual de bien.
  for (let start = 0; start < Math.min(header.length, 6); start += 1) {
    const run: Line[] = [];
    for (let index = start; index < header.length && isSpacedHeading(header[index]!.text); index += 1) {
      run.push(header[index]!);
    }
    if (run.length < 2) {
      continue;
    }
    const words = run.map((line) => line.text.replace(/\s+/g, ''));
    // Cualquier tramo seguido de dos líneas o más, no solo el que empieza arriba: el nombre puede venir detrás
    // de un rótulo igual de espaciado («C U R R I C U L U M» / «V I T A E»), y entonces el rótulo y el nombre
    // son un solo bloque. Gana la puntuación más alta; a igualdad, el tramo más largo y, si aún empatan, el
    // primero: el nombre está arriba.
    let best: { lines: readonly number[]; name: string; score: number; length: number } | undefined;
    for (let from = 0; from + 1 < run.length; from += 1) {
      for (let to = from + 2; to <= run.length; to += 1) {
        const name = words.slice(from, to).join(' ');
        const score = nameScore(name);
        const length = to - from;
        if (score > 0 && (best === undefined || score > best.score || (score === best.score && length > best.length))) {
          best = { lines: run.slice(from, to).map((line) => line.number), name, score, length };
        }
      }
    }
    if (best !== undefined) {
      return best;
    }
    start += run.length - 1;
  }
  return undefined;
}

function chooseName(header: readonly Line[]): { readonly lines: readonly number[]; readonly name: string; readonly headline: string | undefined } | undefined {
  let best: { lines: readonly number[]; name: string; headline: string | undefined; score: number } | undefined;
  const spaced = spacedNameCandidate(header);
  if (spaced !== undefined) {
    best = { ...spaced, headline: undefined };
  }
  for (const line of header.filter((candidate) => !isContactLine(candidate.text)).slice(0, 6)) {
    const parts = line.text.split(/\s*[|·]\s*/).map((part) => part.trim()).filter((part) => part !== '');
    const candidates: Array<{ name: string; headline: string | undefined }> = [
      ...(parts.length > 1 ? parts.map((part, index) => ({ name: part, headline: parts.filter((_, other) => other !== index).join(' · ') })) : [{ name: line.text, headline: undefined }]),
      splitNameLine(line.text),
    ];
    for (const candidate of candidates) {
      const score = nameScore(candidate.name);
      if (score > 0 && (best === undefined || score > best.score)) {
        const rest = candidate.headline === undefined || candidate.headline.split(/\s+/).every((word) => NAME_STOPWORDS.has(normalize(word).replace(/[^a-z]/g, ''))) ? undefined : candidate.headline;
        best = { lines: [line.number], name: trimSeparators(candidate.name).trim(), headline: rest, score };
      }
    }
  }
  return best === undefined ? undefined : { lines: best.lines, name: best.name, headline: best.headline };
}

/** Del texto plano de un CV a un borrador de perfil con procedencia. */
export function structureCv(text: string): DraftProfile {
  // El PDF de LinkedIn se reconoce por el documento entero y cambia tres reglas: dónde está el nombre, en qué
  // orden vienen empresa y puesto, y que la formación no trae fechas (B-13).
  const slug = linkedInPdfSlug(text);
  const hoisted = slug === undefined ? undefined : hoistLinkedInIdentity(toLines(text), slug);
  const linkedInPdf = hoisted !== undefined;
  const lines = hoisted?.lines ?? toLines(text);
  const sections: Array<{ kind: SectionKind; line: number; title: string; lines: Line[] }> = [];
  const header: Line[] = [];
  let currentSection: { kind: SectionKind; line: number; title: string; lines: Line[] } | undefined;
  const dropped: Line[] = [];
  // Una cabecera espaciada que no está en el diccionario («C A M P U S  I N V O L V M E N T») cierra la sección
  // en curso: sin esto, su contenido se cuela como entradas de la sección anterior.
  let ignoring = false;
  // Un título espaciado puede venir partido en dos líneas («E D U C A C I Ó N» / «P R E V I A»): la segunda es la
  // cola de la primera, no una cabecera desconocida, y tratarla como tal cerraría la sección recién abierta.
  let justOpened = false;
  // Cuando el documento espacia letra a letra CASI TODO —entradas, fechas y hasta el cuerpo—, el espaciado deja
  // de decir nada sobre si algo es una cabecera: es el estilo de la plantilla. La regla de abajo, que cierra la
  // sección ante una cabecera espaciada desconocida, solo tiene sentido cuando espaciar es la EXCEPCIÓN; si no,
  // cada nombre de empresa espaciado cerraría su propia sección y el CV entero acabaría sin situar.
  const spacedLines = lines.filter((line) => isSpacedHeading(line.text)).length;
  const spacingIsStyle = spacedLines >= 6 && spacedLines >= lines.length * 0.08;
  for (const line of lines) {
    const heading = detectHeading(line.text);
    if (heading !== undefined) {
      currentSection = { kind: heading, line: line.number, title: line.text, lines: [] };
      sections.push(currentSection);
      ignoring = false;
      justOpened = true;
      continue;
    }
    if (justOpened && isSpacedHeading(line.text) && currentSection !== undefined) {
      currentSection.title = `${currentSection.title} ${line.text}`;
      justOpened = false;
      continue;
    }
    justOpened = false;
    if (!spacingIsStyle && isSpacedHeading(line.text)) {
      currentSection = undefined;
      ignoring = true;
      dropped.push(line);
      continue;
    }
    if (ignoring) {
      dropped.push(line);
    } else if (currentSection === undefined) {
      header.push(line);
    } else {
      currentSection.lines.push(line);
    }
  }

  const unparsed: Provenance[] = [];
  unparsed.push(...dropped.map((line) => provenance(line)));
  const contact: ContactDraft = { links: [], leftovers: [] };
  let fullName: string | undefined;
  let headline: string | undefined;
  const summaryLines: string[] = [];
  const contactLines: string[] = [];
  // El nombre no es «la primera línea», sino el mejor candidato de la cabecera (T-9.1): así «Chronological» o
  // «EXAMPLE RESUME» dejan de bautizar el borrador y el nombre real —a veces en la segunda línea, o junto a un
  // separador— se reconoce. Si ninguno convence, no se inventa: el borrador queda con «Nombre pendiente».
  const chosen = chooseName(header);
  for (const line of header) {
    if (chosen !== undefined && chosen.lines.includes(line.number)) {
      fullName = chosen.name;
      // Asignación, no «??»: el titular que venga con el nombre manda sobre cualquier línea anterior (T-9.1).
      headline = chosen.headline;
      continue;
    }
    if (fullName === undefined && chosen === undefined && !isContactLine(line.text)) {
      // Sin candidato claro, las líneas de cabecera siguen su curso (titular o resumen), sin nombre inventado.
      if (headline === undefined && line.text.length <= 120 && !/[.]$/.test(line.text)) {
        headline = line.text;
      } else {
        summaryLines.push(line.text);
      }
      continue;
    }
    if (isContactLine(line.text)) {
      contactLines.push(line.text);
      continue;
    }
    if (headline === undefined && line.text.length <= 120 && !/[.]$/.test(line.text)) {
      headline = line.text;
      continue;
    }
    summaryLines.push(line.text);
  }
  const collect = (kind: SectionKind): Line[] => sections.filter((section) => section.kind === kind).flatMap((section) => section.lines);
  // Las líneas de contacto se unen antes de trocearlas: un teléfono puede venir partido en dos líneas.
  parseContact([...contactLines, ...collect('contact').map((line) => line.text)].join(' '), contact);
  contact.location ??= hoisted?.location;
  unparsed.push(...contact.leftovers.map((leftover) => ({ line: 0, text: leftover })));
  const summary = [...summaryLines, ...collect('summary').map((line) => line.text)].map((line) => line.replace(/^(?:summary|resumen|perfil|profile)\.\s*/i, ''));

  return {
    fullName,
    headline,
    email: contact.email,
    phone: contact.phone,
    location: contact.location,
    links: contact.links,
    summary: summary.length === 0 ? undefined : summary.join(' '),
    experience: linkedInPdf ? parseLinkedInExperience(collect('experience'), unparsed) : parseEntries(collect('experience'), 'experience', unparsed),
    projects: parseEntries(collect('projects'), 'projects', unparsed),
    education: linkedInPdf ? parseLinkedInEducation(collect('education'), unparsed) : parseEntries(collect('education'), 'education', unparsed),
    certifications: parseCertifications(collect('certifications')),
    skills: parseSkills(collect('skills')),
    achievements: parseAchievements(collect('achievements'), unparsed),
    languages: parseLanguages(collect('languages'), unparsed),
    sections: sections.map((section) => ({ kind: section.kind, line: section.line, title: section.title })),
    unparsed,
  };
}
