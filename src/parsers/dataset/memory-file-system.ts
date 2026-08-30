/**
 * Sistema de ficheros de solo lectura en memoria (T-8.1): permite pasar por el cargador real unas fuentes
 * que todavía no están en disco —el auto-chequeo de `cv import` analiza el plan antes de escribirlo—.
 * Rutas POSIX bajo una raíz fija; sin enlaces simbólicos.
 */
import { posix } from 'node:path';

import type { DirectoryEntry, FileStat, FileSystem } from './file-system';

export class MemorySourceTree implements FileSystem {
  private readonly files = new Map<string, string>();
  private readonly directories = new Set<string>();
  readonly root: string;

  /** `files`: ruta relativa a `root` → contenido. */
  constructor(root: string, files: ReadonlyMap<string, string> | Readonly<Record<string, string>>) {
    this.root = root;
    this.directories.add(root);
    const entries = files instanceof Map ? [...files.entries()] : Object.entries(files);
    for (const [path, content] of entries) {
      const absolute = posix.join(root, path);
      this.files.set(absolute, content);
      let parent = posix.dirname(absolute);
      while (parent !== root && parent !== '/') {
        this.directories.add(parent);
        parent = posix.dirname(parent);
      }
    }
  }

  private missing(path: string): Error {
    return Object.assign(new Error(`ENOENT: no such file or directory, ${path}`), { code: 'ENOENT' });
  }

  async readDirectory(path: string): Promise<readonly DirectoryEntry[]> {
    const directory = posix.normalize(path);
    if (!this.directories.has(directory)) {
      throw this.missing(path);
    }
    const prefix = directory === '/' ? '/' : `${directory}/`;
    const names = new Map<string, DirectoryEntry['kind']>();
    for (const file of this.files.keys()) {
      if (file.startsWith(prefix) && !file.slice(prefix.length).includes('/')) {
        names.set(file.slice(prefix.length), 'file');
      }
    }
    for (const child of this.directories) {
      if (child !== directory && child.startsWith(prefix) && !child.slice(prefix.length).includes('/')) {
        names.set(child.slice(prefix.length), 'directory');
      }
    }
    return [...names.entries()].map(([name, kind]) => ({ name, kind }));
  }

  async stat(path: string): Promise<FileStat> {
    const normalized = posix.normalize(path);
    const content = this.files.get(normalized);
    if (content !== undefined) {
      return { kind: 'file', size: Buffer.byteLength(content, 'utf8'), mtimeMs: 0 };
    }
    if (this.directories.has(normalized)) {
      return { kind: 'directory', size: 0, mtimeMs: 0 };
    }
    throw this.missing(path);
  }

  async realPath(path: string): Promise<string> {
    const normalized = posix.normalize(path);
    if (!this.files.has(normalized) && !this.directories.has(normalized)) {
      throw this.missing(path);
    }
    return normalized;
  }

  async readTextFile(path: string): Promise<string> {
    const content = this.files.get(posix.normalize(path));
    if (content === undefined) {
      throw this.missing(path);
    }
    return content;
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    return Buffer.from(await this.readTextFile(path), 'utf8');
  }
}
