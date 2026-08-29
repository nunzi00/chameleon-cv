import type { AppContext } from '../../src/app';
import { MemoryLlmCache, llmStatus } from '../../src/llm';
import { defaultSourceParsers } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import { renderTypstCv } from '../../src/renderers/typst';
import { defaultAssets } from '../../src/shared/assets';
import { installTypst, typstStatus } from '../../src/typst';
import type { MemoryFileSystem } from './memory-file-system';

/** Un `AppContext` sobre un disco en memoria, sin terminal: lo que ve un caso de uso desde cualquier cliente. */
export function appContext(fs: MemoryFileSystem, overrides: Partial<AppContext> = {}): AppContext {
  return {
    cwd: '/work',
    datasetFileSystem: fs,
    artifactFileSystem: fs,
    parsers: defaultSourceParsers(),
    pdfExtractor: (bytes) => extractPdfText(bytes),
    typstRenderer: (profile, options) => renderTypstCv(profile, options),
    typstInstall: (options, report) => installTypst(options, report),
    typstStatus: (options) => typstStatus(options),
    llmStatus: (options) => llmStatus(options),
    llmProvider: () => Promise.resolve({ ok: false as const, message: 'sin proveedor en las pruebas' }),
    llmCache: new MemoryLlmCache(),
    assets: defaultAssets(),
    ...overrides,
  };
}
