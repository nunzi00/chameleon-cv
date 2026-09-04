/**
 * Contexto de la CLI: el `AppContext` de los casos de uso (T-7.4a) más la terminal —salida, entrada
 * estándar y confirmación interactiva—, todo inyectado para que los comandos sean funciones testeables
 * al 100 %.
 */
import { NodeWritableFileSystem } from '../artifact';
import type { AppContext } from '../app/context';
import { loadLlmSettings } from '../app/settings';
import { NodeFileSystem, defaultSourceParsers } from '../parsers';
import { DEFAULT_PDF_LIMITS, createWorkerRunner, extractPdfText, workerSource } from '../pdf';
import { createItemsRunner, extractItems, itemsWorkerSource } from '../import/items';
import { renderTypstCv } from '../renderers/typst';
import { installTypst, typstStatus } from '../typst';
import { createLlmRuntime, createNodeLlmCache, llmStatus, runtimeConfiguration, selectProvider, type LlmStatusOptions } from '../llm';
import { createNodeRuntimeSystem } from '../llm/runtime-node';
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
  /** Pregunta un secreto sin eco (terminal): ausente cuando no hay TTY; entonces se lee de la entrada estándar. */
  readonly readSecret?: ((question: string) => Promise<string>) | undefined;
}

export interface NodeContextOptions {
  /** Si hay terminal interactiva se instala `confirm` (preguntas s/N); por defecto, si stdin es un TTY. */
  readonly interactive?: boolean | undefined;
}

export function createNodeContext(options: NodeContextOptions = {}): CliContext {
  const interactive = options.interactive ?? process.stdin.isTTY === true; // el tipo dice boolean, pero en una tubería es undefined
  const assets = defaultAssets();
  const datasetFileSystem = new NodeFileSystem();
  const cwd = process.cwd();
  /**
   * Lo que depende de la RAÍZ, agrupado para poder rehacerlo al elegir usuario (T-9.32): la tabla `[llm]`
   * de `cv.toml` —leída en cada orden (T-8.2), con la de la raíz compartida debajo— y el runtime local.
   */
  const rooted = (root: string, shared: string | undefined): Pick<CliContext, 'llmStatus' | 'llmProvider' | 'llmRuntime'> => {
    const settings = async (): Promise<Pick<LlmStatusOptions, 'settings' | 'settingsError' | 'settingsPath' | 'settingsPresent'>> => {
      const snapshot = await loadLlmSettings(root, datasetFileSystem, shared);
      return { settings: snapshot.settings, settingsError: snapshot.error, settingsPath: snapshot.path, settingsPresent: snapshot.present };
    };
    return {
      llmStatus: async (statusOptions) => llmStatus({ ...statusOptions, ...(await settings()) }),
      llmProvider: async (selection) => selectProvider(selection, await settings()),
      llmRuntime: createLlmRuntime(async () => runtimeConfiguration(process.env, await settings()), createNodeRuntimeSystem({ cwd: root })),
    };
  };
  return {
    cwd,
    withWorkspace: (root, shared) => rooted(root, shared),
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
    stdin: readStdin,
    datasetFileSystem,
    artifactFileSystem: new NodeWritableFileSystem(),
    parsers: defaultSourceParsers(),
    pdfExtractor: async (bytes) => extractPdfText(bytes, DEFAULT_PDF_LIMITS, createWorkerRunner(await workerSource(assets))),
    itemsExtractor: async (bytes) => extractItems(bytes, DEFAULT_PDF_LIMITS, createItemsRunner(await itemsWorkerSource(assets))),
    typstRenderer: (profile, options) => renderTypstCv(profile, options),
    typstInstall: (options, report) => installTypst(options, report),
    typstStatus: (options) => typstStatus(options),
    ...rooted(cwd, undefined),
    ...(interactive ? { confirm: askInTerminal, readSecret: askSecretInTerminal } : {}),
    llmCache: createNodeLlmCache(),
    assets,
  };
}

/**
 * Pregunta un secreto en la terminal sin mostrarlo; solo se instala cuando stdin es un TTY. Lee la entrada en
 * modo *raw* (sin eco del terminal) carácter a carácter hasta Intro; Retroceso borra, Ctrl-C/Ctrl-D cancelan
 * (clave vacía). Sin TTY (pruebas, tuberías) lee igual, hasta el primer salto de línea.
 */
export function askSecretInTerminal(question: string, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stderr): Promise<string> {
  return new Promise((resolve) => {
    const tty = input as NodeJS.ReadableStream & { readonly isTTY?: boolean; setRawMode?: (mode: boolean) => unknown; pause?: () => unknown; resume?: () => unknown };
    const raw = tty.isTTY === true && typeof tty.setRawMode === 'function';
    if (raw) {
      tty.setRawMode?.(true);
    }
    output.write(question);
    let buffer = '';
    const finish = (value: string): void => {
      input.removeListener('data', onData);
      if (raw) {
        tty.setRawMode?.(false);
      }
      tty.pause?.();
      output.write('\n');
      resolve(value.trim());
    };
    const onData = (chunk: Buffer | string): void => {
      for (const char of chunk.toString()) {
        if (char === '\r' || char === '\n') {
          finish(buffer);
          return;
        }
        if (char === '\u0003' || char === '\u0004') {
          finish('');
          return;
        }
        if (char === '\u007f' || char === '\b') {
          buffer = buffer.slice(0, -1);
          continue;
        }
        buffer += char;
      }
    };
    input.on('data', onData);
    tty.resume?.();
  });
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
