import type { MasterProfileInput, SchemaPath } from '../../core/schema';

/** Fichero fuente ya leído. `path` es relativa a la raíz del dataset, con `/` como separador. */
export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

/** Problema detectado al cargar el dataset, localizado por fichero y, cuando se conoce, línea. */
export interface DatasetError {
  readonly file: string;
  readonly line?: number | undefined;
  readonly message: string;
}

/** Origen (fichero y línea) de un valor del perfil, identificado por su ruta en el esquema. */
export interface Provenance {
  readonly path: SchemaPath;
  readonly file: string;
  readonly line?: number | undefined;
}

/** Parte del perfil que aporta un fichero. Entre ficheros, los arrays se concatenan y los objetos se fusionan. */
export type ProfileContribution = Partial<MasterProfileInput>;

export type ParseResult =
  | { readonly ok: true; readonly contribution: ProfileContribution; readonly provenance: readonly Provenance[] }
  | { readonly ok: false; readonly errors: readonly DatasetError[] };

/** Contrato de un parser de fuentes (plugin). Debe ser puro: sin disco ni red. */
export interface SourceParser {
  readonly name: string;
  /** Extensiones que atiende, con punto (`.md`). El cargador despacha por extensión. */
  readonly extensions: readonly string[];
  parse(file: SourceFile): ParseResult;
}
