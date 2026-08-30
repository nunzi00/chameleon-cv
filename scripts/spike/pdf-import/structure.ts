/**
 * P1 · Estructurador heurístico (T-8.4, docs/pdf-import-spike.md §4.2): del texto plano de un CV a un borrador de
 * perfil con procedencia por campo. Determinista, sin modelo: títulos de sección (diccionario es/en), rangos de
 * fechas, viñetas como logros, línea «rol · empresa · lugar», contacto por expresiones regulares. Lo que no
 * entiende lo deja en `unparsed`: nunca inventa.
 *
 * Patrones de maquetación que reconoce (medidos en el corpus): título y fecha en la misma línea; fecha en la línea
 * siguiente (con o sin lugar); fecha en la línea anterior (pastillas); título en dos líneas (tablas, columnas);
 * entradas en una sola línea sin viñetas con los logros separados por «;»; viñetas partidas; etiquetas de
 * habilidades con dos puntos, en su propia línea, seguidas de viñetas o pegadas a los nombres; certificaciones con
 * «(emisor), fecha» en la línea siguiente; nombre y titular pegados o separados por raya.
 */
import { findDateRange, findSingleDate } from './dates';
import { SKILL_CATEGORY_LABELS, detectHeading, skillCategory, type SectionKind } from './headings';
import { normalize } from './text';

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
const BULLET = /^(?:[•▸◦‣▪■●○☑☐✓✔\-–—*]|\d+[.)])\s+/;
const CONTACT_GLYPHS = /[✉☎☏⌂]/g;
const SEPARATORS = / · | — | – | \| | • /;
const FOOTER = /(?:·|—|-)\s*(?:\d+\s*\/\s*\d+|p[aá]gina\s+\d+\s+de\s+\d+|page\s+\d+\s+of\s+\d+)\s*$/i;
const TECHNOLOGIES = /^(?:tecnolog[ií]as|technologies|tech|stack)\s*:\s*(.+?)\.?$/i;
const INLINE_TECHNOLOGIES = /\s*(?:tecnolog[ií]as|technologies|stack)\s*:\s*([^;]+?)\.?\s*$/i;
const LINK_LABELS = new Set(['github', 'linkedin', 'web', 'website', 'portfolio', 'twitter', 'x', 'gitlab', 'blog', 'enlace', 'link']);
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
function splitImpact(text: string): { readonly text: string; readonly impact: string | undefined } {
  const match = /^(.*\S)\s+\(([^()]{3,})\)\.?$/.exec(text);
  return match === null ? { text, impact: undefined } : { text: match[1]!, impact: match[2]! };
}

/** Una línea continúa la viñeta anterior si esta no cerró la frase o si la línea empieza en minúscula o con un paréntesis. */
function isContinuation(previous: string, text: string): boolean {
  return !/[.!?)]$/.test(previous) || /^[a-záéíóúñ(]/.test(text);
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
function parseTitle(text: string): { readonly title: string; readonly subtitle: string | undefined; readonly location: string | undefined } {
  let rest = trimSeparators(text);
  let location: string | undefined;
  const parenthesized = /^(.*?\S)\s*\((.+)\)$/.exec(rest);
  if (parenthesized !== null) {
    rest = parenthesized[1]!;
    location = parenthesized[2]!;
  }
  const parts = SEPARATORS.test(rest) ? splitParts(rest) : rest.split(/\s*,\s*/).map(trimSeparators).filter((part) => part !== '');
  return { title: parts[0] ?? rest, subtitle: parts[1], location: location ?? parts[2] };
}

function parseDegree(text: string): { readonly degree: string; readonly field: string | undefined } {
  const match = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(text);
  return match === null ? { degree: text, field: undefined } : { degree: match[1]!, field: match[2]! };
}

type EntryKind = 'experience' | 'projects' | 'education';

interface OpenEntry {
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
function parseEntries(lines: readonly Line[], kind: EntryKind, unparsed: Provenance[]): DraftEntry[] {
  const entries: DraftEntry[] = [];
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
      summary: current.summary.length === 0 ? undefined : current.summary.join(' '),
      technologies: current.technologies,
      achievements: current.achievements,
      provenance: current.provenance,
    });
    current = undefined;
  };
  /** El título viene en una o dos líneas anteriores: «Rol · Empresa» + «de València» (continuación) o «Título» + «Centro» (tabla). */
  const titleFromPending = (entry: OpenEntry): void => {
    const [first, second] = pending.splice(0);
    if (first === undefined) {
      entry.needsTitle = true;
      return;
    }
    const parsed = parseTitle(first.text);
    entry.title = parsed.title;
    entry.subtitle = parsed.subtitle;
    entry.location ??= parsed.location;
    entry.provenance = provenance(first);
    if (second !== undefined) {
      const continuation = trimSeparators(second.text);
      if (parsed.subtitle !== undefined && startsLowercase(continuation)) {
        entry.subtitle = `${parsed.subtitle} ${continuation}`;
      } else if (parsed.subtitle === undefined) {
        entry.subtitle = continuation;
      } else {
        unparsed.push(provenance(second));
      }
    }
  };
  const open = (line: Line, range: NonNullable<ReturnType<typeof findDateRange>>): void => {
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
    const inlineBody = after.length >= INLINE_BODY_MIN ? after : undefined;
    const titleText = inlineBody === undefined ? trimSeparators(`${before} ${after}`) : before;
    // «mar 2022 – actualidad · Valencia (remoto)» debajo del título: lo que queda junto a la fecha es el lugar, no un título.
    const restIsLocation = pending.length > 0 && titleText !== '' && !SEPARATORS.test(titleText) && looksLikeLocation(titleText);
    if (titleText === '' || restIsLocation) {
      entry.location = titleText === '' ? undefined : titleText;
      titleFromPending(entry);
    } else {
      dropPending();
      const parsed = parseTitle(titleText);
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
    current = entry;
  };
  const dateAt = lines.map((line) => findDateRange(line.text) !== undefined);
  const titleLike = (line: Line): boolean => line.text.length <= 90 && !/[.!?]$/.test(line.text) && !isBullet(line.text) && !TECHNOLOGIES.test(line.text);
  for (const [index, line] of lines.entries()) {
    const range = findDateRange(line.text);
    if (range !== undefined) {
      open(line, range);
      continue;
    }
    if (current === undefined) {
      keepPending(line);
      continue;
    }
    // La fecha de la entrada siguiente viene una o dos líneas más abajo: esta línea corta es su título, no cuerpo de la actual.
    const next = lines[index + 1];
    const startsNextEntry = !current.needsTitle && titleLike(line) && (dateAt[index + 1] === true || (dateAt[index + 2] === true && next !== undefined && titleLike(next)));
    if (startsNextEntry) {
      flush();
      keepPending(line);
      continue;
    }
    if (current.needsTitle) {
      const parsed = parseTitle(line.text);
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
      if (current.subtitle !== undefined && current.summary.length === 0 && startsLowercase(line.text) && line.text.length <= 40) {
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

function splitNames(text: string): string[] {
  return text.split(/\s*[,;·]\s*/).map((name) => stripBullet(name.trim())).filter((name) => name !== '');
}

/** «Lenguajes PHP, Python» (etiqueta sin dos puntos, como en un margen): la etiqueta conocida al principio. */
function splitLabelledLine(text: string): { readonly label: string; readonly names: string } | undefined {
  const key = normalize(text);
  for (const [label] of SKILL_CATEGORY_LABELS) {
    if (key.startsWith(`${label} `) && key.length > label.length + 1) {
      return { label, names: text.slice(label.length).trim() };
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
    const parts = splitParts(stripBullet(line.text).replace(/[;,]\s*/g, ' · ').replace(/:\s*/g, ' · ').replace(/\s*\(([^()]+)\)/g, ' · $1'));
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

/** Del texto plano de un CV a un borrador de perfil con procedencia. */
export function structureCv(text: string): DraftProfile {
  const lines = toLines(text);
  const sections: Array<{ kind: SectionKind; line: number; title: string; lines: Line[] }> = [];
  const header: Line[] = [];
  let currentSection: { kind: SectionKind; line: number; title: string; lines: Line[] } | undefined;
  for (const line of lines) {
    const heading = detectHeading(line.text);
    if (heading !== undefined) {
      currentSection = { kind: heading, line: line.number, title: line.text, lines: [] };
      sections.push(currentSection);
      continue;
    }
    if (currentSection === undefined) {
      header.push(line);
    } else {
      currentSection.lines.push(line);
    }
  }

  const unparsed: Provenance[] = [];
  const contact: ContactDraft = { links: [], leftovers: [] };
  let fullName: string | undefined;
  let headline: string | undefined;
  const summaryLines: string[] = [];
  const contactLines: string[] = [];
  for (const line of header) {
    if (fullName === undefined && !isContactLine(line.text)) {
      const split = splitNameLine(line.text);
      fullName = split.name;
      headline = split.headline;
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
    experience: parseEntries(collect('experience'), 'experience', unparsed),
    projects: parseEntries(collect('projects'), 'projects', unparsed),
    education: parseEntries(collect('education'), 'education', unparsed),
    certifications: parseCertifications(collect('certifications')),
    skills: parseSkills(collect('skills')),
    achievements: parseAchievements(collect('achievements'), unparsed),
    languages: parseLanguages(collect('languages'), unparsed),
    sections: sections.map((section) => ({ kind: section.kind, line: section.line, title: section.title })),
    unparsed,
  };
}
