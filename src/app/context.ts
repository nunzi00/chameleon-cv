/**
 * Contexto de los casos de uso (T-7.4a, docs/api-headless.md §3): todo lo que la lógica de aplicación
 * necesita del exterior —sistemas de ficheros, parsers, extractor de PDF, Typst, proveedor de modelos,
 * caché, reloj y assets— inyectable y **sin terminal**. `CliContext` lo extiende con stdout, stderr,
 * stdin y confirm; el servidor HTTP lo construye una vez por espacio de trabajo.
 */
import type { WritableFileSystem } from '../artifact';
import type { MasterProfile } from '../core/schema';
import type { LlmCacheStore, LlmStatus, LlmStatusOptions, ProviderSelection, ProviderSelectionResult } from '../llm';
import type { FileSystem, SourceParser } from '../parsers';
import type { PdfExtractionResult } from '../pdf';
import type { TypstRenderOptions, TypstRenderResult } from '../renderers/typst';
import type { AssetStore } from '../shared/assets';
import type { Fetcher, InstallOptions, InstallResult, Reporter, StatusOptions, TypstStatus } from '../typst';

export type TypstRenderer = (profile: MasterProfile, options: TypstRenderOptions) => Promise<TypstRenderResult>;
export type TypstInstaller = (options: InstallOptions, report: Reporter) => Promise<InstallResult>;
export type TypstStatusReporter = (options: StatusOptions) => Promise<TypstStatus>;
export type LlmStatusReporter = (options: LlmStatusOptions) => Promise<LlmStatus>;
export type LlmProviderResult = ProviderSelectionResult;

export interface AppContext {
  readonly cwd: string;
  readonly datasetFileSystem: FileSystem;
  readonly artifactFileSystem: WritableFileSystem;
  readonly parsers: readonly SourceParser[];
  /** Extrae el texto de una oferta en PDF (contenido en un worker). */
  readonly pdfExtractor: (bytes: Uint8Array) => Promise<PdfExtractionResult>;
  /** Renderiza con Typst (proceso hijo contenido); inyectable para probar sin binario. */
  readonly typstRenderer: TypstRenderer;
  /** `cv typst install`: la única operación de red; inyectable para probar sin red. */
  readonly typstInstall: TypstInstaller;
  /** `cv typst status`. */
  readonly typstStatus: TypstStatusReporter;
  /** Estado del proveedor local (T-4.2): nunca envía datos. */
  readonly llmStatus: LlmStatusReporter;
  /** Proveedor de modelos (T-4.3/T-4.5): local por defecto, remoto solo con `--provider` explícito; inyectable. */
  readonly llmProvider: (selection: ProviderSelection) => Promise<LlmProviderResult>;
  /** Caché local de respuestas del co-piloto. */
  readonly llmCache: LlmCacheStore;
  /** Reloj (por defecto, el del sistema): fechas de los ficheros de revisión. */
  readonly now?: (() => Date) | undefined;
  /** Descarga de archivos de temas (T-8.3); inyectable en las pruebas. Por defecto, `fetch` de Node. */
  readonly fetcher?: Fetcher | undefined;
  /** Assets distribuidos (temas, fuentes, plantilla, dataset de ejemplo, prompts, package.json): repositorio o binario (T-6.2). */
  readonly assets: AssetStore;
}
