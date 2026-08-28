/**
 * Cargador de temas (T-5.1, T-5.3): un tema es un directorio `themes/<nombre>/` con `template.typ` y
 * `theme.toml` (y, opcionalmente, `fonts/`). Se busca primero en `themes/` del proyecto del
 * usuario y después en los temas distribuidos con la herramienta; `default` es el tema por defecto.
 * El nombre se valida antes de tocar el disco: un tema no puede ser una ruta.
 */
import { join, resolve } from 'node:path';

import { NodeFileSystem, type FileSystem } from '../parsers';
import { describeError } from '../shared/errors';
import { THEME_NAME_PATTERN, parseThemeConfig, type ThemeConfig } from './schema';

export const DEFAULT_THEME = 'default';
export const THEMES_DIRECTORY_NAME = 'themes';
export const THEME_TEMPLATE_FILE = 'template.typ';
export const THEME_CONFIG_FILE = 'theme.toml';
export const THEME_FONTS_DIRECTORY = 'fonts';
/** Temas distribuidos con la herramienta (`<repositorio>/themes`). */
export const BUILTIN_THEMES_DIRECTORY = resolve(__dirname, '..', '..', THEMES_DIRECTORY_NAME);

export interface ThemeRoot {
  readonly directory: string;
  readonly fileSystem: FileSystem;
  readonly builtin: boolean;
}

export interface LoadedTheme {
  readonly name: string;
  readonly directory: string;
  readonly templatePath: string;
  readonly configPath: string;
  /** `themes/<nombre>/fonts`, si existe: se añade a las fuentes disponibles para Typst. */
  readonly fontsDirectory: string | undefined;
  readonly config: ThemeConfig;
  readonly builtin: boolean;
  /** Raíz en la que se encontró (su sistema de ficheros permite leer los ficheros del tema). */
  readonly root: ThemeRoot;
}

export type ThemeLoadResult = { readonly ok: true; readonly theme: LoadedTheme } | { readonly ok: false; readonly message: string };

export function builtinThemeRoot(fileSystem: FileSystem = new NodeFileSystem()): ThemeRoot {
  return { directory: BUILTIN_THEMES_DIRECTORY, fileSystem, builtin: true };
}

/** Orden de búsqueda: `themes/` del proyecto (con el sistema de ficheros inyectado) y después los distribuidos. */
export function themeRoots(cwd: string, fileSystem: FileSystem, builtin: ThemeRoot = builtinThemeRoot()): ThemeRoot[] {
  const project = resolve(cwd, THEMES_DIRECTORY_NAME);
  return project === builtin.directory ? [builtin] : [{ directory: project, fileSystem, builtin: false }, builtin];
}

export async function kindOf(fileSystem: FileSystem, path: string): Promise<'file' | 'directory' | 'other' | 'missing'> {
  try {
    return (await fileSystem.stat(path)).kind;
  } catch {
    return 'missing';
  }
}

/** Nombres de los temas disponibles (directorios con `theme.toml`), sin duplicados, en orden de búsqueda. */
export async function listThemes(roots: readonly ThemeRoot[]): Promise<string[]> {
  const names: string[] = [];
  for (const root of roots) {
    let entries;
    try {
      entries = await root.fileSystem.readDirectory(root.directory);
    } catch {
      continue;
    }
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.kind === 'directory' && THEME_NAME_PATTERN.test(entry.name) && !names.includes(entry.name) && (await kindOf(root.fileSystem, join(root.directory, entry.name, THEME_CONFIG_FILE))) === 'file') {
        names.push(entry.name);
      }
    }
  }
  return names;
}

export interface LocatedTheme {
  readonly name: string;
  readonly directory: string;
  readonly root: ThemeRoot;
}

/** Directorio del tema en la primera raíz que lo tenga, sin validar su contenido (`cv theme path`). */
export async function locateTheme(name: string, roots: readonly ThemeRoot[]): Promise<LocatedTheme | undefined> {
  for (const root of roots) {
    const directory = join(root.directory, name);
    if ((await kindOf(root.fileSystem, directory)) === 'directory') {
      return { name, directory, root };
    }
  }
  return undefined;
}

export async function loadTheme(name: string, roots: readonly ThemeRoot[]): Promise<ThemeLoadResult> {
  if (!THEME_NAME_PATTERN.test(name)) {
    return { ok: false, message: `Nombre de tema inválido «${name}»: minúsculas, dígitos y guiones (p. ej. «default»)` };
  }
  const located = await locateTheme(name, roots);
  if (located === undefined) {
    const available = await listThemes(roots);
    return { ok: false, message: `No existe el tema «${name}» (buscado en ${roots.map((root) => root.directory).join(', ')}); disponibles: ${available.length === 0 ? 'ninguno' : available.join(', ')}` };
  }
  const { directory, root } = located;
  const configPath = join(directory, THEME_CONFIG_FILE);
  const templatePath = join(directory, THEME_TEMPLATE_FILE);
  for (const [path, file] of [
    [configPath, THEME_CONFIG_FILE],
    [templatePath, THEME_TEMPLATE_FILE],
  ] as const) {
    if ((await kindOf(root.fileSystem, path)) !== 'file') {
      return { ok: false, message: `El tema «${name}» (${directory}) no tiene ${file}` };
    }
  }
  let text: string;
  try {
    text = await root.fileSystem.readTextFile(configPath);
  } catch (error) {
    return { ok: false, message: `No se pudo leer ${configPath}: ${describeError(error)}` };
  }
  const parsed = parseThemeConfig(text);
  if (!parsed.ok) {
    return { ok: false, message: `Tema «${name}» inválido (${configPath}):\n${parsed.errors.map((error) => `  - ${error}`).join('\n')}` };
  }
  if (parsed.config.theme.name !== undefined && parsed.config.theme.name !== name) {
    return { ok: false, message: `${configPath}: theme.name «${parsed.config.theme.name}» no coincide con el directorio «${name}»` };
  }
  const fonts = join(directory, THEME_FONTS_DIRECTORY);
  const fontsDirectory = (await kindOf(root.fileSystem, fonts)) === 'directory' ? fonts : undefined;
  return { ok: true, theme: { name, directory, templatePath, configPath, fontsDirectory, config: parsed.config, builtin: root.builtin, root } };
}

export interface ThemeInventoryEntry {
  readonly name: string;
  readonly directory: string;
  readonly builtin: boolean;
  /** Un tema del proyecto con el mismo nombre que uno distribuido: prevalece y lo oculta. */
  readonly shadows: boolean;
  readonly description: string | undefined;
  /** Motivo por el que no se puede usar, si lo hay. */
  readonly error: string | undefined;
}

/** Inventario para `cv theme list`: cada tema visible con su origen, descripción y validez. */
export async function inventoryThemes(roots: readonly ThemeRoot[]): Promise<ThemeInventoryEntry[]> {
  const builtinNames = new Set(await listThemes(roots.filter((root) => root.builtin)));
  const entries: ThemeInventoryEntry[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    for (const name of await listThemes([root])) {
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      const loaded = await loadTheme(name, [root]);
      entries.push({
        name,
        directory: join(root.directory, name),
        builtin: root.builtin,
        shadows: !root.builtin && builtinNames.has(name),
        description: loaded.ok ? loaded.theme.config.theme.description : undefined,
        error: loaded.ok ? undefined : loaded.message,
      });
    }
  }
  return entries;
}
