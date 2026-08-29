/** De un fallo (ApiError, NetworkError u otro) a lo que ve el usuario: título, detalle, líneas y qué hacer. */
import { ApiError, NetworkError } from './api/client';

export type ErrorKind = 'session' | 'conflict' | 'data' | 'network' | 'forbidden' | 'other';

export interface ExplainedError {
  readonly kind: ErrorKind;
  readonly title: string;
  readonly detail: string;
  readonly lines: readonly string[];
}

const TITLES: Readonly<Record<string, { readonly kind: ErrorKind; readonly title: string }>> = {
  unauthorized: { kind: 'session', title: 'La sesión no es válida' },
  conflict: { kind: 'conflict', title: 'El fichero cambió desde que lo abriste' },
  'precondition-required': { kind: 'conflict', title: 'Falta la huella del fichero' },
  'invalid-data': { kind: 'data', title: 'Los datos no son válidos' },
  'unsafe-path': { kind: 'data', title: 'Identificador no admitido' },
  'bad-request': { kind: 'data', title: 'Petición mal formada' },
  usage: { kind: 'data', title: 'Opciones incompatibles' },
  'not-found': { kind: 'data', title: 'No existe' },
  'payload-too-large': { kind: 'data', title: 'Demasiado grande' },
  'remote-disabled': { kind: 'forbidden', title: 'Los proveedores remotos están desactivados' },
  'consent-required': { kind: 'forbidden', title: 'Hace falta confirmar el coste' },
  environment: { kind: 'other', title: 'Fallo del entorno' },
};

export function explainError(error: unknown): ExplainedError {
  if (error instanceof NetworkError) {
    return { kind: 'network', title: 'Sin conexión con cv serve', detail: error.message, lines: [] };
  }
  if (error instanceof ApiError) {
    const known = TITLES[error.code] ?? { kind: 'other' as const, title: `Error ${error.status}` };
    return { kind: known.kind, title: known.title, detail: error.message, lines: error.lines };
  }
  return { kind: 'other', title: 'Error inesperado', detail: error instanceof Error ? error.message : String(error), lines: [] };
}
