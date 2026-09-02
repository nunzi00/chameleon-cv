/**
 * `cv duplicates` (T-9.20, `docs/cv-import.md` §11): qué está repetido en TUS fuentes y cómo resolverlo. El
 * criterio —qué es «la misma cosa», qué se absorbe y qué se conserva— vive en `src/app/dedupe.ts`, que es lo que
 * usa también la web (C14); aquí queda lo que es de la terminal: la tabla y los códigos de salida.
 */
import { resolveDuplicate, sourceDuplicates, type ResolveOutcome } from '../../app/dedupe';
import { SECTION_LABEL, type DuplicateGroup } from '../../app/duplicates';
import type { CliContext } from '../context';
import { EXIT_FAILURE, EXIT_OK, formatTable, pluralize, reportError } from '../output';

export interface DuplicatesListOptions {
  readonly data: string;
}

export interface DuplicatesResolveOptions {
  readonly data: string;
  /** Ids que se absorben en la que se queda; sin ellos no hay nada que resolver. */
  readonly absorb?: readonly string[] | undefined;
  readonly dryRun?: boolean | undefined;
}

/** «2016-09 → 2017-05», «2022-04 → …» o «—» cuando la entrada no trae fechas. */
function period(start: string | undefined, end: string | undefined): string {
  return start === undefined ? '—' : `${start} → ${end ?? '…'}`;
}

function printGroup(context: CliContext, group: DuplicateGroup, files: Readonly<Record<string, string>>, index: number): void {
  context.stdout(`\n${index + 1}. ${SECTION_LABEL[group.section]} · ${group.members.length} entradas\n`);
  context.stdout(
    formatTable(
      ['Id', 'Periodo', 'Entrada', 'Fichero'],
      group.members.map((member) => [member.entry.id, period(member.entry.start, member.entry.end), member.entry.title, files[member.entry.id] ?? member.entry.path]),
    ),
  );
}

export async function runDuplicatesList(context: CliContext, options: DuplicatesListOptions): Promise<number> {
  const result = await sourceDuplicates(context, { data: options.data });
  if (!result.ok) {
    return reportError(context, result.error);
  }
  const { groups, compared, root } = result.result;
  if (groups.length === 0) {
    context.stderr(`Ninguna entrada de ${root} se parece a otra (${compared} comparadas)\n`);
    return EXIT_OK;
  }
  groups.forEach((group, index) => {
    printGroup(context, group, result.result.files, index);
  });
  const first = groups[0]!.members;
  context.stderr(
    `\n${pluralize(groups.length, 'grupo', 'grupos')} sobre ${compared} entradas de ${root}. Resuelve cada uno quedándote con una: «cv duplicates resolve ${first[0]!.entry.id} --absorb ${first[1]?.entry.id ?? '<id>'}»\n`,
  );
  return EXIT_OK;
}

function report(context: CliContext, outcome: ResolveOutcome): void {
  for (const field of outcome.taken) {
    context.stderr(`tomado ${field.field} de «${field.from}»: ${field.value}\n`);
  }
  for (const line of outcome.added) {
    context.stderr(`añadido ${line}\n`);
  }
  for (const conflict of outcome.conflicts) {
    context.stderr(`se conserva ${conflict.field} = «${conflict.kept}»; «${conflict.from}» traía «${conflict.discarded}» y se descarta\n`);
  }
}

export async function runDuplicatesResolve(context: CliContext, keep: string, options: DuplicatesResolveOptions): Promise<number> {
  const absorb = options.absorb ?? [];
  if (absorb.length === 0) {
    context.stderr('Di qué entrada se absorbe con «--absorb <id>» (repetible). «cv duplicates» las lista con su id.\n');
    return EXIT_FAILURE;
  }
  const result = await resolveDuplicate(context, { data: options.data, keep, absorb, ...(options.dryRun === true ? { dryRun: true } : {}) });
  if (!result.ok) {
    return reportError(context, result.error);
  }
  const { outcome } = result;
  report(context, outcome);
  context.stdout(`${outcome.keep.path}\n`);
  if (outcome.dryRun) {
    context.stderr(`Se quedaría «${outcome.keep.title}» y se borraría(n) ${outcome.absorbed.map((entry) => entry.path).join(', ')} (nada escrito: --dry-run)\n`);
    return EXIT_OK;
  }
  context.stderr(`Se queda «${outcome.keep.title}» en ${outcome.keep.path}; borrado(s) ${outcome.absorbed.map((entry) => entry.path).join(', ')}\n`);
  context.stderr(`Deshazlo con «cv history restore ${outcome.historyId ?? 'latest'} <ruta>»; después, «cv build»\n`);
  return EXIT_OK;
}
