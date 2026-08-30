import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { readVersion } from '../app/workspace';

export { readVersion } from '../app/workspace';

/** `package.json` de la raíz del paquete (vale desde `src/` y desde `dist/`). */
export const PACKAGE_JSON_PATH = resolve(__dirname, '..', '..', 'package.json');

/**
 * Solo para pruebas y guiones que corren desde el repositorio. El producto lee la versión de los assets
 * (`readVersion(await context.assets.text('package.json'))`): en el ejecutable publicado no hay package.json
 * en disco y esta ruta no existe (defecto de la 1.6.0 en `cv theme install`, corregido en la 1.6.1).
 */
export function packageVersion(): string {
  return readVersion(readFileSync(PACKAGE_JSON_PATH, 'utf8'));
}
