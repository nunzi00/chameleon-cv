/**
 * Lectura de la entrada estándar del proceso. Es cableado de I/O (como `src/index.ts`): queda
 * fuera del umbral de cobertura; la lógica reutilizable (`readStream`) vive en `offer.ts`.
 */
import { readStream } from './offer';

export function readStdin(): Promise<string> {
  return readStream(process.stdin);
}
