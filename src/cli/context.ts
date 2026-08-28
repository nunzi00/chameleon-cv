/**
 * Contexto de la CLI: todo lo que toca el exterior (salida, sistema de ficheros, directorio
 * de trabajo, extracción de PDF) se inyecta para que los comandos sean funciones testeables al 100 %.
 */
import { NodeWritableFileSystem, type WritableFileSystem } from '../artifact';
import type { MasterProfile } from '../core/schema';
import { NodeFileSystem, defaultSourceParsers, type FileSystem, type SourceParser } from '../parsers';
import { extractPdfText, type PdfExtractionResult } from '../pdf';
import { renderTypstCv, type TypstRenderOptions, type TypstRenderResult } from '../renderers/typst';
import { installTypst, typstStatus, type InstallOptions, type InstallResult, type Reporter, type StatusOptions, type TypstStatus } from '../typst';
import { createNodeLlmCache, createProvider, llmStatus, resolveLlmConfig, type LlmCacheStore, type LlmProvider, type LlmStatus, type LlmStatusOptions } from '../llm';
import { readStdin } from './stdin';

export type TypstRenderer = (profile: MasterProfile, options: TypstRenderOptions) => Promise<TypstRenderResult>;
export type TypstInstaller = (options: InstallOptions, report: Reporter) => Promise<InstallResult>;
export type TypstStatusReporter = (options: StatusOptions) => Promise<TypstStatus>;
export type LlmStatusReporter = (options: LlmStatusOptions) => Promise<LlmStatus>;
export type LlmProviderResult = { readonly ok: true; readonly provider: LlmProvider } | { readonly ok: false; readonly message: string };

export interface CliContext {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Lee toda la entrada estándar (para la oferta con «-»). */
  readonly stdin: () => Promise<string>;
  readonly datasetFileSystem: FileSystem;
  readonly artifactFileSystem: WritableFileSystem;
  readonly parsers: readonly SourceParser[];
  /** Extrae el texto de una oferta en PDF (contenido en un worker). */
  readonly pdfExtractor: (bytes: Uint8Array) => Promise<PdfExtractionResult>;
  /** Renderiza con Typst (proceso hijo contenido); inyectable para probar la CLI sin binario. */
  readonly typstRenderer: TypstRenderer;
  /** `cv typst install`: la única operación de red; inyectable para probar la CLI sin red. */
  readonly typstInstall: TypstInstaller;
  /** `cv typst status`. */
  readonly typstStatus: TypstStatusReporter;
  /** `cv llm status` (T-4.2): nunca envía datos; solo comprueba el proveedor local. */
  readonly llmStatus: LlmStatusReporter;
  /** Proveedor de modelos configurado (T-4.3); inyectable para probar `cv improve` sin modelo. */
  readonly llmProvider: () => LlmProviderResult;
  /** Caché local de respuestas del co-piloto. */
  readonly llmCache: LlmCacheStore;
  /** Reloj (por defecto, el del sistema): fechas de los ficheros de revisión. */
  readonly now?: (() => Date) | undefined;
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
    pdfExtractor: (bytes) => extractPdfText(bytes),
    typstRenderer: (profile, options) => renderTypstCv(profile, options),
    typstInstall: (options, report) => installTypst(options, report),
    typstStatus: (options) => typstStatus(options),
    llmStatus: (options) => llmStatus(options),
    llmProvider: () => {
      const config = resolveLlmConfig();
      return config.ok ? { ok: true, provider: createProvider(config.config) } : { ok: false, message: config.message };
    },
    llmCache: createNodeLlmCache(),
  };
}
