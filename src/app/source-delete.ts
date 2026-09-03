/**
 * Eliminar una fuente (T-9.25, encargo del PO del 3-sep: «¿cómo elimino una fuente?»). Era el hueco que dejaba
 * T-9.20: resolver un duplicado sí borraba ficheros, pero quitar una fuente cualquiera —una experiencia que
 * entró mal de un PDF, un borrador adoptado por error— solo se podía hacer a mano en el disco.
 *
 * Borrar es la escritura más peligrosa que hace el producto, así que lleva las mismas garantías que las demás,
 * y una más:
 *
 * 1. **Se comprueba qué quedaría ANTES de tocar nada.** No se borra y se mira a ver: el dataset se carga otra
 *    vez con esa ruta oculta —el cargador de verdad, con sus reglas de verdad— y si lo que queda no carga o no
 *    valida, no se borra nada y se dice por qué. Así, quitar `profile.md` se rechaza con el motivo del
 *    cargador en vez de dejar un espacio de trabajo roto.
 * 2. **Se dice qué desaparece del perfil**, entrada a entrada y por sección: un fichero de fuentes no es una
 *    lista de cosas obvias, y enterarse después de compilar es tarde. `dryRun` enseña justo eso sin escribir.
 * 3. **Se puede deshacer.** El fichero entero se guarda en el histórico con «después» vacío, que es lo que
 *    `cv history restore` necesita para devolverlo (C9). Nada de copias `.bak` nuevas en `data/sources/`.
 * 4. **Opcionalmente, con huella**: quien borra desde una pantalla que tenía el fichero abierto manda su
 *    `sha256` y no puede borrar algo que cambió por debajo. La CLI, que borra por ruta, no la necesita.
 */
import { resolve } from 'node:path';

import type { MasterProfile } from '../core/schema';
import type { DirectoryEntry, FileStat, FileSystem } from '../parsers';
import { loadDataset } from '../parsers';
import { describeError } from '../shared/errors';
import type { AppContext } from './context';
import { conflictError, dataError, environmentError, type AppError } from './errors';
import { entriesOf } from './duplicates';
import { recordSourceVersions } from './source-history';
import { readSource } from './sources';
import { formatDatasetError, pluralize } from './text';

/** Secciones del perfil cuyos elementos se cuentan una a una al decir qué desaparece. */
const SECTIONS = ['specialties', 'experience', 'projects', 'education', 'skills', 'achievements', 'certifications', 'languages'] as const;
type ProfileSection = (typeof SECTIONS)[number];

/**
 * El mismo sistema de ficheros con **una ruta que no existe**. Es la forma honrada de contestar «¿qué quedaría
 * sin este fichero?»: se le pregunta al cargador de verdad, en vez de imitar sus reglas aquí y que se separen.
 *
 * `realPath` pasa de largo a propósito: solo se usa para resolver la **raíz** del dataset, y esconderla sería
 * esconder el directorio entero. Lo que se oculta es el fichero: no está en su directorio y no se puede leer.
 */
export function hidingFile(inner: FileSystem, absent: string): FileSystem {
  // Se rechaza la promesa (no se lanza en seco): un `ENOENT` es lo que el cargador espera de un fichero que no está.
  const missing = (path: string): Promise<never> => Promise.reject(Object.assign(new Error(`ENOENT: no such file or directory, ${path}`), { code: 'ENOENT' }));
  return {
    realPath: (path: string): Promise<string> => inner.realPath(path),
    readDirectory: async (path: string): Promise<readonly DirectoryEntry[]> => (await inner.readDirectory(path)).filter((entry) => resolve(path, entry.name) !== absent),
    stat: (path: string): Promise<FileStat> => (path === absent ? missing(path) : inner.stat(path)),
    readTextFile: (path: string): Promise<string> => (path === absent ? missing(path) : inner.readTextFile(path)),
    readBinaryFile: (path: string): Promise<Uint8Array> => (path === absent ? missing(path) : inner.readBinaryFile(path)),
  };
}

/** Un elemento del perfil que desaparece al borrar la fuente. */
export interface RemovedEntry {
  readonly section: ProfileSection;
  readonly id: string;
  /** Lo que se lee de él («Backend Engineer · ACME»); el id si la sección no tiene título. */
  readonly title: string;
}

function idsOf(profile: MasterProfile, section: ProfileSection): ReadonlyMap<string, string> {
  const titles = new Map(entriesOf(profile).map((entry) => [entry.id, entry.title]));
  const items = profile[section] as readonly { readonly id: string; readonly name?: string }[];
  return new Map(items.map((item) => [item.id, titles.get(item.id) ?? item.name ?? item.id]));
}

/** Lo que estaba en el perfil y ya no está, por sección y en el orden en que se declaran. */
export function removedEntries(before: MasterProfile, after: MasterProfile): readonly RemovedEntry[] {
  const removed: RemovedEntry[] = [];
  for (const section of SECTIONS) {
    const survivors = new Set((after[section] as readonly { readonly id: string }[]).map((item) => item.id));
    for (const [id, title] of idsOf(before, section)) {
      if (!survivors.has(id)) {
        removed.push({ section, id, title });
      }
    }
  }
  return removed;
}

export interface DeleteSourceRequest {
  /** Ruta relativa a la raíz de las fuentes (`experience/acme.md`). */
  readonly path: string;
  /** Huella del contenido que se cree estar borrando; sin ella no se comprueba nada. */
  readonly expectedSha256?: string | undefined;
  /** Solo enseña qué desaparecería. */
  readonly dryRun?: boolean | undefined;
}

export interface DeleteSourceOutcome {
  readonly root: string;
  readonly path: string;
  readonly bytes: number;
  /** Qué deja de estar en el perfil; vacío si el fichero no aportaba ninguna entrada. */
  readonly removed: readonly RemovedEntry[];
  readonly dryRun: boolean;
  /** Entrada del histórico desde la que se recupera; ausente en seco. */
  readonly historyId: string | undefined;
}

export type DeleteSourceResult = { readonly ok: true; readonly outcome: DeleteSourceOutcome } | { readonly ok: false; readonly error: AppError };

export async function deleteSource(context: AppContext, root: string, request: DeleteSourceRequest): Promise<DeleteSourceResult> {
  // La raíz primero: sin ella no hay nada que decir de la fuente, y el motivo es otro («no está el directorio»).
  let realRoot: string;
  try {
    realRoot = await context.datasetFileSystem.realPath(root);
  } catch (error) {
    return { ok: false, error: environmentError(`No se pudo leer el directorio de fuentes ${root}: ${describeError(error)}`) };
  }
  const current = await readSource(context, realRoot, request.path);
  if (!current.ok) {
    return { ok: false, error: current.error };
  }
  if (request.expectedSha256 !== undefined && request.expectedSha256 !== current.file.sha256) {
    return { ok: false, error: conflictError(`La fuente «${request.path}» cambió desde que se leyó (huella ${current.file.sha256.slice(0, 12)}…): vuelve a cargarla antes de borrarla`) };
  }
  const absolute = resolve(realRoot, request.path);

  // 1. El perfil de ahora y el que quedaría: las dos cargas con el cargador de verdad.
  const options = { fileSystem: context.datasetFileSystem, parsers: context.parsers };
  const before = await loadDataset(realRoot, options);
  if (!before.ok) {
    return {
      ok: false,
      error: dataError(`Las fuentes de ${root} no cargan ahora mismo, así que no se puede saber qué pasaría al borrar «${request.path}»`, [
        `Las fuentes de ${root} no cargan ahora mismo, así que no se puede saber qué pasaría al borrar «${request.path}»:`,
        ...before.errors.map(formatDatasetError),
      ]),
    };
  }
  const after = await loadDataset(realRoot, { ...options, fileSystem: hidingFile(context.datasetFileSystem, absolute) });
  if (!after.ok) {
    return {
      ok: false,
      error: dataError(`Sin «${request.path}» las fuentes dejarían de cargar, así que no se ha borrado nada`, [
        `Sin «${request.path}» las fuentes dejarían de cargar, así que no se ha borrado nada:`,
        ...after.errors.map(formatDatasetError),
        'Edita el fichero en vez de borrarlo, o borra antes lo que dependa de él',
      ]),
    };
  }
  const removed = removedEntries(before.profile, after.profile);
  const outcome = { root: realRoot, path: request.path, bytes: Buffer.byteLength(current.file.content, 'utf8'), removed };
  if (request.dryRun === true) {
    return { ok: true, outcome: { ...outcome, dryRun: true, historyId: undefined } };
  }

  // 2. El histórico antes que el borrado: si no se puede deshacer, no se hace. «Después» vacío = «no existe».
  const recorded = await recordSourceVersions(context, {
    action: 'apply',
    origin: `borrado-${request.path}`,
    root: realRoot,
    versions: [{ path: absolute, before: current.file.content, after: '', ids: removed.length === 0 ? [request.path] : removed.map((entry) => entry.id) }],
    at: context.now?.(),
  });
  if (!recorded.ok) {
    return recorded;
  }
  try {
    await context.artifactFileSystem.remove(absolute);
  } catch (error) {
    return { ok: false, error: environmentError(`No se pudo borrar la fuente «${request.path}»: ${describeError(error)}`) };
  }
  return { ok: true, outcome: { ...outcome, dryRun: false, historyId: recorded.entry.id } };
}

/** «2 entradas: exp-acme (Backend Engineer · ACME), …»: lo que desaparece, para la terminal y los avisos. */
export function describeRemoved(removed: readonly RemovedEntry[]): string {
  return removed.length === 0 ? 'ninguna entrada del perfil' : `${pluralize(removed.length, 'entrada', 'entradas')}: ${removed.map((entry) => `${entry.id} (${entry.title})`).join(', ')}`;
}
