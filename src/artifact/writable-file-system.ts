/**
 * Sistema de ficheros con escritura, solo para el artefacto canónico. Se mantiene separado del
 * `FileSystem` de lectura del dataset: los parsers no pueden escribir por construcción.
 */
export interface WritableFileSystem {
  /** Crea el directorio y sus padres si no existen. */
  mkdir(path: string): Promise<void>;
  writeFile(path: string, content: string, mode: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  readFile(path: string): Promise<string>;
  /** Borra el fichero si existe; no falla si no existe. */
  remove(path: string): Promise<void>;
}
