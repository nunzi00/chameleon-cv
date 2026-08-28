import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Plantilla base, resuelta desde la raíz del paquete (vale para `src/` con ts-node y para `dist/`). */
export const BASE_TEMPLATE_PATH = resolve(__dirname, '..', '..', '..', 'templates', 'cv.md.hbs');

export function loadBaseTemplate(): string {
  return readFileSync(BASE_TEMPLATE_PATH, 'utf8');
}
