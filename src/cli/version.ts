import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { readVersion } from '../app/workspace';

export { readVersion } from '../app/workspace';

/** `package.json` de la raíz del paquete (vale desde `src/` y desde `dist/`). */
export const PACKAGE_JSON_PATH = resolve(__dirname, '..', '..', 'package.json');

export function packageVersion(): string {
  return readVersion(readFileSync(PACKAGE_JSON_PATH, 'utf8'));
}
