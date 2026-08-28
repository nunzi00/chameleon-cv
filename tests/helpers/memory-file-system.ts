import { posix } from 'node:path';

import type { WritableFileSystem } from '../../src/artifact/writable-file-system';
import type { DirectoryEntry, FileStat, FileSystem } from '../../src/parsers/dataset/file-system';

export type MemoryEntry =
  | { readonly kind: 'file'; readonly content: string; readonly mode?: number; readonly mtimeMs?: number }
  | { readonly kind: 'directory' }
  | { readonly kind: 'symlink'; readonly target: string }
  | { readonly kind: 'other' };

export type WritableOperation = 'mkdir' | 'writeFile' | 'rename' | 'chmod' | 'readFile' | 'remove';

/**
 * Un único «disco» en memoria (rutas POSIX absolutas) que implementa tanto el sistema de
 * ficheros de lectura del dataset como el de escritura del artefacto, con inyección de fallos
 * por operación de escritura y un reloj monótono para las fechas de modificación.
 */
export class MemoryFileSystem implements FileSystem, WritableFileSystem {
  private readonly entries = new Map<string, MemoryEntry>();
  private clock = 1000;
  readonly failures = new Set<WritableOperation>();
  readonly log: string[] = [];

  constructor(tree: Record<string, string | MemoryEntry> = {}) {
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
        throw Object.assign(new Error(`ENOENT: no such file or directory, ${current}`), { code: 'ENOENT' });
      }
      if (entry.kind !== 'symlink') {
        return { path: current, entry };
      }
      current = posix.resolve(posix.dirname(current), entry.target);
    }
    throw new Error(`ELOOP: ${path}`);
  }

  private check(operation: WritableOperation, path: string): void {
    this.log.push(`${operation} ${path}`);
    if (this.failures.has(operation)) {
      throw new Error(`fallo simulado en ${operation}`);
    }
  }

  private existingFile(path: string): { readonly content: string; readonly mode?: number; readonly mtimeMs?: number } {
    const { entry } = this.resolve(path);
    if (entry.kind !== 'file') {
      throw new Error(`EISDIR: illegal operation on a directory, ${path}`);
    }
    return entry;
  }

  /** Entrada de fichero (sin seguir enlaces) para las aserciones; `undefined` si no existe. */
  file(path: string): { content: string; mode: number | undefined; mtimeMs: number } | undefined {
    const entry = this.entries.get(posix.normalize(path));
    return entry?.kind === 'file' ? { content: entry.content, mode: entry.mode, mtimeMs: entry.mtimeMs ?? 0 } : undefined;
  }

  /** Cambia la fecha de modificación de un fichero existente. */
  touch(path: string, mtimeMs: number): void {
    const existing = this.existingFile(path);
    this.entries.set(posix.normalize(path), { ...existing, kind: 'file', mtimeMs });
  }

  private tick(): number {
    this.clock += 1;
    return this.clock;
  }

  /* ---- lectura (FileSystem) ---- */

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
      return { kind: 'file', size: Buffer.byteLength(entry.content, 'utf8'), mtimeMs: entry.mtimeMs ?? 0 };
    }
    if (entry.kind === 'directory') {
      return { kind: 'directory', size: 0, mtimeMs: 0 };
    }
    return { kind: 'other', size: 0, mtimeMs: 0 };
  }

  async realPath(path: string): Promise<string> {
    return this.resolve(path).path;
  }

  async readTextFile(path: string): Promise<string> {
    return this.existingFile(path).content;
  }

  /* ---- escritura (WritableFileSystem) ---- */

  async mkdir(path: string): Promise<void> {
    this.check('mkdir', path);
    this.add(posix.join(path, '.keep'), { kind: 'directory' });
    this.entries.delete(posix.join(path, '.keep'));
  }

  async writeFile(path: string, content: string, mode: number): Promise<void> {
    this.check('writeFile', path);
    this.add(path, { kind: 'file', content, mode, mtimeMs: this.tick() });
  }

  async rename(from: string, to: string): Promise<void> {
    this.check('rename', from);
    const file = this.existingFile(from);
    this.entries.delete(posix.normalize(from));
    this.add(to, { ...file, kind: 'file' });
  }

  async chmod(path: string, mode: number): Promise<void> {
    this.check('chmod', path);
    this.entries.set(posix.normalize(path), { ...this.existingFile(path), kind: 'file', mode });
  }

  async readFile(path: string): Promise<string> {
    this.check('readFile', path);
    return this.existingFile(path).content;
  }

  async remove(path: string): Promise<void> {
    this.check('remove', path);
    this.entries.delete(posix.normalize(path));
  }
}

/** Dataset mínimo válido en memoria, ampliable con más ficheros. */
export function datasetTree(extra: Record<string, string | MemoryEntry> = {}): Record<string, string | MemoryEntry> {
  return {
    '/data/profile.md': '---\nfullName: Ada Ejemplo\n---\n\nResumen por defecto.\n',
    ...extra,
  };
}
