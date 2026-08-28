import type { WritableFileSystem } from '../../src/artifact/writable-file-system';

export type WritableOperation = 'mkdir' | 'writeFile' | 'rename' | 'chmod' | 'readFile' | 'remove';

/** Sistema de ficheros de escritura en memoria, con inyección de fallos por operación. */
export class MemoryWritableFileSystem implements WritableFileSystem {
  readonly files = new Map<string, { content: string; mode: number }>();
  readonly directories = new Set<string>();
  readonly failures = new Set<WritableOperation>();
  readonly log: string[] = [];

  private check(operation: WritableOperation, path: string): void {
    this.log.push(`${operation} ${path}`);
    if (this.failures.has(operation)) {
      throw new Error(`fallo simulado en ${operation}`);
    }
  }

  private existing(path: string): { content: string; mode: number } {
    const file = this.files.get(path);
    if (file === undefined) {
      throw Object.assign(new Error(`ENOENT: no such file, ${path}`), { code: 'ENOENT' });
    }
    return file;
  }

  async mkdir(path: string): Promise<void> {
    this.check('mkdir', path);
    this.directories.add(path);
  }

  async writeFile(path: string, content: string, mode: number): Promise<void> {
    this.check('writeFile', path);
    this.files.set(path, { content, mode });
  }

  async rename(from: string, to: string): Promise<void> {
    this.check('rename', from);
    const file = this.existing(from);
    this.files.delete(from);
    this.files.set(to, file);
  }

  async chmod(path: string, mode: number): Promise<void> {
    this.check('chmod', path);
    this.files.set(path, { ...this.existing(path), mode });
  }

  async readFile(path: string): Promise<string> {
    this.check('readFile', path);
    return this.existing(path).content;
  }

  async remove(path: string): Promise<void> {
    this.check('remove', path);
    this.files.delete(path);
  }
}
