/**
 * Duplicados **en tus propias fuentes** y cómo resolverlos (T-9.20, `docs/cv-import.md` §11). Detectar es la
 * misma regla que compara borradores (`duplicates.ts`), aplicada a `data/sources/` contra sí mismo: adoptar de
 * varios borradores el mismo empleo es justo lo que los crea.
 *
 * Resolver es lo nuevo, y su forma la decidió el dato real: en los duplicados que salen de importar, **cada
 * mitad tiene lo que a la otra le falta** —una trae las fechas y «Centro pendiente», la otra el centro de verdad
 * y ninguna fecha—, así que borrar cualquiera de las dos pierde información. Por eso resolver es *quedarse con
 * una y absorber de las otras SOLO lo que le falta*:
 *
 * - Un valor que la entrada elegida ya tiene **no se pisa nunca**. Si la otra trae uno distinto, se dice y se
 *   descarta: quien eligió la entrada eligió sus datos.
 * - «Empresa pendiente» y «Centro pendiente» cuentan como **ausencia**, no como valor: son la marca que escribe
 *   el importador cuando NO reconoció el dato, y tratarlas como texto dejaría el hueco sin rellenar.
 * - Las listas (logros, tecnologías, etiquetas) se **añaden sin repetir**; los logros entran con un id libre.
 * - Antes de tocar el disco se valida el perfil entero que quedará, y todo lo que se escribe o se borra queda en
 *   `output/historial-fuentes/`, así que `cv history restore` lo deshace (C9).
 */
import { resolve } from 'node:path';

import { normalize } from '../import/text';
import { resolveProvenance, type Provenance } from '../parsers';
import { entityFileName, serializeEducation, serializeExperience, serializeProject } from '../parsers';
import { validateMasterProfile, type Education, type Experience, type MasterProfile, type Project } from '../core/schema';
import type { AppContext } from './context';
import { loadSources } from './dataset';
import { SECTION_LABEL, entriesOf, groupDuplicates, titleOf, type AdoptableSection, type DuplicateGroup, type ProfileEntry } from './duplicates';
import { conflictError, dataError, environmentError, notFoundError, type AppError } from './errors';
import { isSafeSourcePath } from './paths';
import { recordSourceVersions } from './source-history';
import { SOURCE_FILE_MODE, contentHash } from './sources';

/** Lo que el importador escribe cuando NO reconoció el dato: es la marca de un hueco, no un valor. */
const PLACEHOLDERS: ReadonlySet<string> = new Set(['empresa pendiente', 'centro pendiente', 'nombre pendiente']);

/** Un texto cuenta como ausente si no está, está vacío o es una de esas marcas. */
export function isAbsent(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '' || PLACEHOLDERS.has(value.trim().toLowerCase());
}

/** Campos de texto que se pueden absorber, por sección; el resto (`dates`, listas) tiene su propia regla. */
const SCALARS: Readonly<Record<AdoptableSection, readonly string[]>> = {
  experience: ['company', 'role', 'location', 'summary'],
  education: ['institution', 'degree', 'field', 'summary'],
  projects: ['name', 'role', 'url', 'summary'],
};

/** Listas de texto que se añaden sin repetir. */
const LISTS: Readonly<Record<AdoptableSection, readonly string[]>> = {
  experience: ['technologies', 'tags'],
  education: ['tags'],
  projects: ['technologies', 'tags'],
};

/* ───────────────────────────── detectar ───────────────────────────── */

export interface SourceDuplicates {
  /** Directorio de fuentes examinado. */
  readonly root: string;
  readonly groups: readonly DuplicateGroup[];
  readonly compared: number;
  /** Fichero real de cada entrada (`experience/acme.md`), por id: el que se escribirá o se borrará. */
  readonly files: Readonly<Record<string, string>>;
}

export type SourceDuplicatesResult = { readonly ok: true; readonly result: SourceDuplicates } | { readonly ok: false; readonly error: AppError };

/**
 * En qué fichero vive cada entidad, según la procedencia real del cargador. No se deduce del id: una entrada con
 * `id:` explícito puede vivir en un fichero con otro nombre, y ahí escribir por el nombre deducido crearía un
 * fichero nuevo en vez de corregir el que hay.
 */
export function filesById(profile: MasterProfile, provenance: readonly Provenance[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const section of ['experience', 'education', 'projects'] as const) {
    profile[section].forEach((item, index) => {
      const origin = resolveProvenance([section, index], provenance);
      files[item.id] = origin?.file ?? `${section}/${entityFileName(section, item.id).fileName}.md`;
    });
  }
  return files;
}

/** Los duplicados dentro de `data/sources`: la misma regla que entre borradores, aplicada a lo que ya es tuyo. */
export async function sourceDuplicates(context: AppContext, options: { readonly data: string }): Promise<SourceDuplicatesResult> {
  const loaded = await loadSources(context, options);
  if (!loaded.ok) {
    return { ok: false, error: loaded.error };
  }
  const { profile, provenance, root } = loaded.dataset;
  const entries = entriesOf(profile);
  return { ok: true, result: { root, groups: groupDuplicates(entries.map((entry) => ({ entry }))), compared: entries.length, files: filesById(profile, provenance) } };
}

/* ───────────────────────────── resolver ───────────────────────────── */

/** Un dato que la entrada elegida no tenía y ha tomado de otra. */
export interface TakenField {
  readonly field: string;
  readonly from: string;
  readonly value: string;
}

/** Un dato que las dos traían distinto: gana el de la entrada elegida y el otro se dice, no se pierde en silencio. */
export interface ConflictField {
  readonly field: string;
  readonly from: string;
  readonly kept: string;
  readonly discarded: string;
}

export interface ResolveRequest {
  readonly data: string;
  /** Id de la entrada que se queda. */
  readonly keep: string;
  /** Ids de las entradas que se absorben y se borran. */
  readonly absorb: readonly string[];
  readonly dryRun?: boolean | undefined;
}

export interface ResolveOutcome {
  readonly root: string;
  readonly section: AdoptableSection;
  readonly keep: { readonly id: string; readonly title: string; readonly path: string };
  /** Entradas absorbidas y borradas, con su fichero. */
  readonly absorbed: ReadonlyArray<{ readonly id: string; readonly title: string; readonly path: string }>;
  readonly taken: readonly TakenField[];
  readonly conflicts: readonly ConflictField[];
  /** Logros y elementos de lista añadidos a la entrada que se queda. */
  readonly added: readonly string[];
  /** Entrada del histórico que deshace todo esto; ausente con `dryRun`. */
  readonly historyId?: string | undefined;
  readonly dryRun: boolean;
}

export type ResolveResult = { readonly ok: true; readonly outcome: ResolveOutcome } | { readonly ok: false; readonly error: AppError };

type Entity = Experience | Education | Project;
type Mutable = Record<string, unknown>;

/** Todos los ids en uso: un logro absorbido no puede chocar con otro que ya exista. */
function usedIds(profile: MasterProfile): Set<string> {
  const groups = [profile.experience, profile.projects, profile.education, profile.certifications, profile.skills, profile.achievements, profile.specialties];
  const ids = new Set<string>(groups.flatMap((group) => group.map((item) => item.id)));
  for (const parent of [...profile.experience, ...profile.projects]) {
    for (const achievement of parent.achievements) {
      ids.add(achievement.id);
    }
  }
  for (const achievement of profile.achievements) {
    ids.add(achievement.id);
  }
  return ids;
}

function freeId(base: string, used: Set<string>): string {
  let candidate = base;
  for (let suffix = 2; used.has(candidate); suffix += 1) {
    candidate = `${base}-${suffix}`;
  }
  used.add(candidate);
  return candidate;
}

/**
 * La entrada que se queda, con los huecos rellenados desde las absorbidas, en el orden en que se pidieron. Pura:
 * no toca el disco, así que `--dry-run` enseña exactamente lo que pasaría.
 */
export function absorbInto(
  section: AdoptableSection,
  keep: Entity,
  sources: ReadonlyArray<{ readonly entity: Entity; readonly title: string }>,
  used: Set<string>,
): { readonly entity: Entity; readonly taken: TakenField[]; readonly conflicts: ConflictField[]; readonly added: string[] } {
  const merged: Mutable = { ...(keep as unknown as Mutable) };
  const taken: TakenField[] = [];
  const conflicts: ConflictField[] = [];
  const added: string[] = [];

  for (const { entity, title } of sources) {
    const other = entity as unknown as Mutable;

    for (const field of SCALARS[section]) {
      const incoming = other[field];
      if (isAbsent(incoming)) {
        continue;
      }
      if (isAbsent(merged[field])) {
        merged[field] = incoming;
        taken.push({ field, from: title, value: String(incoming) });
      } else if (String(merged[field]).trim() !== String(incoming).trim()) {
        conflicts.push({ field, from: title, kept: String(merged[field]), discarded: String(incoming) });
      }
    }

    // El periodo va entero: un `end` ausente significa «en curso», que es un dato, no un hueco.
    const incomingDates = other['dates'];
    if (incomingDates !== undefined) {
      if (merged['dates'] === undefined) {
        merged['dates'] = incomingDates;
        const range = incomingDates as { start: string; end?: string };
        taken.push({ field: 'dates', from: title, value: `${range.start} → ${range.end ?? 'en curso'}` });
      } else if (JSON.stringify(merged['dates']) !== JSON.stringify(incomingDates)) {
        const kept = merged['dates'] as { start: string; end?: string };
        const dropped = incomingDates as { start: string; end?: string };
        conflicts.push({ field: 'dates', from: title, kept: `${kept.start} → ${kept.end ?? 'en curso'}`, discarded: `${dropped.start} → ${dropped.end ?? 'en curso'}` });
      }
    }

    for (const field of LISTS[section]) {
      const incoming = (other[field] ?? []) as readonly string[];
      const current = [...((merged[field] ?? []) as readonly string[])];
      const seen = new Set(current.map((value) => normalize(value)));
      for (const value of incoming) {
        if (!seen.has(normalize(value))) {
          current.push(value);
          seen.add(normalize(value));
          added.push(`${field}: ${value}`);
        }
      }
      merged[field] = current;
    }

    if (section !== 'education') {
      const incoming = (other['achievements'] ?? []) as ReadonlyArray<{ id: string; text: string }>;
      const current = [...((merged['achievements'] ?? []) as ReadonlyArray<{ id: string; text: string }>)];
      const seen = new Set(current.map((item) => normalize(item.text)));
      for (const achievement of incoming) {
        if (seen.has(normalize(achievement.text))) {
          continue;
        }
        seen.add(normalize(achievement.text));
        current.push({ ...achievement, id: freeId(achievement.id, used) });
        added.push(`logro: ${achievement.text.slice(0, 60)}`);
      }
      merged['achievements'] = current;
    }
  }

  return { entity: merged as unknown as Entity, taken, conflicts, added };
}

function serializeEntity(section: AdoptableSection, item: Entity, fileName: string, explicitId: boolean): string {
  const naming = { fileName, explicitId };
  if (section === 'experience') {
    return serializeExperience(item as Experience, naming).content;
  }
  if (section === 'education') {
    return serializeEducation(item as Education, naming).content;
  }
  return serializeProject(item as Project, naming).content;
}

/** El nombre de fichero (sin `.md`) de una ruta de fuente, y si el id tiene que ir explícito para conservarla. */
function namingOf(section: AdoptableSection, id: string, path: string): { readonly fileName: string; readonly explicitId: boolean } {
  const fileName = path.replace(new RegExp(`^${section}/`), '').replace(/\.md$/, '');
  const derived = entityFileName(section, id);
  // Si el fichero que ya existe no es el que el id produciría, el id va explícito: así el fichero no cambia de sitio.
  return { fileName, explicitId: derived.fileName !== fileName || derived.explicitId };
}

/**
 * Resuelve un duplicado: la entrada `keep` absorbe lo que le falta de las de `absorb`, que se borran. Nada se
 * escribe si el perfil resultante no valida, si algún id no existe o si las entradas no son de la misma sección.
 */
export async function resolveDuplicate(context: AppContext, request: ResolveRequest): Promise<ResolveResult> {
  if (request.absorb.length === 0) {
    return { ok: false, error: dataError('No se ha indicado ninguna entrada que absorber') };
  }
  if (request.absorb.includes(request.keep)) {
    return { ok: false, error: dataError(`«${request.keep}» no puede absorberse a sí misma`) };
  }
  const loaded = await loadSources(context, { data: request.data });
  if (!loaded.ok) {
    return { ok: false, error: dataError(`Las fuentes de «${request.data}» no cargan, así que no se puede resolver nada: arréglalas primero`, loaded.error.lines) };
  }
  const { profile, provenance, root } = loaded.dataset;
  const files = filesById(profile, provenance);

  const locate = (id: string): { readonly section: AdoptableSection; readonly item: Entity } | undefined => {
    for (const section of ['experience', 'education', 'projects'] as const) {
      const item = (profile[section] as readonly Entity[]).find((candidate) => candidate.id === id);
      if (item !== undefined) {
        return { section, item };
      }
    }
    return undefined;
  };

  const kept = locate(request.keep);
  if (kept === undefined) {
    return { ok: false, error: notFoundError(`«${request.keep}» no es una experiencia, formación ni proyecto de ${root}`) };
  }
  const absorbed: Array<{ readonly id: string; readonly item: Entity; readonly title: string; readonly path: string }> = [];
  for (const id of request.absorb) {
    const found = locate(id);
    if (found === undefined) {
      return { ok: false, error: notFoundError(`«${id}» no es una experiencia, formación ni proyecto de ${root}`) };
    }
    if (found.section !== kept.section) {
      return { ok: false, error: dataError(`«${id}» es una ${SECTION_LABEL[found.section]} y «${request.keep}» una ${SECTION_LABEL[kept.section]}: solo se resuelven duplicados de la misma sección`) };
    }
    absorbed.push({ id, item: found.item, title: titleOf(found.section, found.item), path: files[id] as string });
  }

  const keepPath = files[request.keep] as string;
  for (const path of [keepPath, ...absorbed.map((entry) => entry.path)]) {
    if (!isSafeSourcePath(path)) {
      return { ok: false, error: dataError(`Ruta de fuente no admitida: «${path}»`) };
    }
  }
  // Dos entradas del mismo fichero no se pueden resolver así: borrarlo se llevaría por delante la que se queda.
  if (absorbed.some((entry) => entry.path === keepPath)) {
    return { ok: false, error: conflictError(`«${request.keep}» y otra de las señaladas viven en el mismo fichero (${keepPath}): edítalo a mano`) };
  }

  const used = usedIds(profile);
  const { entity, taken, conflicts, added } = absorbInto(
    kept.section,
    kept.item,
    absorbed.map((entry) => ({ entity: entry.item, title: entry.title })),
    used,
  );

  // La puerta de calidad ANTES del disco: el perfil que quedará tiene que validar entero.
  const removed = new Set(absorbed.map((entry) => entry.id));
  const section = kept.section;
  const next: MasterProfile = {
    ...profile,
    [section]: (profile[section] as readonly Entity[]).filter((item) => !removed.has(item.id)).map((item) => (item.id === request.keep ? entity : item)),
  };
  const validation = validateMasterProfile(next);
  if (!validation.ok) {
    return { ok: false, error: dataError('Con esa resolución el perfil no valida, así que no se ha escrito nada', validation.issues.map((issue) => `${issue.path}: ${issue.message}`)) };
  }

  const naming = namingOf(section, request.keep, keepPath);
  const content = serializeEntity(section, entity, naming.fileName, naming.explicitId);
  const outcome: ResolveOutcome = {
    root,
    section,
    keep: { id: request.keep, title: titleOf(section, entity), path: keepPath },
    absorbed: absorbed.map((entry) => ({ id: entry.id, title: entry.title, path: entry.path })),
    taken,
    conflicts,
    added,
    dryRun: request.dryRun === true,
  };
  if (request.dryRun === true) {
    return { ok: true, outcome };
  }

  // El histórico primero: si no se puede deshacer, no se hace. Lo borrado se guarda con «después» vacío, que es
  // exactamente lo que `cv history restore` necesita para devolverlo.
  const before = new Map<string, string>();
  for (const path of [keepPath, ...absorbed.map((entry) => entry.path)]) {
    try {
      before.set(path, await context.artifactFileSystem.readFile(resolve(root, path)));
    } catch (error) {
      return { ok: false, error: environmentError(`No se pudo leer la fuente «${path}»: ${error instanceof Error ? error.message : String(error)}`) };
    }
  }
  const recorded = await recordSourceVersions(context, {
    action: 'apply',
    origin: `duplicados-${request.keep}`,
    root,
    versions: [
      { path: resolve(root, keepPath), before: before.get(keepPath) as string, after: content, ids: [request.keep] },
      ...absorbed.map((entry) => ({ path: resolve(root, entry.path), before: before.get(entry.path) as string, after: '', ids: [entry.id] })),
    ],
  });
  if (!recorded.ok) {
    return recorded;
  }

  try {
    await context.artifactFileSystem.writeFile(resolve(root, keepPath), content, SOURCE_FILE_MODE);
    for (const entry of absorbed) {
      await context.artifactFileSystem.remove(resolve(root, entry.path));
    }
  } catch (error) {
    return {
      ok: false,
      error: {
        ...environmentError(`Resolución interrumpida: ${error instanceof Error ? error.message : String(error)}`),
        lines: [`las versiones anteriores están en el histórico, entrada ${recorded.entry.id}`, `deshazlo con «cv history restore ${recorded.entry.id} <ruta>»`],
      },
    };
  }
  return { ok: true, outcome: { ...outcome, historyId: recorded.entry.id } };
}

/** La huella del contenido escrito, para quien quiera comprobarlo sin releer el fichero. */
export function resolvedHash(content: string): string {
  return contentHash(content);
}

/** Una entrada de un grupo con el fichero en el que vive, que es lo que enseña la terminal y la web. */
export function memberFile(files: Readonly<Record<string, string>>, entry: ProfileEntry): string {
  return files[entry.id] ?? entry.path;
}
