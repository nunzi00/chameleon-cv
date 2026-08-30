/**
 * Histórico de versiones de las fuentes (T-8.10): cada aplicación de una revisión guarda en
 * `output/historial-fuentes/<id>/` el fichero entero de cada fuente tal como estaba (misma ruta relativa), un
 * `cambio.json` con las huellas y los ids aplicados, y actualiza `index.json` (últimas 500 entradas). Restaurar una
 * versión escribe la fuente y crea, a su vez, una entrada: nunca se pierde nada. Sustituye a las copias `.bak`.
 */
import { dirname, relative, resolve } from 'node:path';

import type { AppContext } from './context';
import { dataError, environmentError, type AppError } from './errors';
import { isSafeSourcePath } from './paths';
import { contentHash } from './sources';

export const SOURCE_HISTORY_DIR = 'output/historial-fuentes';
export const SOURCE_HISTORY_INDEX = 'index.json';
export const SOURCE_HISTORY_CHANGE = 'cambio.json';
export const SOURCE_HISTORY_LIMIT = 500;
const HISTORY_MODE = 0o600;

export type SourceHistoryAction = 'apply' | 'restore';

export interface SourceHistoryFile {
  /** Ruta relativa al directorio de fuentes (`experience/acme.md`). */
  readonly path: string;
  readonly sha256Before: string;
  readonly sha256After: string;
  /** Ids aplicados (revisión) o la entrada restaurada (`restore`). */
  readonly ids: readonly string[];
}

export interface SourceHistoryEntry {
  /** `<fecha compacta>-<origen>`: nombre del directorio de la entrada. */
  readonly id: string;
  readonly at: string;
  readonly action: SourceHistoryAction;
  /** Revisión aplicada (nombre del fichero) o entrada restaurada. */
  readonly origin: string;
  /** Directorio de fuentes (absoluto) al que pertenecen las rutas. */
  readonly root: string;
  readonly files: readonly SourceHistoryFile[];
}

interface HistoryIndex {
  readonly version: 1;
  readonly entries: readonly SourceHistoryEntry[];
}

export interface PendingVersion {
  /** Ruta absoluta de la fuente. */
  readonly path: string;
  readonly before: string;
  readonly after: string;
  readonly ids: readonly string[];
}

type HistoryContext = Pick<AppContext, 'cwd' | 'artifactFileSystem'>;

export function historyDirectory(cwd: string): string {
  return resolve(cwd, SOURCE_HISTORY_DIR);
}

/** `20260830T181205123Z-revision-improve`: ordenable, sin caracteres raros. */
export function historyEntryId(at: Date, origin: string): string {
  const stamp = at.toISOString().replace(/[-:]/g, '').replace('.', '');
  // Restaurar toma como origen otra entrada: su marca no se repite en el id nuevo.
  const slug = origin
    .replace(/^\d{8}T\d{9}Z-?/i, '')
    .replace(/\.md$/i, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60);
  return slug === '' ? stamp : `${stamp}-${slug}`;
}

const isFile = (value: unknown): value is SourceHistoryFile =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as SourceHistoryFile).path === 'string' &&
  typeof (value as SourceHistoryFile).sha256Before === 'string' &&
  typeof (value as SourceHistoryFile).sha256After === 'string' &&
  Array.isArray((value as SourceHistoryFile).ids);

const isEntry = (value: unknown): value is SourceHistoryEntry =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as SourceHistoryEntry).id === 'string' &&
  typeof (value as SourceHistoryEntry).at === 'string' &&
  ((value as SourceHistoryEntry).action === 'apply' || (value as SourceHistoryEntry).action === 'restore') &&
  typeof (value as SourceHistoryEntry).origin === 'string' &&
  typeof (value as SourceHistoryEntry).root === 'string' &&
  Array.isArray((value as SourceHistoryEntry).files) &&
  (value as SourceHistoryEntry).files.every(isFile);

/** Las entradas del índice, de la más reciente a la más antigua; sin índice (o inválido), ninguna. */
export async function readSourceHistory(context: HistoryContext): Promise<SourceHistoryEntry[]> {
  let raw: string;
  try {
    raw = await context.artifactFileSystem.readFile(resolve(historyDirectory(context.cwd), SOURCE_HISTORY_INDEX));
  } catch {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const entries = typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as HistoryIndex).entries) ? (parsed as HistoryIndex).entries : [];
    // El índice va en orden de inserción: a igual fecha, la última añadida es la más reciente (orden estable).
    return entries.filter(isEntry).reverse().sort((a, b) => b.at.localeCompare(a.at));
  } catch {
    return [];
  }
}

/** Ruta relativa segura dentro de una entrada o `undefined` si la ruta no es admisible. */
function safeRelative(root: string, path: string): string | undefined {
  const rel = relative(root, path).split('\\').join('/');
  return isSafeSourcePath(rel) ? rel : undefined;
}

export type RecordResult = { readonly ok: true; readonly entry: SourceHistoryEntry; readonly directory: string } | { readonly ok: false; readonly error: AppError };

/**
 * Guarda las versiones anteriores (fichero completo) y el `cambio.json`, y añade la entrada al índice. Se llama
 * **antes** de escribir las fuentes: si falla, no se escribe nada.
 */
export async function recordSourceVersions(
  context: HistoryContext,
  options: { readonly action: SourceHistoryAction; readonly origin: string; readonly root: string; readonly versions: readonly PendingVersion[]; readonly at?: Date | undefined },
): Promise<RecordResult> {
  const at = options.at ?? new Date();
  const id = historyEntryId(at, options.origin);
  const directory = resolve(historyDirectory(context.cwd), id);
  const files: SourceHistoryFile[] = [];
  for (const version of options.versions) {
    const rel = safeRelative(options.root, version.path);
    if (rel === undefined) {
      return { ok: false, error: dataError(`Ruta de fuente no admitida en el histórico: ${version.path}`) };
    }
    files.push({ path: rel, sha256Before: contentHash(version.before), sha256After: contentHash(version.after), ids: [...version.ids] });
  }
  const entry: SourceHistoryEntry = { id, at: at.toISOString(), action: options.action, origin: options.origin, root: options.root, files };
  try {
    for (const version of options.versions) {
      const target = resolve(directory, safeRelative(options.root, version.path) as string);
      await context.artifactFileSystem.mkdir(dirname(target));
      await context.artifactFileSystem.writeFile(target, version.before, HISTORY_MODE);
    }
    await context.artifactFileSystem.writeFile(resolve(directory, SOURCE_HISTORY_CHANGE), `${JSON.stringify(entry, null, 2)}\n`, HISTORY_MODE);
    const entries = [...(await readSourceHistory(context)).reverse().filter((existing) => existing.id !== id), entry].sort((a, b) => a.at.localeCompare(b.at)).slice(-SOURCE_HISTORY_LIMIT);
    const index: HistoryIndex = { version: 1, entries };
    await context.artifactFileSystem.writeFile(resolve(historyDirectory(context.cwd), SOURCE_HISTORY_INDEX), `${JSON.stringify(index, null, 2)}\n`, HISTORY_MODE);
    return { ok: true, entry, directory };
  } catch (error) {
    return { ok: false, error: environmentError(`No se pudo guardar el histórico en ${directory}: ${error instanceof Error ? error.message : String(error)}`) };
  }
}

/** Ruta absoluta de la versión guardada de un fichero en una entrada. */
export function historyVersionPath(cwd: string, entryId: string, path: string): string {
  return resolve(historyDirectory(cwd), entryId, path);
}

export type VersionResult = { readonly ok: true; readonly entry: SourceHistoryEntry; readonly file: SourceHistoryFile; readonly content: string } | { readonly ok: false; readonly error: AppError };

export const LATEST_ENTRY = 'latest';

/** La entrada pedida por id, o con `latest` la más reciente que guarde `path`. */
export function findHistoryEntry(entries: readonly SourceHistoryEntry[], entryId: string, path: string): SourceHistoryEntry | undefined {
  return entryId === LATEST_ENTRY ? entries.find((candidate) => candidate.files.some((file) => file.path === path)) : entries.find((candidate) => candidate.id === entryId);
}

/** Una versión guardada (entrada + fichero) con su contenido; `latest` es la más reciente del fichero. */
export async function readSourceVersion(context: HistoryContext, entryId: string, path: string): Promise<VersionResult> {
  const entry = findHistoryEntry(await readSourceHistory(context), entryId, path);
  if (entry === undefined) {
    return { ok: false, error: dataError(entryId === LATEST_ENTRY ? `El histórico no guarda ninguna versión de «${path}»` : `No hay ninguna entrada «${entryId}» en el histórico`) };
  }
  const file = entry.files.find((candidate) => candidate.path === path);
  if (file === undefined) {
    return { ok: false, error: dataError(`La entrada «${entryId}» no guarda «${path}»`) };
  }
  try {
    return { ok: true, entry, file, content: await context.artifactFileSystem.readFile(historyVersionPath(context.cwd, entry.id, path)) };
  } catch (error) {
    return { ok: false, error: environmentError(`No se pudo leer la versión guardada: ${error instanceof Error ? error.message : String(error)}`) };
  }
}

export type RestoreResult = { readonly ok: true; readonly path: string; readonly entry: SourceHistoryEntry } | { readonly ok: false; readonly error: AppError };

/** Escribe la versión guardada sobre la fuente, guardando antes la versión actual como una entrada nueva (`restore`). */
export async function restoreSourceVersion(context: HistoryContext, entryId: string, path: string, at?: Date): Promise<RestoreResult> {
  const version = await readSourceVersion(context, entryId, path);
  if (!version.ok) {
    return version;
  }
  const target = resolve(version.entry.root, path);
  let current: string;
  try {
    current = await context.artifactFileSystem.readFile(target);
  } catch (error) {
    return { ok: false, error: environmentError(`No se pudo leer la fuente actual ${target}: ${error instanceof Error ? error.message : String(error)}`) };
  }
  const recorded = await recordSourceVersions(context, { action: 'restore', origin: version.entry.id, root: version.entry.root, versions: [{ path: target, before: current, after: version.content, ids: [version.entry.id] }], at });
  if (!recorded.ok) {
    return recorded;
  }
  try {
    await context.artifactFileSystem.writeFile(target, version.content, 0o600);
  } catch (error) {
    return { ok: false, error: environmentError(`No se pudo escribir ${target}: ${error instanceof Error ? error.message : String(error)}`) };
  }
  return { ok: true, path: target, entry: recorded.entry };
}

/** Una línea por entrada: «2026-08-30T18:12:05.123Z · apply revision-improve.md · experience/acme.md (exp-acme-1)». */
export function describeSourceHistory(entries: readonly SourceHistoryEntry[]): string {
  if (entries.length === 0) {
    return 'Histórico de fuentes vacío: nada se ha aplicado ni restaurado todavía\n';
  }
  return `${entries.map((entry) => `${entry.at} · ${entry.action} ${entry.origin} · ${entry.files.map((file) => `${file.path} (${file.ids.join(', ')})`).join(' · ')} · ${entry.id}`).join('\n')}\n`;
}
