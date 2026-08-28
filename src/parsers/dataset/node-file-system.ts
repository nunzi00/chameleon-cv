import { readdir, readFile, realpath, stat } from 'node:fs/promises';

import type { DirectoryEntry, EntryKind, FileStat, FileSystem } from './file-system';

interface EntryLike {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

interface StatLike {
  isFile(): boolean;
  isDirectory(): boolean;
  readonly size: number;
}

/** Clasifica una entrada de directorio (`fs.Dirent`) sin seguir enlaces. */
export function entryKindOf(entry: EntryLike): EntryKind {
  if (entry.isSymbolicLink()) {
    return 'symlink';
  }
  if (entry.isFile()) {
    return 'file';
  }
  if (entry.isDirectory()) {
    return 'directory';
  }
  return 'other';
}

/** Convierte un `fs.Stats` (que ya ha seguido enlaces) en `FileStat`. */
export function fileStatOf(info: StatLike): FileStat {
  if (info.isFile()) {
    return { kind: 'file', size: info.size };
  }
  if (info.isDirectory()) {
    return { kind: 'directory', size: info.size };
  }
  return { kind: 'other', size: info.size };
}

/** Implementación real sobre `node:fs`. */
export class NodeFileSystem implements FileSystem {
  async readDirectory(path: string): Promise<readonly DirectoryEntry[]> {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({ name: entry.name, kind: entryKindOf(entry) }));
  }

  async stat(path: string): Promise<FileStat> {
    return fileStatOf(await stat(path));
  }

  realPath(path: string): Promise<string> {
    return realpath(path);
  }

  readTextFile(path: string): Promise<string> {
    return readFile(path, 'utf8');
  }
}
