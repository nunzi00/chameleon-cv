/**
 * Contexto de la CLI: el `AppContext` de los casos de uso (T-7.4a) más la terminal —salida, entrada
 * estándar y confirmación interactiva—, todo inyectado para que los comandos sean funciones testeables
 * al 100 %.
 */
import { NodeWritableFileSystem } from '../artifact';
import type { AppContext } from '../app/context';
import { NodeFileSystem, defaultSourceParsers } from '../parsers';
import { DEFAULT_PDF_LIMITS, createWorkerRunner, extractPdfText, workerSource } from '../pdf';
import { renderTypstCv } from '../renderers/typst';
import { installTypst, typstStatus } from '../typst';
import { createNodeLlmCache, llmStatus, selectProvider } from '../llm';
import { defaultAssets } from '../shared/assets';
import { readStdin } from './stdin';

export type { LlmProviderResult, LlmStatusReporter, TypstInstaller, TypstRenderer, TypstStatusReporter } from '../app/context';

export interface CliContext extends AppContext {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Lee toda la entrada estándar (para la oferta con «-»). */
  readonly stdin: () => Promise<string>;
  /** Confirmación interactiva (terminal): ausente cuando no hay TTY. */
  readonly confirm?: ((question: string) => Promise<boolean>) | undefined;
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
