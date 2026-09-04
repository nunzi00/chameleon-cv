/**
 * Errores tipificados de los casos de uso (docs/api-headless.md §3): cada cliente los traduce a lo suyo.
 * La CLI imprime `lines` (o `message`) y devuelve `exitCode`; el servidor HTTP mapea `code` a un estado.
 */
export type AppErrorCode = 'usage' | 'invalid-data' | 'not-found' | 'conflict' | 'environment' | 'unsafe-path';

/** Código de salida de la CLI: 1 = los datos tienen problemas; 2 = uso incorrecto o fallo del entorno. */
export type ExitCode = 1 | 2;

export interface AppError {
  readonly code: AppErrorCode;
  /** Mensaje principal (una línea, o varias en el caso de un diagnóstico de Typst). */
  readonly message: string;
  /** Si está, es la salida completa que la CLI imprime (una línea por elemento) en lugar de `message`. */
  readonly lines?: readonly string[] | undefined;
  readonly exitCode: ExitCode;
}

export function dataError(message: string, lines?: readonly string[]): AppError {
  return { code: 'invalid-data', message, lines, exitCode: 1 };
}

export function environmentError(message: string): AppError {
  return { code: 'environment', message, exitCode: 2 };
}

export function notFoundError(message: string): AppError {
  return { code: 'not-found', message, exitCode: 2 };
}

export function conflictError(message: string, exitCode: ExitCode = 1): AppError {
  return { code: 'conflict', message, exitCode };
}

/** Falta algo que solo puede decidir quien llama (p. ej. con qué usuario se trabaja); no son datos malos. */
export function usageError(message: string, lines?: readonly string[]): AppError {
  return { code: 'usage', message, lines, exitCode: 2 };
}

export function unsafePathError(message: string): AppError {
  return { code: 'unsafe-path', message, exitCode: 2 };
}

/** Un error del entorno (2) o de datos (1) según el código de salida que ya conoce el llamador. */
export function errorWithExit(message: string, exitCode: ExitCode): AppError {
  return exitCode === 1 ? dataError(message) : environmentError(message);
}

/** Lo que la CLI imprime en stderr, línea a línea. */
export function errorLines(error: AppError): readonly string[] {
  return error.lines ?? [error.message];
}
