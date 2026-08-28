import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** `package.json` de la raíz del paquete (vale desde `src/` y desde `dist/`). */
export const PACKAGE_JSON_PATH = resolve(__dirname, '..', '..', 'package.json');

/** Versión declarada en `package.json`, o `0.0.0` si el fichero no la trae como texto. */
export function readVersion(source: string): string {
  const parsed: unknown = JSON.parse(source);
  if (typeof parsed === 'object' && parsed !== null && 'version' in parsed && typeof parsed.version === 'string') {
    return parsed.version;
  }
  return '0.0.0';
}

export function packageVersion(): string {
  return readVersion(readFileSync(PACKAGE_JSON_PATH, 'utf8'));
}
