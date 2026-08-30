/**
 * `cv history [--json]`, `cv history show <entrada> <ruta>` y `cv history restore <entrada> <ruta>` (T-8.10):
 * el histórico de versiones de las fuentes que deja `cv improve apply` (y cada restauración).
 */
import { describeSourceHistory, readSourceHistory, readSourceVersion, restoreSourceVersion } from '../../app/source-history';
import type { CliContext } from '../context';
import { EXIT_OK, reportError } from '../output';

export interface HistoryOptions {
  readonly json?: boolean | undefined;
}

export async function runHistoryList(context: CliContext, options: HistoryOptions = {}): Promise<number> {
  const entries = await readSourceHistory(context);
  context.stdout(options.json === true ? `${JSON.stringify({ entries }, null, 2)}\n` : describeSourceHistory(entries));
  return EXIT_OK;
}

export async function runHistoryShow(context: CliContext, entry: string, path: string): Promise<number> {
  const version = await readSourceVersion(context, entry, path);
  if (!version.ok) {
    return reportError(context, version.error);
  }
  context.stdout(version.content);
  return EXIT_OK;
}

export async function runHistoryRestore(context: CliContext, entry: string, path: string): Promise<number> {
  const restored = await restoreSourceVersion(context, entry, path, context.now?.());
  if (!restored.ok) {
    return reportError(context, restored.error);
  }
  context.stdout(`Restaurado ${restored.path} desde la entrada ${entry}; la versión que había queda en el histórico como ${restored.entry.id}\n`);
  return EXIT_OK;
}
