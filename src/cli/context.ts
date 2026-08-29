/**
 * Contexto de la CLI: todo lo que toca el exterior (salida, sistema de ficheros, directorio
 * de trabajo, extracción de PDF) se inyecta para que los comandos sean funciones testeables al 100 %.
 */
import { NodeWritableFileSystem, type WritableFileSystem } from '../artifact';
import type { MasterProfile } from '../core/schema';
import { NodeFileSystem, defaultSourceParsers, type FileSystem, type SourceParser } from '../parsers';
import { DEFAULT_PDF_LIMITS, createWorkerRunner, extractPdfText, workerSource, type PdfExtractionResult } from '../pdf';
import { renderTypstCv, type TypstRenderOptions, type TypstRenderResult } from '../renderers/typst';
import { installTypst, typstStatus, type InstallOptions, type InstallResult, type Reporter, type StatusOptions, type TypstStatus } from '../typst';
import { createNodeLlmCache, llmStatus, selectProvider, type LlmCacheStore, type LlmStatus, type LlmStatusOptions, type ProviderSelection, type ProviderSelectionResult } from '../llm';
import { defaultAssets, type AssetStore } from '../shared/assets';
import { readStdin } from './stdin';

export type TypstRenderer = (profile: MasterProfile, options: TypstRenderOptions) => Promise<TypstRenderResult>;
export type TypstInstaller = (options: InstallOptions, report: Reporter) => Promise<InstallResult>;
export type TypstStatusReporter = (options: StatusOptions) => Promise<TypstStatus>;
export type LlmStatusReporter = (options: LlmStatusOptions) => Promise<LlmStatus>;
export type LlmProviderResult = ProviderSelectionResult;

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
  /** Proveedor de modelos (T-4.3/T-4.5): local por defecto, remoto solo con `--provider` explícito; inyectable. */
  readonly llmProvider: (selection: ProviderSelection) => Promise<LlmProviderResult>;
  /** Confirmación interactiva (terminal): ausente cuando no hay TTY. */
  readonly confirm?: ((question: string) => Promise<boolean>) | undefined;
  /** Caché local de respuestas del co-piloto. */
  readonly llmCache: LlmCacheStore;
  /** Reloj (por defecto, el del sistema): fechas de los ficheros de revisión. */
  readonly now?: (() => Date) | undefined;
  /** Assets distribuidos (temas, fuentes, plantilla, dataset de ejemplo, prompts, package.json): repositorio o binario (T-6.2). */
  readonly assets: AssetStore;
}

export interface NodeContextOptions {
  /** Si hay terminal interactiva se instala `confirm` (preguntas s/N); por defecto, si stdin es un TTY. */
  readonly interactive?: boolean | undefined;
}

export function createNodeContext(options: NodeContextOptions = {}): CliContext {
  const interactive = options.interactive ?? process.stdin.isTTY === true;
  const assets = defaultAssets();
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
    pdfExtractor: async (bytes) => extractPdfText(bytes, DEFAULT_PDF_LIMITS, createWorkerRunner(await workerSource(assets))),
    typstRenderer: (profile, options) => renderTypstCv(profile, options),
    typstInstall: (options, report) => installTypst(options, report),
    typstStatus: (options) => typstStatus(options),
    llmStatus: (options) => llmStatus(options),
    llmProvider: (selection) => selectProvider(selection),
    ...(interactive ? { confirm: askInTerminal } : {}),
    llmCache: createNodeLlmCache(),
    assets,
  };
}

/** Pregunta sí/no en la terminal; solo se instala cuando stdin es un TTY. */
export async function askInTerminal(question: string, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stderr): Promise<boolean> {
  const { createInterface } = await import('node:readline/promises');
  const readline = createInterface({ input, output });
  try {
    const answer = (await readline.question(question)).trim().toLowerCase();
    return answer === 's' || answer === 'si' || answer === 'sí' || answer === 'y' || answer === 'yes';
  } finally {
    readline.close();
  }
}
