/**
 * `cv.toml` (T-5.2): configuración central y opcional del proyecto del usuario, en su raíz. Su
 * sección `[theme]` elige el tema por defecto (`name`) y **anula** valores del `theme.toml` del
 * tema en uso, con el mismo vocabulario y el mismo esquema (`[theme.colors] primary = "#ff0000"`),
 * solo para esa ejecución: los ficheros del tema no se tocan. La fusión es en cascada —tema base,
 * después las anulaciones— y el resultado vuelve a validarse entero antes de llegar a Typst.
 */
import { resolve } from 'node:path';

import { z } from 'zod';

import { LlmSettingsSchema, ServeSettingsSchema } from '../llm/settings';
import type { FileSystem } from '../parsers';
import { describeError } from '../shared/errors';
import type { LoadedTheme } from './loader';
import { THEME_NAME_PATTERN, ThemeConfigSchema, parseTomlWith, type ThemeConfig } from './schema';

export const PROJECT_CONFIG_FILE = 'cv.toml';

const shape = ThemeConfigSchema.shape;

/** Las mismas tablas y validaciones que `theme.toml`, todas opcionales; `name` elige el tema. */
export const ThemeOverridesSchema = z.strictObject({
  name: z.string().regex(THEME_NAME_PATTERN, { error: 'Nombre de tema inválido: minúsculas, dígitos y guiones' }).optional(),
  colors: shape.colors.partial().optional(),
  fonts: shape.fonts.partial().optional(),
  sizes: shape.sizes.partial().optional(),
  spacing: shape.spacing.partial().optional(),
  page: z
    .strictObject({
      paper: shape.page.shape.paper.optional(),
      margins: shape.page.shape.margins.partial().optional(),
    })
    .optional(),
});

export const ProjectConfigSchema = z.strictObject({
  theme: ThemeOverridesSchema.optional(),
  /** El co-piloto: proveedor local y modelo, y modelos por defecto de los remotos (T-8.2). */
  llm: LlmSettingsSchema.optional(),
  /** El servidor local: hoy solo el permiso de salida a remotos, leído al arrancar (T-8.17). */
  serve: ServeSettingsSchema.optional(),
});

export type ThemeOverrides = z.output<typeof ThemeOverridesSchema>;
export type ProjectConfig = z.output<typeof ProjectConfigSchema>;

export type ProjectConfigParseResult = { readonly ok: true; readonly config: ProjectConfig } | { readonly ok: false; readonly errors: readonly string[] };

export function parseProjectConfig(text: string): ProjectConfigParseResult {
  const parsed = parseTomlWith(ProjectConfigSchema, text);
  return parsed.ok ? { ok: true, config: parsed.value } : parsed;
}

export type ProjectConfigResult =
  | { readonly ok: true; readonly path: string; /** `undefined` si no hay `cv.toml`. */ readonly config: ProjectConfig | undefined }
  | { readonly ok: false; readonly path: string; readonly message: string };

/** Lee `<cwd>/cv.toml` si existe; su ausencia no es un error. */
export async function loadProjectConfig(cwd: string, fileSystem: FileSystem): Promise<ProjectConfigResult> {
  const path = resolve(cwd, PROJECT_CONFIG_FILE);
  let kind: string;
  try {
    kind = (await fileSystem.stat(path)).kind;
  } catch {
    return { ok: true, path, config: undefined };
  }
  if (kind !== 'file') {
    return { ok: false, path, message: `${path} no es un fichero` };
  }
  let text: string;
  try {
    text = await fileSystem.readTextFile(path);
  } catch (error) {
    return { ok: false, path, message: `No se pudo leer ${path}: ${describeError(error)}` };
  }
  const parsed = parseProjectConfig(text);
  if (!parsed.ok) {
    return { ok: false, path, message: `Configuración inválida (${path}):\n${parsed.errors.map((error) => `  - ${error}`).join('\n')}` };
  }
  return { ok: true, path, config: parsed.config };
}

/** Rutas de las claves anuladas (`colors.primary`, `page.margins.top`…), sin `name`, para explicarlo. */
export function overriddenKeys(overrides: ThemeOverrides | undefined): string[] {
  if (overrides === undefined) {
    return [];
  }
  const keys: string[] = [];
  const collect = (prefix: string, table: Record<string, unknown> | undefined): void => {
    for (const [key, value] of Object.entries(table ?? {})) {
      keys.push(`${prefix}.${key}`);
      void value;
    }
  };
  collect('colors', overrides.colors);
  collect('fonts', overrides.fonts);
  collect('sizes', overrides.sizes);
  collect('spacing', overrides.spacing);
  if (overrides.page?.paper !== undefined) {
    keys.push('page.paper');
  }
  collect('page.margins', overrides.page?.margins);
  return keys;
}

/** Fusión en cascada: tema base → anulaciones; el resultado se revalida entero. Los metadatos del tema no se anulan. */
export function applyThemeOverrides(theme: LoadedTheme, overrides: ThemeOverrides | undefined): LoadedTheme {
  if (overrides === undefined || overriddenKeys(overrides).length === 0) {
    return theme;
  }
  const base = theme.config;
  const merged: ThemeConfig = ThemeConfigSchema.parse({
    theme: base.theme,
    colors: { ...base.colors, ...overrides.colors },
    fonts: { ...base.fonts, ...overrides.fonts },
    sizes: { ...base.sizes, ...overrides.sizes },
    spacing: { ...base.spacing, ...overrides.spacing },
    page: { paper: overrides.page?.paper ?? base.page.paper, margins: { ...base.page.margins, ...overrides.page?.margins } },
  });
  return { ...theme, config: merged };
}
