/** Opciones de selección compartidas por los comandos del co-piloto (`improve`, `summarize`); la lógica vive en `src/app/copilot.ts`. */
import type { LimitOptions } from '../limits';

export interface SelectionOptions extends LimitOptions {
  readonly specialty?: string | undefined;
  readonly fromJobOffer?: string | undefined;
}
