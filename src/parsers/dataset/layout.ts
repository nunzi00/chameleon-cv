/**
 * Disposición del dataset (`docs/formato-dataset.md` §3): qué ficheros se leen, cuáles se
 * ignoran y cuáles son error. Recorre el directorio con un `FileSystem` inyectado y
 * devuelve la lista ordenada de ficheros a parsear, sin leer su contenido.
 */
import { join, sep } from 'node:path';

import type { EntryKind, FileSystem } from './file-system';
import type { DatasetError } from './types';

export const DATASET_LIMITS = { maxFiles: 500, maxFileBytes: 1024 * 1024 } as const;

export const ENTITY_DIRECTORIES = ['specialties', 'experience', 'projects', 'education'] as const;
export type EntityDirectory = (typeof ENTITY_DIRECTORIES)[number];

export const ROOT_FILES = ['profile.md', 'achievements.md', 'skills.csv', 'certifications.csv'] as const;
export const REQUIRED_ROOT_FILES = ['profile.md'] as const;
export const IGNORED_ROOT_FILES = ['README.md'] as const;

const ENTITY_FILE_PATTERN = /^[a-z0-9][a-z0-9-]*\.md$/;
const LOCALE_OVERLAY_PATTERN = /\.[a-z]{2,3}(?:-[A-Z]{2})?\.md$/;

export interface PlannedFile {
  /** Ruta relativa a la raíz del dataset, con `/`. */
  readonly path: string;
  /** Ruta real en el sistema de ficheros (enlaces ya resueltos). */
  readonly absolutePath: string;
}

export type PlanResult =
  | { readonly ok: true; readonly files: readonly PlannedFile[] }
  | { readonly ok: false; readonly errors: readonly DatasetError[] };

type Resolved =
  | { readonly ok: true; readonly kind: 'file' | 'directory' | 'other'; readonly absolutePath: string }
  | { readonly ok: false; readonly error: DatasetError };

export function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(root + sep);
}

function entityDirectoryOf(name: string): EntityDirectory | undefined {
  return ENTITY_DIRECTORIES.find((directory) => directory === name);
}

function isRootFile(name: string): boolean {
  return ROOT_FILES.some((file) => file === name);
}

/** README y las copias de seguridad `*.bak` que deja `cv improve apply` (T-4.7) no son fuentes. */
function isIgnoredRootFile(name: string): boolean {
  return IGNORED_ROOT_FILES.some((file) => file === name) || /\.bak(\.\d+)?$/.test(name);
}

function sortedByName<T extends { readonly name: string }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** Resuelve una entrada: los enlaces simbólicos solo se siguen si apuntan dentro del dataset. */
async function resolveEntry(
  fs: FileSystem,
  root: string,
  relativePath: string,
  absolutePath: string,
  kind: EntryKind,
): Promise<Resolved> {
  if (kind !== 'symlink') {
    return { ok: true, kind, absolutePath };
  }
  let target: string;
  try {
    target = await fs.realPath(absolutePath);
  } catch {
    return { ok: false, error: { file: relativePath, message: 'Enlace simbólico roto' } };
  }
  if (!isInside(root, target)) {
    return { ok: false, error: { file: relativePath, message: 'Enlace simbólico que apunta fuera del dataset' } };
  }
  const info = await fs.stat(target);
  return { ok: true, kind: info.kind, absolutePath: target };
}

async function collectEntityFiles(
  fs: FileSystem,
  root: string,
  directory: EntityDirectory,
  absoluteDirectory: string,
  errors: DatasetError[],
): Promise<PlannedFile[]> {
  const files: PlannedFile[] = [];
  for (const entry of sortedByName(await fs.readDirectory(absoluteDirectory))) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const relativePath = `${directory}/${entry.name}`;
    const resolved = await resolveEntry(fs, root, relativePath, join(absoluteDirectory, entry.name), entry.kind);
    if (!resolved.ok) {
      errors.push(resolved.error);
      continue;
    }
    if (resolved.kind === 'directory') {
      errors.push({ file: `${relativePath}/`, message: 'No se admiten subdirectorios dentro de un directorio de entidades' });
      continue;
    }
    if (resolved.kind !== 'file' || !entry.name.endsWith('.md')) {
      continue;
    }
    if (ENTITY_FILE_PATTERN.test(entry.name)) {
      files.push({ path: relativePath, absolutePath: resolved.absolutePath });
    } else if (LOCALE_OVERLAY_PATTERN.test(entry.name)) {
      errors.push({
        file: relativePath,
        message: 'La extensión .<locale>.md está reservada para overlays de idioma (aún no soportados)',
      });
    } else {
      errors.push({
        file: relativePath,
        message: 'Nombre de fichero inválido: usa minúsculas, dígitos y guiones (p. ej. acme.md)',
      });
    }
  }
  return files;
}

/**
 * Planifica la lectura de un dataset: valida la disposición, resuelve enlaces, aplica los
 * límites y devuelve los ficheros en orden de documento (`profile.md`, directorios de
 * entidades en orden fijo con ficheros alfabéticos, `achievements.md`, CSVs).
 */
export async function planDataset(root: string, fs: FileSystem): Promise<PlanResult> {
  let rootPath: string;
  try {
    rootPath = await fs.realPath(root);
  } catch {
    return { ok: false, errors: [{ file: '.', message: `No se encuentra el directorio del dataset: ${root}` }] };
  }
  if ((await fs.stat(rootPath)).kind !== 'directory') {
    return { ok: false, errors: [{ file: '.', message: `La ruta del dataset no es un directorio: ${root}` }] };
  }

  const errors: DatasetError[] = [];
  const rootFiles = new Map<string, PlannedFile>();
  const entityFiles = new Map<EntityDirectory, PlannedFile[]>();

  for (const entry of sortedByName(await fs.readDirectory(rootPath))) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const resolved = await resolveEntry(fs, rootPath, entry.name, join(rootPath, entry.name), entry.kind);
    if (!resolved.ok) {
      errors.push(resolved.error);
    } else if (resolved.kind === 'file') {
      if (isRootFile(entry.name)) {
        rootFiles.set(entry.name, { path: entry.name, absolutePath: resolved.absolutePath });
      } else if (!isIgnoredRootFile(entry.name)) {
        errors.push({
          file: entry.name,
          message: `Fichero no reconocido en la raíz del dataset (admitidos: ${ROOT_FILES.join(', ')})`,
        });
      }
    } else if (resolved.kind === 'directory') {
      const directory = entityDirectoryOf(entry.name);
      if (directory === undefined) {
        errors.push({
          file: `${entry.name}/`,
          message: `Directorio no reconocido (admitidos: ${ENTITY_DIRECTORIES.join(', ')})`,
        });
      } else {
        entityFiles.set(directory, await collectEntityFiles(fs, rootPath, directory, resolved.absolutePath, errors));
      }
    } else {
      errors.push({ file: entry.name, message: 'Entrada de tipo no admitido (ni fichero ni directorio)' });
    }
  }

  for (const required of REQUIRED_ROOT_FILES) {
    if (!rootFiles.has(required)) {
      errors.push({ file: required, message: 'Falta el fichero obligatorio' });
    }
  }

  const files = [
    rootFiles.get('profile.md'),
    ...ENTITY_DIRECTORIES.flatMap((directory) => entityFiles.get(directory) ?? []),
    rootFiles.get('achievements.md'),
    rootFiles.get('skills.csv'),
    rootFiles.get('certifications.csv'),
  ].filter((file): file is PlannedFile => file !== undefined);

  if (files.length > DATASET_LIMITS.maxFiles) {
    errors.push({ file: '.', message: `Demasiados ficheros: ${files.length} (máximo ${DATASET_LIMITS.maxFiles})` });
  }
  for (const file of files) {
    const info = await fs.stat(file.absolutePath);
    if (info.size > DATASET_LIMITS.maxFileBytes) {
      errors.push({
        file: file.path,
        message: `Fichero demasiado grande: ${info.size} bytes (máximo ${DATASET_LIMITS.maxFileBytes})`,
      });
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, files };
}
