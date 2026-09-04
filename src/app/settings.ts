/**
 * La configuración del co-piloto en `cv.toml` vista desde la capa de casos de uso (T-8.2): leerla para
 * la selección del proveedor y el estado, y componer el fichero nuevo con la tabla `[llm]` sustituida
 * quirúrgicamente y **comprobada** (se vuelve a analizar entera antes de darla por buena).
 */
import { dirname, resolve } from 'node:path';

import { isMissingFile } from '../artifact';
import { describeError } from '../shared/errors';

import { replaceLlmTable, replaceServeTable, type LlmSettings, type ServeSettings } from '../llm/settings';
import type { FileSystem } from '../parsers';
import { PROJECT_CONFIG_FILE, loadProjectConfig, parseProjectConfig } from '../themes/project-config';
import type { AppContext } from './context';
import { conflictError, dataError, environmentError, type AppError } from './errors';
import { SOURCE_FILE_MODE, contentHash } from './sources';

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

/** `[llm]` de `<cwd>/cv.toml`, con el de la raíz compartida debajo (T-9.32); la ausencia no es un error. */
export async function loadLlmSettings(cwd: string, fileSystem: FileSystem, sharedRoot?: string | undefined): Promise<LlmSettingsSnapshot> {
  const loaded = await loadProjectConfig(cwd, fileSystem, sharedRoot);
  if (!loaded.ok) {
    return { path: loaded.path, settings: undefined, present: true, error: loaded.message };
  }
  return { path: loaded.path, settings: loaded.config?.llm, present: loaded.config !== undefined, error: undefined };
}

export interface ServeSettingsSnapshot {
  readonly path: string;
  /** `undefined` si no hay fichero o no tiene `[serve]`. */
  readonly settings: ServeSettings | undefined;
  readonly present: boolean;
  readonly error: string | undefined;
}

/** `[serve]` de `<cwd>/cv.toml`; la ausencia del fichero o de la tabla no es un error (T-8.17). */
export async function loadServeSettings(cwd: string, fileSystem: FileSystem, sharedRoot?: string | undefined): Promise<ServeSettingsSnapshot> {
  const loaded = await loadProjectConfig(cwd, fileSystem, sharedRoot);
  if (!loaded.ok) {
    return { path: loaded.path, settings: undefined, present: true, error: loaded.message };
  }
  return { path: loaded.path, settings: loaded.config?.serve, present: loaded.config !== undefined, error: undefined };
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

/** Como `renderLlmSettings`, para la tabla `[serve]`. */
export function renderServeSettings(currentText: string | undefined, settings: ServeSettings): RenderedSettings {
  const text = replaceServeTable(currentText ?? '', settings);
  const parsed = parseProjectConfig(text);
  if (!parsed.ok) {
    return { ok: false, message: `El ${PROJECT_CONFIG_FILE} resultante no sería válido; no se escribe nada:\n${parsed.errors.map((error) => `  - ${error}`).join('\n')}` };
  }
  return { ok: true, text };
}

export function projectConfigPath(cwd: string): string {
  return resolve(cwd, PROJECT_CONFIG_FILE);
}

export interface ConfigFileState {
  readonly path: string;
  readonly present: boolean;
  /** Huella del texto actual (`undefined` si no existe). */
  readonly sha256: string | undefined;
  readonly text: string | undefined;
}

/**
 * `cv.toml` tal cual está en disco, con su huella (para `If-Match`). Siempre el de la RAÍZ: `[llm]` y
 * `[serve]` configuran el proveedor de modelos y el servidor, que son del espacio de trabajo y no de una
 * persona; el `cv.toml` de un usuario existe para anular su tema y se edita a mano (T-9.32).
 */
export async function readConfigFile(context: Pick<AppContext, 'cwd' | 'workspaceRoot' | 'datasetFileSystem'>): Promise<ConfigFileState | { readonly error: AppError }> {
  const path = projectConfigPath(context.workspaceRoot ?? context.cwd);
  try {
    const text = await context.datasetFileSystem.readTextFile(path);
    return { path, present: true, sha256: contentHash(text), text };
  } catch (error) {
    if (isMissingFile(error)) {
      return { path, present: false, sha256: undefined, text: undefined };
    }
    return { error: environmentError(`No se pudo leer ${path}: ${describeError(error)}`) };
  }
}

export interface WriteLlmSettingsRequest {
  readonly settings: LlmSettings;
  /** Huella leída de `cv.toml`, o `*` si todavía no existe (concurrencia optimista, como las fuentes). */
  readonly expectedSha256: string;
}

export type WriteLlmSettingsResult = { readonly ok: true; readonly path: string; readonly sha256: string; readonly settings: LlmSettings } | { readonly ok: false; readonly error: AppError };

/**
 * Escribe la tabla `[llm]` en `cv.toml` con sustitución quirúrgica (el resto del fichero no cambia), previa
 * comprobación de la huella y del resultado; escritura atómica con permisos 0600 (T-8.2, decisión 7).
 */
export async function writeLlmSettings(context: AppContext, request: WriteLlmSettingsRequest): Promise<WriteLlmSettingsResult> {
  const written = await writeTable(context, request.expectedSha256, (text) => renderLlmSettings(text, request.settings));
  return written.ok ? { ok: true, path: written.path, sha256: written.sha256, settings: request.settings } : written;
}

export interface WriteServeSettingsRequest {
  readonly settings: ServeSettings;
  readonly expectedSha256: string;
}

export type WriteServeSettingsResult = { readonly ok: true; readonly path: string; readonly sha256: string; readonly settings: ServeSettings } | { readonly ok: false; readonly error: AppError };

/** Escribe la tabla `[serve]` con las mismas garantías que `[llm]`: huella, validación del resultado y escritura atómica. */
export async function writeServeSettings(context: AppContext, request: WriteServeSettingsRequest): Promise<WriteServeSettingsResult> {
  const written = await writeTable(context, request.expectedSha256, (text) => renderServeSettings(text, request.settings));
  return written.ok ? { ok: true, path: written.path, sha256: written.sha256, settings: request.settings } : written;
}

type WriteTableResult = { readonly ok: true; readonly path: string; readonly sha256: string } | { readonly ok: false; readonly error: AppError };

async function writeTable(context: AppContext, expectedSha256: string, render: (text: string | undefined) => RenderedSettings): Promise<WriteTableResult> {
  const request = { expectedSha256 };
  const current = await readConfigFile(context);
  if ('error' in current) {
    return { ok: false, error: current.error };
  }
  if (current.present) {
    if (request.expectedSha256 === '*') {
      return { ok: false, error: conflictError(`Ya existe ${current.path}: envía su huella actual (If-Match) para modificarlo`) };
    }
    if (current.sha256 !== request.expectedSha256) {
      return { ok: false, error: conflictError(`${current.path} cambió desde que se leyó (huella ${String(current.sha256).slice(0, 12)}…): vuelve a cargarlo`) };
    }
  } else if (request.expectedSha256 !== '*') {
    return { ok: false, error: conflictError(`No existe ${current.path}: envía «*» como huella para crearlo`) };
  }
  const rendered = render(current.text);
  if (!rendered.ok) {
    return { ok: false, error: dataError(rendered.message) };
  }
  const temporary = `${current.path}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    await context.artifactFileSystem.mkdir(dirname(current.path));
    await context.artifactFileSystem.writeFile(temporary, rendered.text, SOURCE_FILE_MODE);
    await context.artifactFileSystem.rename(temporary, current.path);
  } catch (error) {
    return { ok: false, error: environmentError(`No se pudo escribir ${current.path}: ${describeError(error)}`) };
  }
  return { ok: true, path: current.path, sha256: contentHash(rendered.text) };
}
