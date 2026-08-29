import { errorLines, type AppError } from '../app/errors';
import type { AppWarning } from '../app/freshness';
import type { CliContext } from './context';

export { formatDatasetError, pluralize, profileSummary } from '../app/text';

/** Códigos de salida de `cv`. */
export const EXIT_OK = 0;
/** Los datos tienen problemas (dataset o artefacto inválidos). */
export const EXIT_DATA_ERROR = 1;
/** Uso incorrecto o fallo inesperado del entorno (permisos, disco…). */
export const EXIT_FAILURE = 2;

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
  }
}

export function reportWarnings(context: Pick<CliContext, 'stderr'>, warnings: readonly AppWarning[]): void {
  for (const warning of warnings) {
    context.stderr(formatWarning(warning));
  }
}
