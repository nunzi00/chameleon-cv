/**
 * Contexto de la CLI: todo lo que toca el exterior (salida, sistema de ficheros, directorio
 * de trabajo) se inyecta para que los comandos sean funciones testeables al 100 %.
 */
import { NodeWritableFileSystem, type WritableFileSystem } from '../artifact';
import { NodeFileSystem, defaultSourceParsers, type FileSystem, type SourceParser } from '../parsers';
import { readStdin } from './stdin';

export interface CliContext {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Lee toda la entrada estándar (para la oferta con «-»). */
  readonly stdin: () => Promise<string>;
  readonly datasetFileSystem: FileSystem;
  readonly artifactFileSystem: WritableFileSystem;
  readonly parsers: readonly SourceParser[];
}

export function createNodeContext(): CliContext {
  return {
    cwd: process.cwd(),
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
    stdin: readStdin,
    datasetFileSystem: new NodeFileSystem(),
    artifactFileSystem: new NodeWritableFileSystem(),
    parsers: defaultSourceParsers(),
  };
}
