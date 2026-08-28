import { posix } from 'node:path';

import type { DirectoryEntry, FileStat, FileSystem } from '../../src/parsers/dataset/file-system';

export type MemoryEntry =
  | { readonly kind: 'file'; readonly content: string }
  | { readonly kind: 'directory' }
  | { readonly kind: 'symlink'; readonly target: string }
  | { readonly kind: 'other' };

/** Sistema de ficheros en memoria (rutas POSIX absolutas) para testear el cargador sin disco. */
export class MemoryFileSystem implements FileSystem {
  private readonly entries = new Map<string, MemoryEntry>();

  constructor(tree: Record<string, string | MemoryEntry>) {
    this.entries.set('/', { kind: 'directory' });
    for (const [path, value] of Object.entries(tree)) {
      this.add(path, typeof value === 'string' ? { kind: 'file', content: value } : value);
    }
  }

  private add(path: string, entry: MemoryEntry): void {
    const normalized = posix.normalize(path);
    let parent = posix.dirname(normalized);
    while (!this.entries.has(parent)) {
      this.entries.set(parent, { kind: 'directory' });
      parent = posix.dirname(parent);
    }
    this.entries.set(normalized, entry);
  }

  private resolve(path: string): { path: string; entry: MemoryEntry } {
    let current = posix.normalize(path);
    for (let hops = 0; hops < 8; hops += 1) {
      const entry = this.entries.get(current);
      if (entry === undefined) {
        throw new Error(`ENOENT: ${current}`);
      }
      if (entry.kind !== 'symlink') {
        return { path: current, entry };
      }
      current = posix.resolve(posix.dirname(current), entry.target);
    }
    throw new Error(`ELOOP: ${path}`);
  }

  async readDirectory(path: string): Promise<readonly DirectoryEntry[]> {
    const { path: directory, entry } = this.resolve(path);
    if (entry.kind !== 'directory') {
      throw new Error(`ENOTDIR: ${path}`);
    }
    const prefix = directory === '/' ? '/' : `${directory}/`;
    return [...this.entries.entries()]
      .filter(([candidate]) => candidate !== directory && candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes('/'))
      .map(([candidate, child]) => ({ name: candidate.slice(prefix.length), kind: child.kind }));
  }

  async stat(path: string): Promise<FileStat> {
    const { entry } = this.resolve(path);
    if (entry.kind === 'file') {
      return { kind: 'file', size: Buffer.byteLength(entry.content, 'utf8') };
    }
    if (entry.kind === 'directory') {
      return { kind: 'directory', size: 0 };
    }
    return { kind: 'other', size: 0 };
  }

  async realPath(path: string): Promise<string> {
    return this.resolve(path).path;
  }

  async readTextFile(path: string): Promise<string> {
    const { entry } = this.resolve(path);
    if (entry.kind !== 'file') {
      throw new Error(`EISDIR: ${path}`);
    }
    return entry.content;
  }
}

/** Dataset mínimo válido en memoria, ampliable con más ficheros. */
export function datasetTree(extra: Record<string, string | MemoryEntry> = {}): Record<string, string | MemoryEntry> {
  return {
    '/data/profile.md': '---\nfullName: Ada Ejemplo\n---\n\nResumen por defecto.\n',
    ...extra,
  };
}
