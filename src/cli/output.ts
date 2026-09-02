import { errorLines, type AppError } from '../app/errors';
import type { AppWarning } from '../app/freshness';
import type { CliContext } from './context';

export { formatDatasetError, pluralize, profileSummary } from '../app/text';
import { defaultQuotaLedger, describeQuotaSnapshot, isRemoteProviderId, type LlmProvider } from '../llm';

/** Códigos de salida de `cv`. */
export const EXIT_OK = 0;
/** Los datos tienen problemas (dataset o artefacto inválidos). */
export const EXIT_DATA_ERROR = 1;
/** Uso incorrecto o fallo inesperado del entorno (permisos, disco…). */
export const EXIT_FAILURE = 2;

/**
 * Una tabla de texto con las columnas ajustadas a su contenido. `numeric` dice a partir de qué columna se
 * alinea a la derecha, que es lo que hace legible una columna de recuentos.
 */
export function formatTable(header: readonly string[], rows: ReadonlyArray<readonly string[]>, numeric = header.length): string {
  const widths = header.map((title, column) => rows.reduce((max, row) => Math.max(max, (row[column] ?? '').length), title.length));
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, column) => (column >= numeric ? cell.padStart(widths[column]!) : cell.padEnd(widths[column]!)))
      .join('  ')
      .trimEnd();
  return [header, ...rows].map((row) => `${line(row)}\n`).join('');
}

/** Imprime un error de la capa de casos de uso en stderr, línea a línea, y devuelve su código de salida. */
export function reportError(context: Pick<CliContext, 'stderr'>, error: AppError): number {
  for (const line of errorLines(error)) {
    context.stderr(`${line}\n`);
  }
  return error.exitCode;
}

/** El texto de un aviso, tal como lo imprime la CLI. */
export function formatWarning(warning: AppWarning): string {
  switch (warning.kind) {
    case 'stale-artifact':
      return `Aviso: ${warning.newestSource} es más reciente que el artefacto; ejecuta «cv build» para regenerarlo\n`;
    case 'freshness-unknown':
      return `Aviso: no se pudo comprobar si el artefacto está al día (${warning.reason})\n`;
    case 'items-truncated':
      return `Aviso: ${warning.total} logros superan el máximo por ejecución (${warning.kept}); se procesan los ${warning.kept} primeros (--max-items o --only para elegir)\n`;
    case 'offer-without-requirements':
      return `Aviso: la oferta tiene ${warning.words} palabras pero solo se reconocen ${warning.recognized} requisitos; puede que los suyos estén en otra página${warning.link === undefined ? '' : ` (${warning.link})`}. La adecuación de abajo se calcula sobre lo poco que declara.\n`;
    case 'history-unwritable':
      return `Aviso: no se pudo anotar la oferta en el historial (output/historial-ofertas.json): ${warning.message}\n`;
    case 'unknown-selection':
      return `Aviso: ${warning.section === 'skills' ? 'skills' : 'proyectos'} no encontrados en el perfil (se ignoran): ${warning.names.join(', ')}\n`;
  }
}

export function reportWarnings(context: Pick<CliContext, 'stderr'>, warnings: readonly AppWarning[]): void {
  for (const warning of warnings) {
    context.stderr(formatWarning(warning));
  }
}

/** Tras un trabajo con un remoto: la cuota que el proveedor devolvió en sus cabeceras (T-8.2); nunca una llamada extra. */
export function reportQuota(context: Pick<CliContext, 'stderr'>, provider: Pick<LlmProvider, 'id' | 'kind'>): void {
  if (provider.kind !== 'remote' || !isRemoteProviderId(provider.id)) {
    return;
  }
  const snapshot = defaultQuotaLedger.get(provider.id);
  if (snapshot !== undefined) {
    context.stderr(`Cuota según ${provider.id}: ${describeQuotaSnapshot(snapshot)}\n`);
  }
}
