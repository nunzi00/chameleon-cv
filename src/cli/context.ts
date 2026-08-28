/**
 * Contexto de la CLI: todo lo que toca el exterior (salida, sistema de ficheros, directorio
 * de trabajo) se inyecta para que los comandos sean funciones testeables al 100 %.
 */
import { NodeWritableFileSystem, type WritableFileSystem } from '../artifact';
import { NodeFileSystem, defaultSourceParsers, type FileSystem, type SourceParser } from '../parsers';

export interface CliContext {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
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
    datasetFileSystem: new NodeFileSystem(),
    artifactFileSystem: new NodeWritableFileSystem(),
    parsers: defaultSourceParsers(),
  };
}
