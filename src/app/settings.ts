/**
 * La configuración del co-piloto en `cv.toml` vista desde la capa de casos de uso (T-8.2): leerla para
 * la selección del proveedor y el estado, y componer el fichero nuevo con la tabla `[llm]` sustituida
 * quirúrgicamente y **comprobada** (se vuelve a analizar entera antes de darla por buena).
 */
import { resolve } from 'node:path';

import { replaceLlmTable, type LlmSettings } from '../llm/settings';
import type { FileSystem } from '../parsers';
import { PROJECT_CONFIG_FILE, loadProjectConfig, parseProjectConfig } from '../themes/project-config';

export interface LlmSettingsSnapshot {
  /** Ruta absoluta de `cv.toml` (exista o no). */
  readonly path: string;
  /** `undefined` si no hay fichero o no tiene `[llm]`. */
  readonly settings: LlmSettings | undefined;
  /** Hay `cv.toml`. */
  readonly present: boolean;
  /** `cv.toml` existe pero no es válido: se explica y no se usa. */
  readonly error: string | undefined;
}

/** `[llm]` de `<cwd>/cv.toml`; la ausencia del fichero o de la tabla no es un error. */
export async function loadLlmSettings(cwd: string, fileSystem: FileSystem): Promise<LlmSettingsSnapshot> {
  const loaded = await loadProjectConfig(cwd, fileSystem);
  if (!loaded.ok) {
    return { path: loaded.path, settings: undefined, present: true, error: loaded.message };
  }
  return { path: loaded.path, settings: loaded.config?.llm, present: loaded.config !== undefined, error: undefined };
}

export type RenderedSettings = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly message: string };

/**
 * El texto de `cv.toml` con la tabla `[llm]` sustituida (o añadida), comprobado: si el resultado no
 * vuelve a analizarse como configuración válida (p. ej. claves `llm.*` sueltas fuera de la tabla que
 * quedarían duplicadas), no se escribe y se explica.
 */
export function renderLlmSettings(currentText: string | undefined, settings: LlmSettings): RenderedSettings {
  const text = replaceLlmTable(currentText ?? '', settings);
  const parsed = parseProjectConfig(text);
  if (!parsed.ok) {
    return { ok: false, message: `El ${PROJECT_CONFIG_FILE} resultante no sería válido; no se escribe nada:\n${parsed.errors.map((error) => `  - ${error}`).join('\n')}` };
  }
  return { ok: true, text };
}

export function projectConfigPath(cwd: string): string {
  return resolve(cwd, PROJECT_CONFIG_FILE);
}
