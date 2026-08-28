import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';

import type { WritableFileSystem } from './writable-file-system';

/** Implementación real sobre `node:fs`. */
export class NodeWritableFileSystem implements WritableFileSystem {
  async mkdir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  writeFile(path: string, content: string, mode: number): Promise<void> {
    return writeFile(path, content, { encoding: 'utf8', mode });
  }

  rename(from: string, to: string): Promise<void> {
    return rename(from, to);
  }

  chmod(path: string, mode: number): Promise<void> {
    return chmod(path, mode);
  }

  readFile(path: string): Promise<string> {
    return readFile(path, 'utf8');
  }

  remove(path: string): Promise<void> {
    return rm(path, { force: true });
  }
}
