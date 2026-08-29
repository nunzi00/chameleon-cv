/**
 * Temas de Typst (T-5.3): inventario, ruta y creación a partir de otro tema, con lecturas por el sistema
 * de ficheros inyectado y escrituras por el escribible; nunca se sobrescribe un tema existente.
 */
import { join, resolve } from 'node:path';

import { describeError } from '../shared/errors';
import { DEFAULT_THEME, THEMES_DIRECTORY_NAME, THEME_CONFIG_FILE, THEME_FONTS_DIRECTORY, THEME_NAME_PATTERN, THEME_TEMPLATE_FILE, inventoryThemes, kindOf, loadProjectConfig, loadTheme, locateTheme, type ThemeInventoryEntry, type ThemeRoot } from '../themes';
import { projectThemeRoots } from './assets';
import type { AppContext } from './context';
import { dataError, environmentError, type AppError } from './errors';

/** Los temas no contienen datos personales: legibles, como cualquier fichero de proyecto. */
export const THEME_FILE_MODE = 0o644;

function invalidName(name: string): string {
  return `Nombre de tema inválido «${name}»: minúsculas, dígitos y guiones (p. ej. «mio»)`;
}

export interface ThemeInventory {
  readonly entries: readonly ThemeInventoryEntry[];
  readonly roots: readonly ThemeRoot[];
  /** El tema por defecto del proyecto (`cv.toml`) o `default`. */
  readonly defaultName: string;
  /** `cv.toml` inválido: se avisa, no se falla. */
  readonly configWarning: string | undefined;
}

export async function themeInventory(context: AppContext): Promise<ThemeInventory> {
  const roots = await projectThemeRoots(context);
  const project = await loadProjectConfig(context.cwd, context.datasetFileSystem);
  const defaultName = project.ok ? (project.config?.theme?.name ?? DEFAULT_THEME) : DEFAULT_THEME;
  return { entries: await inventoryThemes(roots), roots, defaultName, configWarning: project.ok ? undefined : project.message };
}

export type ThemeDirectoryResult =
  | { readonly ok: true; readonly directory: string; readonly warning: string | undefined }
  | { readonly ok: false; readonly error: AppError };

/** Ruta absoluta del directorio de un tema; si existe pero no es utilizable, la ruta con un aviso (sirve para arreglarlo). */
export async function themeDirectory(context: AppContext, name: string): Promise<ThemeDirectoryResult> {
  if (!THEME_NAME_PATTERN.test(name)) {
    return { ok: false, error: dataError(invalidName(name)) };
  }
  const roots = await projectThemeRoots(context);
  const loaded = await loadTheme(name, roots);
  if (loaded.ok) {
    return { ok: true, directory: loaded.theme.directory, warning: undefined };
  }
  const located = await locateTheme(name, roots);
  return located === undefined ? { ok: false, error: dataError(loaded.message) } : { ok: true, directory: located.directory, warning: loaded.message };
}

export interface CreatedTheme {
  readonly name: string;
  readonly directory: string;
  readonly from: string;
  /** Ficheros de `fonts/` copiados. */
  readonly fonts: number;
  /** El nuevo tema del proyecto oculta a un distribuido del mismo nombre. */
  readonly shadowed: boolean;
}

export type ThemeCreateResult = { readonly ok: true; readonly created: CreatedTheme } | { readonly ok: false; readonly error: AppError };

async function copyFonts(context: AppContext, source: string, target: string, root: ThemeRoot): Promise<number> {
  const entries = await root.fileSystem.readDirectory(source);
  const files = entries.filter((entry) => entry.kind === 'file');
  if (files.length === 0) {
    return 0;
  }
  await context.artifactFileSystem.mkdir(target);
  for (const file of files) {
    await context.artifactFileSystem.writeBinaryFile(join(target, file.name), await root.fileSystem.readBinaryFile(join(source, file.name)), THEME_FILE_MODE);
  }
  return files.length;
}

export async function createTheme(context: AppContext, name: string, from: string): Promise<ThemeCreateResult> {
  if (!THEME_NAME_PATTERN.test(name)) {
    return { ok: false, error: dataError(invalidName(name)) };
  }
  const roots = await projectThemeRoots(context);
  const source = await loadTheme(from, roots);
  if (!source.ok) {
    return { ok: false, error: dataError(`No se puede partir del tema «${from}»: ${source.message}`) };
  }
  const directory = resolve(context.cwd, THEMES_DIRECTORY_NAME, name);
  if ((await kindOf(context.datasetFileSystem, directory)) !== 'missing') {
    return { ok: false, error: dataError(`Ya existe ${directory}: elige otro nombre o bórralo antes (nunca se sobrescribe un tema)`) };
  }
  const theme = source.theme;
  try {
    const config = (await theme.root.fileSystem.readTextFile(theme.configPath)).replace(/^name = "[^"]*"$/m, `name = "${name}"`);
    const template = await theme.root.fileSystem.readTextFile(theme.templatePath);
    await context.artifactFileSystem.mkdir(directory);
    await context.artifactFileSystem.writeFile(join(directory, THEME_CONFIG_FILE), config, THEME_FILE_MODE);
    await context.artifactFileSystem.writeFile(join(directory, THEME_TEMPLATE_FILE), template, THEME_FILE_MODE);
    const fonts = theme.fontsDirectory === undefined ? 0 : await copyFonts(context, theme.fontsDirectory, join(directory, THEME_FONTS_DIRECTORY), theme.root);
    const shadowed = (await locateTheme(name, roots.filter((root) => root.builtin))) !== undefined;
    return { ok: true, created: { name, directory, from: theme.name, fonts, shadowed } };
  } catch (error) {
    return { ok: false, error: environmentError(`No se pudo crear el tema en ${directory}: ${describeError(error)}`) };
  }
}
