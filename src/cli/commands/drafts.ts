/**
 * `cv drafts` (T-9.19, `docs/cv-import.md` §10): la puerta de la CLI a los borradores de `import/` —listarlos,
 * ver sus entradas con el id que hay que señalar, comparar los duplicados entre borradores y contra las fuentes,
 * y adoptar en `data/sources/` las entradas que se elijan—. Todo el criterio vive en `src/app/drafts.ts`, que es
 * lo que también usa la web (C14); aquí queda lo que es de la terminal: las tablas y los códigos de salida.
 */
import { ADOPTABLE_SECTIONS, adoptEntries, draftDuplicates, listDrafts, readDraft, replaceSourcesWithDraft, type AdoptableSection, type DraftSummary, type DuplicateGroup } from '../../app/drafts';
import type { CliContext } from '../context';
import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK, formatTable, pluralize, reportError } from '../output';
import { formatImportOutcome } from './portability';

export interface DraftsListOptions {
  readonly data: string;
}

export interface DraftsAdoptOptions {
  readonly data: string;
  /** Ids de las entradas del borrador; sin ellos hace falta --section. */
  readonly entry?: readonly string[] | undefined;
  /** Adopta TODAS las entradas de esa sección del borrador. */
  readonly section?: string | undefined;
  readonly dryRun?: boolean | undefined;
}

const SECTION_LABEL: Readonly<Record<AdoptableSection, string>> = { experience: 'experiencia', education: 'formación', projects: 'proyecto' };

/** El periodo en una celda: «2016-09 → 2017-05», «2022-04 → …» o «—» cuando la entrada no trae fechas. */
function period(start: string | undefined, end: string | undefined): string {
  return start === undefined ? '—' : `${start} → ${end ?? '…'}`;
}

/* ───────────────────────────── list ───────────────────────────── */

function listRow(draft: DraftSummary): readonly string[] {
  return [
    draft.name,
    draft.report.origin ?? '—',
    ...(draft.problem === undefined
      ? [String(draft.counts.experience), String(draft.counts.education), String(draft.counts.projects), String(draft.report.issues), String(draft.report.unparsed)]
      : ['!', '!', '!', '!', '!']),
  ];
}

export async function runDraftsList(context: CliContext): Promise<number> {
  const drafts = await listDrafts(context);
  if (drafts.length === 0) {
    context.stderr('No hay borradores en import/: impórtalos con «cv import-cv <fichero>» o «cv import-cv <carpeta> --all»\n');
    return EXIT_OK;
  }
  context.stdout(formatTable(['Borrador', 'Origen', 'Exp.', 'Form.', 'Proy.', 'Avisos', 'Sin situar'], drafts.map(listRow), 2));
  for (const draft of drafts) {
    if (draft.problem !== undefined) {
      context.stderr(`import/${draft.name} no carga: ${draft.problem}\n`);
    }
  }
  context.stderr(`${pluralize(drafts.length, 'borrador', 'borradores')}; mira uno con «cv drafts show <nombre>»\n`);
  return EXIT_OK;
}

/* ───────────────────────────── show ───────────────────────────── */

export async function runDraftsShow(context: CliContext, name: string): Promise<number> {
  const draft = await readDraft(context, name);
  if (draft.problem !== undefined) {
    context.stderr(`import/${name} no carga: ${draft.problem}\n`);
    return EXIT_DATA_ERROR;
  }
  if (draft.entries.length === 0) {
    context.stderr(`import/${name} no tiene experiencias, formaciones ni proyectos que adoptar\n`);
    return EXIT_OK;
  }
  context.stdout(
    formatTable(
      ['Sección', 'Id', 'Periodo', 'Entrada'],
      draft.entries.map((entry) => [SECTION_LABEL[entry.section], entry.id, period(entry.start, entry.end), entry.title]),
    ),
  );
  context.stderr(`${draft.report.issues} avisos y ${draft.report.unparsed} líneas sin situar en import/${name}/README.md\n`);
  context.stderr(`Adopta las que quieras con «cv drafts adopt ${name} --entry <id>»\n`);
  return EXIT_OK;
}

/* ───────────────────────────── duplicates ───────────────────────────── */

function printGroup(context: CliContext, group: DuplicateGroup, index: number): void {
  context.stdout(`\n${index + 1}. ${SECTION_LABEL[group.section]} · ${group.members.length} entradas${group.inSources ? ' · YA TIENES UNA EN TUS FUENTES' : ''}\n`);
  context.stdout(
    formatTable(
      ['Borrador', 'Id', 'Periodo', 'Entrada'],
      group.members.map((member) => [member.draft ?? 'data/sources', member.entry.id, period(member.entry.start, member.entry.end), member.entry.title]),
    ),
  );
}

export async function runDraftsDuplicates(context: CliContext, options: DraftsListOptions): Promise<number> {
  const { groups, compared } = await draftDuplicates(context, { data: options.data });
  if (groups.length === 0) {
    context.stderr(`Ninguna entrada se parece a otra (${compared} comparadas)\n`);
    return EXIT_OK;
  }
  groups.forEach((group, index) => {
    printGroup(context, group, index);
  });
  context.stderr(
    `\n${pluralize(groups.length, 'grupo', 'grupos')} sobre ${compared} entradas. Un grupo es una PREGUNTA, no una fusión: mira sus miembros y adopta el que prefieras con «cv drafts adopt <borrador> --entry <id>»\n`,
  );
  return EXIT_OK;
}

/* ───────────────────────────── adopt ───────────────────────────── */

export async function runDraftsAdopt(context: CliContext, name: string, options: DraftsAdoptOptions): Promise<number> {
  const ids = options.entry ?? [];
  const section = options.section;
  if (ids.length === 0 && section === undefined) {
    context.stderr('Di qué adoptar: «--entry <id>» (repetible) o «--section experience|education|projects» para toda una sección. «cv drafts show <nombre>» los lista.\n');
    return EXIT_FAILURE;
  }
  if (section !== undefined && !(ADOPTABLE_SECTIONS as readonly string[]).includes(section)) {
    context.stderr(`«${section}» no es una sección adoptable (${ADOPTABLE_SECTIONS.join(', ')})\n`);
    return EXIT_FAILURE;
  }
  const draft = await readDraft(context, name);
  if (draft.problem !== undefined) {
    context.stderr(`import/${name} no carga: ${draft.problem}\n`);
    return EXIT_DATA_ERROR;
  }
  const selected = draft.entries.filter((entry) => (section === undefined ? ids.includes(entry.id) : entry.section === section && (ids.length === 0 || ids.includes(entry.id))));
  // Un id que no está en el borrador se dice AQUÍ: como la selección se resuelve contra sus entradas —hace falta
  // para saber de qué sección es cada id—, nunca llega al caso de uso y este es el único sitio donde se sabe.
  for (const missing of ids.filter((id) => !selected.some((entry) => entry.id === id))) {
    context.stderr(`sin adoptar ${missing}: no es una entrada de import/${name}\n`);
  }
  if (selected.length === 0) {
    context.stderr(`Ninguna entrada de import/${name} coincide con lo pedido; «cv drafts show ${name}» las lista\n`);
    return EXIT_DATA_ERROR;
  }
  const result = await adoptEntries(context, {
    data: options.data,
    entries: selected.map((entry) => ({ draft: name, section: entry.section, id: entry.id })),
    ...(options.dryRun === true ? { dryRun: true } : {}),
  });
  if (!result.ok) {
    return reportError(context, result.error);
  }
  const { adopted, dryRun } = result.outcome;
  for (const entry of adopted) {
    context.stdout(`${entry.path}\n`);
  }
  context.stderr(
    dryRun
      ? `${pluralize(adopted.length, 'entrada', 'entradas')} se escribiría(n) en ${result.outcome.root} (nada escrito: --dry-run)\n`
      : `${pluralize(adopted.length, 'entrada adoptada', 'entradas adoptadas')} en ${result.outcome.root}; revísalas y ejecuta «cv build»\n`,
  );
  return EXIT_OK;
}

export interface DraftsReplaceOptions {
  readonly data: string;
  readonly dryRun: boolean;
  /** No pregunta antes de sustituir (para guiones); en una terminal se pregunta siempre. */
  readonly yes: boolean;
}

/**
 * `cv drafts replace <nombre>`: el borrador ENTERO pasa a ser tus fuentes. Es lo que necesita quien estrena
 * su espacio —el CV importado ES su perfil, no unas entradas que añadir al de ejemplo—. Pregunta antes,
 * porque sustituye; y no destruye, porque las fuentes anteriores quedan enteras en una copia.
 */
export async function runDraftsReplace(context: CliContext, name: string, options: DraftsReplaceOptions): Promise<number> {
  const planned = await replaceSourcesWithDraft(context, { draft: name, data: options.data, dryRun: true });
  if (!planned.ok) {
    return reportError(context, planned.error);
  }
  context.stdout(`import/${name} pasa a ser tus fuentes.\n`);
  context.stdout(formatImportOutcome(planned.outcome));
  if (options.dryRun) {
    return EXIT_OK;
  }
  if (!options.yes && context.confirm !== undefined && !(await context.confirm(`Las fuentes actuales de ${planned.outcome.root} se apartan enteras como copia. ¿Sustituirlas? [s/N] `))) {
    context.stderr('Cancelado: no se ha tocado nada\n');
    return EXIT_OK;
  }
  const result = await replaceSourcesWithDraft(context, { draft: name, data: options.data });
  if (!result.ok) {
    return reportError(context, result.error);
  }
  context.stdout(formatImportOutcome(result.outcome));
  return EXIT_OK;
}
