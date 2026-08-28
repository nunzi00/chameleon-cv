/** Tipo de una entrada de directorio **sin** seguir enlaces simbólicos. */
export type EntryKind = 'file' | 'directory' | 'symlink' | 'other';

export interface DirectoryEntry {
  readonly name: string;
  readonly kind: EntryKind;
}

/** Información de un fichero **siguiendo** enlaces simbólicos. */
export interface FileStat {
  readonly kind: 'file' | 'directory' | 'other';
  readonly size: number;
  /** Última modificación en milisegundos desde la época (para comprobar la frescura del artefacto). */
  readonly mtimeMs: number;
}

/**
 * Mínimo sistema de ficheros que necesita el cargador del dataset. Se inyecta para que
 * la lógica sea testeable sin disco; `NodeFileSystem` es la implementación real.
 */
export interface FileSystem {
  readDirectory(path: string): Promise<readonly DirectoryEntry[]>;
  stat(path: string): Promise<FileStat>;
  realPath(path: string): Promise<string>;
  readTextFile(path: string): Promise<string>;
  /** Contenido binario (ofertas en PDF). */
  readBinaryFile(path: string): Promise<Uint8Array>;
}
