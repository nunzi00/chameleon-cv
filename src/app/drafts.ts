/**
 * Los borradores de `import/` para quien los revisa (T-9.19, `docs/cv-import.md` §10): listarlos con lo que
 * reconoció cada uno, agrupar las entradas que parecen la MISMA cosa —entre borradores y contra las fuentes de
 * hoy— y adoptar las que una persona señale, una a una, como ficheros NUEVOS de `data/sources/`.
 *
 * Adoptar no es fusionar (`docs/portability.md` §1 sigue en pie): no se mezclan dos versiones de un empleo ni
 * se elige por ti cuál vale. Se copia la entrada que señalas —con su id y su nombre de fichero libres— y solo
 * si el perfil resultante sigue validando; lo que ya había no se toca nunca, porque cada fichero se escribe
 * con la huella «*», que crea o falla (C9). Agrupar tampoco decide nada: los duplicados se enseñan, no se
 * resuelven, que es lo único honesto cuando seis CV se contradicen en las fechas del mismo empleo.
 */
import { resolve } from 'node:path';

import { normalize } from '../import/text';
import { unplacedFromReport } from '../import/draft';
import { entityFileName, serializeEducation, serializeExperience, serializeProject, type EntityNaming, type EntitySection } from '../parsers';
import { validateMasterProfile, type Education, type Experience, type MasterProfile, type Project } from '../core/schema';
import type { AppContext } from './context';
import { loadSources } from './dataset';
import { dataError, notFoundError, type AppError } from './errors';
import { slugify } from './slug';
import { listSources, readSource, writeSource, type SourceListResult, type SourceReadResult, type SourceWriteResult } from './sources';

/** Carpeta de los borradores dentro del espacio de trabajo; `cv import-cv` nunca escribe fuera de ella. */
export const DRAFTS_DIR = 'import';

/**
 * Las secciones que se pueden adoptar entrada a entrada. Son exactamente aquellas en las que **un fichero es
 * una entrada**: adoptar es añadir un fichero. `skills.csv`, `certifications.csv` y `achievements.md` juntan
 * muchas entradas en un solo fichero, así que adoptarlas exigiría reescribir un fichero que ya es tuyo, y eso
 * es otra tarea con otras garantías.
 */
export const ADOPTABLE_SECTIONS = ['experience', 'education', 'projects'] as const;
export type AdoptableSection = (typeof ADOPTABLE_SECTIONS)[number];

const SECTION_LABEL: Readonly<Record<AdoptableSection, string>> = { experience: 'experiencia', education: 'formación', projects: 'proyecto' };

/** Una entrada de un borrador, con lo justo para reconocerla en una lista y decidir. */
export interface DraftEntry {
  readonly section: AdoptableSection;
  readonly id: string;
  /** Cómo se lee («Desarrollador · Concello de Lugo»). */
  readonly title: string;
  /** El periodo tal cual está en la fuente; ausente si la entrada no lo trae. */
  readonly start?: string | undefined;
  readonly end?: string | undefined;
  /** Fichero de la entrada dentro del borrador, para abrirlo y editarlo. */
  readonly path: string;
}

/** Lo que un borrador dice de sí mismo en su `README.md`. */
export interface DraftReport {
  readonly origin?: string | undefined;
  readonly importedAt?: string | undefined;
  /** Avisos y degradaciones del informe. */
  readonly issues: number;
  readonly unparsed: number;
}

export interface DraftSummary {
  /** Carpeta dentro de `import/`. */
  readonly name: string;
  readonly counts: Readonly<Record<AdoptableSection, number>> & { readonly skills: number; readonly certifications: number };
  readonly entries: readonly DraftEntry[];
  readonly report: DraftReport;
  /** Ficheros del borrador (los que el cargador reconoce), para la vista de edición. */
  readonly files: number;
  /** Por qué no se pudo leer; con él, el resto viene a cero y el borrador solo se puede editar a mano. */
  readonly problem?: string | undefined;
}

export type DraftListResult = { readonly ok: true; readonly drafts: readonly DraftSummary[] } | { readonly ok: false; readonly error: AppError };

/* ───────────────────────────── leer los borradores ───────────────────────────── */

/** El periodo de una entrada, si lo tiene: experiencia siempre; formación y proyecto, opcional. */
function datesOf(item: Experience | Education | Project): { readonly start?: string | undefined; readonly end?: string | undefined } {
  const range = item.dates;
  return range === undefined ? {} : { start: range.start, end: range.end };
}

function titleOf(section: AdoptableSection, item: Experience | Education | Project): string {
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
export function entriesOf(profile: MasterProfile): readonly DraftEntry[] {
  return ADOPTABLE_SECTIONS.flatMap((section) =>
    profile[section].map((item) => ({
      section,
      id: item.id,
      title: titleOf(section, item),
      ...datesOf(item),
      path: `${section}/${entityFileName(section as EntitySection, item.id).fileName}.md`,
    })),
  );
}

const ORIGIN_LINE = /^- Origen: (.+)$/m;
const IMPORTED_LINE = /^- Importado: (.+)$/m;
const ISSUES_HEADING = '## Degradado o avisado';

/** Lo que el informe cuenta de sí mismo; un borrador sin `README.md` no es un error, solo no dice nada. */
export function readReport(report: string): DraftReport {
  const start = report.split('\n').indexOf(ISSUES_HEADING);
  let issues = 0;
  if (start !== -1) {
    for (const line of report.split('\n').slice(start + 1)) {
      if (line.startsWith('## ')) {
        break;
      }
      if (line.startsWith('- ')) {
        issues += 1;
      }
    }
  }
  return {
    origin: ORIGIN_LINE.exec(report)?.[1],
    importedAt: IMPORTED_LINE.exec(report)?.[1],
    issues,
    unparsed: unplacedFromReport(report).length,
  };
}

/**
 * El nombre de un borrador es siempre un slug, porque lo escribe `slugify` al importar. Comprobarlo aquí —y no
 * solo en la ruta HTTP— es lo que impide que un nombre manipulado salga de `import/`, venga de donde venga.
 */
export function isDraftName(name: string): boolean {
  return name !== '' && slugify(name) === name;
}

/** La raíz de un borrador, o `undefined` si el nombre no es un nombre de borrador. */
function draftRoot(context: AppContext, name: string): string | undefined {
  return isDraftName(name) ? resolve(context.cwd, DRAFTS_DIR, name) : undefined;
}

function badName(name: string): AppError {
  return dataError(`«${name}» no es un nombre de borrador válido: son los de import/, en minúsculas y con guiones`);
}

/** Los ficheros de un borrador que el cargador reconoce, con su tamaño y su huella (para editarlos). */
export async function listDraftFiles(context: AppContext, name: string): Promise<SourceListResult> {
  const root = draftRoot(context, name);
  return root === undefined ? { ok: false, error: badName(name), issues: [] } : listSources(context, root);
}

/** Un fichero del borrador, con su huella para el `If-Match` de la escritura. */
export async function readDraftFile(context: AppContext, name: string, path: string): Promise<SourceReadResult> {
  const root = draftRoot(context, name);
  return root === undefined ? { ok: false, error: badName(name) } : readSource(context, root, path);
}

/**
 * Escribe un fichero del borrador. Misma vía y mismas garantías que editar una fuente (`writeSource`): atómica,
 * 0600 y solo si el contenido es exactamente el que el cliente vio. Un borrador se edita como se edita una
 * fuente, porque para quien revisa es lo mismo: texto suyo que corregir antes de adoptarlo.
 */
export async function writeDraftFile(context: AppContext, name: string, path: string, content: string, expectedSha256: string): Promise<SourceWriteResult> {
  const root = draftRoot(context, name);
  return root === undefined ? { ok: false, error: badName(name) } : writeSource(context, root, { path, content, expectedSha256 });
}

/** Una copia de seguridad de `--replace` no es un borrador: se lista aparte de la vista, no como uno más. */
export function isBackupName(name: string): boolean {
  return /\.\d{8}-\d{6}\.bak(?:\.\d+)?$/.test(name);
}

/**
 * Todos los borradores de `import/`, cada uno con lo que reconoció. Un borrador que no carga NO tumba la
 * lista: se devuelve con su motivo, porque justo ese es el que hay que ir a editar.
 */
export async function listDrafts(context: AppContext): Promise<DraftListResult> {
  const root = resolve(context.cwd, DRAFTS_DIR);
  let names: readonly string[];
  try {
    const entries = await context.datasetFileSystem.readDirectory(root);
    names = entries
      .filter((entry) => entry.kind === 'directory' && !isBackupName(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, 'es'));
  } catch {
    // Sin carpeta `import/` no hay error que dar: es que todavía no se ha importado nada.
    return { ok: true, drafts: [] };
  }
  const drafts = await Promise.all(names.map((name) => readDraft(context, name)));
  return { ok: true, drafts };
}

/** Un borrador por su nombre; el mismo resumen que da la lista. */
export async function readDraft(context: AppContext, name: string): Promise<DraftSummary> {
  if (!isDraftName(name)) {
    return { name, counts: { experience: 0, education: 0, projects: 0, skills: 0, certifications: 0 }, entries: [], report: { issues: 0, unparsed: 0 }, files: 0, problem: badName(name).message };
  }
  const data = `${DRAFTS_DIR}/${name}`;
  const report = await readSource(context, resolve(context.cwd, data), 'README.md');
  const summary = report.ok ? readReport(report.file.content) : { issues: 0, unparsed: 0 };
  const loaded = await loadSources(context, { data });
  if (!loaded.ok) {
    return {
      name,
      counts: { experience: 0, education: 0, projects: 0, skills: 0, certifications: 0 },
      entries: [],
      report: summary,
      files: 0,
      problem: loaded.error.message,
    };
  }
  const { profile, files } = loaded.dataset;
  return {
    name,
    counts: {
      experience: profile.experience.length,
      education: profile.education.length,
      projects: profile.projects.length,
      skills: profile.skills.length,
      certifications: profile.certifications.length,
    },
    entries: entriesOf(profile),
    report: summary,
    files: files.length,
  };
}

/* ───────────────────────────── duplicados ───────────────────────────── */

/**
 * Palabras que no distinguen nada: preposiciones, artículos y las formas societarias, que en un corpus de
 * una sola persona aparecen en la mitad de las empresas.
 */
const STOPWORDS: ReadonlySet<string> = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'en', 'y', 'con', 'por', 'para', 'the', 'of', 'and', 'in', 'at', 'sl', 'slu', 'sa', 'srl', 'sau']);

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

export function signatureOf(...parts: ReadonlyArray<string | undefined>): EntrySignature {
  const text = parts.filter((part): part is string => part !== undefined).join(' ');
  const words = normalize(PLACEHOLDERS.reduce((rest, placeholder) => rest.replaceAll(placeholder, ' '), text))
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '');
  const single = words.filter((word) => word.length === 1).length;
  return {
    tokens: [...new Set(words.filter((word) => word.length >= MIN_TOKEN && !STOPWORDS.has(word)))],
    glued: words.join(''),
    // Más de la mitad de las «palabras» de una sola letra: el PDF espació el texto y no hay palabras que valgan.
    spaced: words.length >= 6 && single * 2 > words.length,
  };
}

/** El periodo en meses; sin `end`, abierto. Una fecha «2011» abarca el año entero. */
function span(entry: DraftEntry): readonly [number, number] | undefined {
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
export function periodsOverlap(a: DraftEntry, b: DraftEntry): boolean {
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

/** Una entrada dentro de un grupo de duplicados: de qué borrador viene, o de las fuentes de hoy. */
export interface DuplicateMember {
  /** Nombre del borrador; `undefined` = ya está en `data/sources/`. */
  readonly draft?: string | undefined;
  readonly entry: DraftEntry;
}

export interface DuplicateGroup {
  readonly section: AdoptableSection;
  readonly members: readonly DuplicateMember[];
  /** Ya hay una entrada igual en las fuentes: adoptar otra la duplicaría de verdad. */
  readonly inSources: boolean;
}

/** La huella de una entrada a partir de su título (que ya junta empresa y puesto, o centro y titulación). */
function signatureOfEntry(entry: DraftEntry): EntrySignature {
  return signatureOf(entry.title);
}

/**
 * Las entradas que parecen la misma cosa, agrupadas. Se comparan solo dentro de la misma sección y solo si los
 * periodos coinciden de verdad: dos cursos de «Monitor Informática» de 2007 y de 2009 son dos cursos.
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
    .map((member, index) => ({ member, index, signature: signatureOfEntry(member.entry) }))
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
      if (periodsOverlap(seed.member.entry, candidate.member.entry) && similarity(seed.signature, candidate.signature) >= SIMILARITY_THRESHOLD) {
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

/** Los duplicados de todos los borradores entre sí y contra las fuentes de `data`. */
export async function draftDuplicates(context: AppContext, options: { readonly data: string }): Promise<{ readonly ok: true; readonly result: DuplicatesResult } | { readonly ok: false; readonly error: AppError }> {
  const listed = await listDrafts(context);
  if (!listed.ok) {
    return listed;
  }
  const members: DuplicateMember[] = [];
  const sources = await loadSources(context, { data: options.data });
  if (sources.ok) {
    for (const entry of entriesOf(sources.dataset.profile)) {
      members.push({ entry });
    }
  }
  for (const draft of listed.drafts) {
    for (const entry of draft.entries) {
      members.push({ draft: draft.name, entry });
    }
  }
  return { ok: true, result: { groups: groupDuplicates(members), compared: members.length } };
}

/* ───────────────────────────── adoptar ───────────────────────────── */

export interface AdoptSelection {
  /** Carpeta del borrador dentro de `import/`. */
  readonly draft: string;
  readonly section: AdoptableSection;
  readonly id: string;
}

export interface AdoptRequest {
  readonly data: string;
  readonly entries: readonly AdoptSelection[];
  /** Enseña lo que se escribiría sin escribir nada. */
  readonly dryRun?: boolean | undefined;
}

export interface AdoptedEntry {
  readonly draft: string;
  readonly section: AdoptableSection;
  /** El id con el que entra en las fuentes: el del borrador, o el primero libre si aquel ya estaba. */
  readonly id: string;
  readonly title: string;
  readonly path: string;
}

export interface AdoptOutcome {
  readonly root: string;
  readonly adopted: readonly AdoptedEntry[];
  /** Lo que se pidió y no entró, con el motivo; nunca se escribe a medias. */
  readonly skipped: ReadonlyArray<{ readonly draft: string; readonly section: AdoptableSection; readonly id: string; readonly reason: string }>;
  readonly dryRun: boolean;
}

export type AdoptResult = { readonly ok: true; readonly outcome: AdoptOutcome } | { readonly ok: false; readonly error: AppError };

/** El primer id libre a partir del que trae la entrada (`exp-acme`, `exp-acme-2`…). */
function freeId(id: string, used: Set<string>): string {
  let candidate = id;
  for (let suffix = 2; used.has(candidate); suffix += 1) {
    candidate = `${id}-${suffix}`;
  }
  used.add(candidate);
  return candidate;
}

/** El primer nombre de fichero libre de la sección, mirando lo que hay en disco y lo que se va a escribir. */
function freeName(section: AdoptableSection, id: string, taken: Set<string>): EntityNaming {
  const preferred = entityFileName(section, id);
  let chosen = preferred;
  for (let suffix = 2; taken.has(`${section}/${chosen.fileName}.md`); suffix += 1) {
    chosen = { fileName: `${preferred.fileName}-${suffix}`, explicitId: true };
  }
  taken.add(`${section}/${chosen.fileName}.md`);
  return chosen;
}

function serializeEntry(section: AdoptableSection, item: Experience | Education | Project, naming: EntityNaming): string {
  if (section === 'experience') {
    return serializeExperience(item as Experience, naming).content;
  }
  if (section === 'education') {
    return serializeEducation(item as Education, naming).content;
  }
  return serializeProject(item as Project, naming).content;
}

/**
 * Adopta las entradas señaladas: las escribe como ficheros NUEVOS de `data/sources/`, con el id y el nombre
 * de fichero libres. Antes de tocar el disco se valida el perfil resultante entero —añadir una entrada rota
 * dejaría unas fuentes que `cv build` rechaza, y eso es peor que no adoptar— y se comprueba que todo lo pedido
 * existe. Si algo falla, no se escribe nada: no hay adopción a medias.
 */
export async function adoptEntries(context: AppContext, request: AdoptRequest): Promise<AdoptResult> {
  if (request.entries.length === 0) {
    return { ok: false, error: dataError('No se ha señalado ninguna entrada que adoptar') };
  }
  const sources = await loadSources(context, { data: request.data });
  if (!sources.ok) {
    return { ok: false, error: dataError(`Las fuentes de «${request.data}» no cargan, así que no se puede añadir nada: arréglalas primero`, sources.error.lines) };
  }
  const root = sources.dataset.root;

  // Un borrador se lee una sola vez aunque se adopten diez entradas suyas.
  const loaded = new Map<string, MasterProfile>();
  const skipped: Array<{ draft: string; section: AdoptableSection; id: string; reason: string }> = [];
  for (const name of new Set(request.entries.map((entry) => entry.draft))) {
    if (!isDraftName(name)) {
      continue;
    }
    const draft = await loadSources(context, { data: `${DRAFTS_DIR}/${name}` });
    if (draft.ok) {
      loaded.set(name, draft.dataset.profile);
    }
  }

  const used = new Set<string>(
    [sources.dataset.profile.experience, sources.dataset.profile.projects, sources.dataset.profile.education, sources.dataset.profile.certifications, sources.dataset.profile.skills, sources.dataset.profile.achievements, sources.dataset.profile.specialties].flatMap((group) =>
      group.map((item) => item.id),
    ),
  );
  const listed = await listSources(context, root);
  const taken = new Set<string>(listed.ok ? listed.entries.map((entry) => entry.path) : []);

  const additions: Partial<Record<AdoptableSection, Array<Experience | Education | Project>>> = {};
  const planned: Array<{ readonly entry: AdoptedEntry; readonly content: string }> = [];
  for (const selection of request.entries) {
    const profile = loaded.get(selection.draft);
    if (profile === undefined) {
      skipped.push({ ...selection, reason: `el borrador «${selection.draft}» no se pudo leer` });
      continue;
    }
    const item = (profile[selection.section] as ReadonlyArray<Experience | Education | Project>).find((candidate) => candidate.id === selection.id);
    if (item === undefined) {
      skipped.push({ ...selection, reason: `«${selection.id}» no es una ${SECTION_LABEL[selection.section]} de «${selection.draft}»` });
      continue;
    }
    const id = freeId(selection.id, used);
    const naming = freeName(selection.section, id, taken);
    const adopted = { ...item, id };
    (additions[selection.section] ??= []).push(adopted);
    planned.push({
      entry: { draft: selection.draft, section: selection.section, id, title: titleOf(selection.section, adopted), path: `${selection.section}/${naming.fileName}.md` },
      content: serializeEntry(selection.section, adopted, naming),
    });
  }

  if (planned.length === 0) {
    return { ok: false, error: { ...notFoundError('Ninguna de las entradas señaladas se pudo adoptar'), lines: skipped.map((entry) => `${entry.draft}/${entry.section}/${entry.id}: ${entry.reason}`) } };
  }

  // La puerta de calidad ANTES del disco: el perfil que quedará tiene que validar entero.
  const merged: MasterProfile = {
    ...sources.dataset.profile,
    experience: [...sources.dataset.profile.experience, ...((additions.experience ?? []) as Experience[])],
    education: [...sources.dataset.profile.education, ...((additions.education ?? []) as Education[])],
    projects: [...sources.dataset.profile.projects, ...((additions.projects ?? []) as Project[])],
  };
  const validation = validateMasterProfile(merged);
  if (!validation.ok) {
    return {
      ok: false,
      error: dataError(
        'Con esas entradas el perfil no valida, así que no se ha escrito nada',
        validation.issues.map((issue) => `${issue.path}: ${issue.message}`),
      ),
    };
  }

  if (request.dryRun === true) {
    return { ok: true, outcome: { root, adopted: planned.map((file) => file.entry), skipped, dryRun: true } };
  }

  const adopted: AdoptedEntry[] = [];
  for (const file of planned) {
    // «*» crea el fichero o falla: una entrada adoptada NUNCA pisa una fuente que ya era tuya.
    const written = await writeSource(context, root, { path: file.entry.path, content: file.content, expectedSha256: '*' });
    if (!written.ok) {
      return { ok: false, error: { ...written.error, message: `Adopción interrumpida en «${file.entry.path}»: ${written.error.message}`, lines: adopted.map((entry) => `adoptado: ${entry.path}`) } };
    }
    adopted.push(file.entry);
  }
  return { ok: true, outcome: { root, adopted, skipped, dryRun: false } };
}
