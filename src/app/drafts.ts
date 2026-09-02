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

import { unplacedFromReport } from '../import/draft';
import { entityFileName, serializeEducation, serializeExperience, serializeProject, type EntityNaming } from '../parsers';
import { validateMasterProfile, type Education, type Experience, type MasterProfile, type Project } from '../core/schema';
import { SECTION_LABEL, entriesOf, groupDuplicates, titleOf, type AdoptableSection, type DuplicateMember, type DuplicatesResult, type ProfileEntry } from './duplicates';
import type { AppContext } from './context';
import { loadSources } from './dataset';
import { dataError, notFoundError, type AppError } from './errors';
import { slugify } from './slug';
import { listSources, readSource, writeSource, type SourceListResult, type SourceReadResult, type SourceWriteResult } from './sources';

/** Carpeta de los borradores dentro del espacio de trabajo; `cv import-cv` nunca escribe fuera de ella. */
export const DRAFTS_DIR = 'import';

// El modelo de entrada y el agrupado viven en `duplicates.ts`: no son de los borradores, y la misma regla
// compara también las fuentes contra sí mismas. Se reexportan para quien ya los pedía por aquí.
export { ADOPTABLE_SECTIONS, entriesOf, groupDuplicates, periodsOverlap, signatureOf, similarity, type AdoptableSection, type DuplicateGroup, type DuplicateMember, type DuplicatesResult, type ProfileEntry } from './duplicates';

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
  readonly entries: readonly ProfileEntry[];
  readonly report: DraftReport;
  /** Ficheros del borrador (los que el cargador reconoce), para la vista de edición. */
  readonly files: number;
  /** Por qué no se pudo leer; con él, el resto viene a cero y el borrador solo se puede editar a mano. */
  readonly problem?: string | undefined;
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
export async function listDrafts(context: AppContext): Promise<readonly DraftSummary[]> {
  const root = resolve(context.cwd, DRAFTS_DIR);
  let names: readonly string[];
  try {
    const entries = await context.datasetFileSystem.readDirectory(root);
    names = entries
      .filter((entry) => entry.kind === 'directory' && !isBackupName(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, 'es'));
  } catch {
    // Sin carpeta `import/` no hay error que dar: es que todavía no se ha importado nada. Por eso esto NO
    // devuelve un resultado con error: no hay ninguno posible, y fingirlo obligaría a comprobar lo imposible.
    return [];
  }
  return Promise.all(names.map((name) => readDraft(context, name)));
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

/** Los duplicados de todos los borradores entre sí y contra las fuentes de `data`. */
export async function draftDuplicates(context: AppContext, options: { readonly data: string }): Promise<DuplicatesResult> {
  const drafts = await listDrafts(context);
  const members: DuplicateMember[] = [];
  const sources = await loadSources(context, { data: options.data });
  if (sources.ok) {
    for (const entry of entriesOf(sources.dataset.profile)) {
      members.push({ entry });
    }
  }
  for (const draft of drafts) {
    for (const entry of draft.entries) {
      members.push({ draft: draft.name, entry });
    }
  }
  return { groups: groupDuplicates(members), compared: members.length };
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
  // Los ficheros que YA hay: los da el propio cargador, que acaba de leerlos con éxito. Volver a listarlos sería
  // preguntar dos veces y obligar a contemplar un fallo que aquí ya no puede darse.
  const taken = new Set<string>(sources.dataset.files);

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
