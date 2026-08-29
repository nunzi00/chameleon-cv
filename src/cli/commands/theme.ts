/**
 * `cv theme list | path <nombre> | create <nombre>` (T-5.3): gestión del ecosistema de temas sin
 * tocar código. `list` inventaría los temas visibles (origen, descripción, validez y cuál es el
 * tema por defecto del proyecto); `path` imprime la ruta absoluta de un tema para copiarlo o
 * editarlo; `create` levanta `themes/<nombre>/` en el proyecto a partir de un tema existente.
 * Lecturas por el sistema de ficheros inyectado; escrituras por el escribible; nunca sobrescribe.
 */
import { join, resolve } from 'node:path';

import { describeError } from '../../shared/errors';
import { DEFAULT_THEME, THEMES_DIRECTORY_NAME, THEME_CONFIG_FILE, THEME_FONTS_DIRECTORY, THEME_NAME_PATTERN, THEME_TEMPLATE_FILE, inventoryThemes, kindOf, loadProjectConfig, loadTheme, locateTheme, type ThemeRoot } from '../../themes';
import { projectThemeRoots } from '../assets';
import type { CliContext } from '../context';
import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK, pluralize } from '../output';

/** Los temas no contienen datos personales: legibles, como cualquier fichero de proyecto. */
export const THEME_FILE_MODE = 0o644;

function invalidName(name: string): string {
  return `Nombre de tema inválido «${name}»: minúsculas, dígitos y guiones (p. ej. «mio»)`;
}

/** Primera línea útil de un error de tema, para una lista compacta. */
function compactError(message: string): string {
  return message.replace(/:\n\s*- /, ': ').replace(/\n\s*- /g, '; ');
}

export async function runThemeList(context: CliContext): Promise<number> {
  const roots = await projectThemeRoots(context);
  const project = await loadProjectConfig(context.cwd, context.datasetFileSystem);
  if (!project.ok) {
    context.stderr(`Aviso: ${project.message}\n`);
  }
  const defaultName = project.ok ? (project.config?.theme?.name ?? DEFAULT_THEME) : DEFAULT_THEME;
  const entries = await inventoryThemes(roots);
  const width = entries.reduce((max, entry) => Math.max(max, entry.name.length), 0);
  for (const entry of entries) {
    const origin = entry.builtin ? 'distribuido ' : 'del proyecto';
    const detail = entry.error === undefined ? (entry.description ?? 'sin descripción') : `inválido: ${compactError(entry.error)}`;
    const notes = [entry.name === defaultName ? 'por defecto' : '', entry.shadows ? 'oculta al distribuido del mismo nombre' : ''].filter((note) => note !== '');
    context.stdout(`${entry.name.padEnd(width)}  ${origin}  ${detail}${notes.length === 0 ? '' : ` · ${notes.join(' · ')}`}\n`);
  }
  context.stderr(`${pluralize(entries.length, 'tema', 'temas')} en ${roots.map((root) => root.directory).join(' y ')}; elige uno con --theme <nombre> o con [theme] name en cv.toml\n`);
  return EXIT_OK;
}

export async function runThemePath(context: CliContext, name: string): Promise<number> {
  if (!THEME_NAME_PATTERN.test(name)) {
    context.stderr(`${invalidName(name)}\n`);
    return EXIT_DATA_ERROR;
  }
  const roots = await projectThemeRoots(context);
  const loaded = await loadTheme(name, roots);
  if (loaded.ok) {
    context.stdout(`${loaded.theme.directory}\n`);
    return EXIT_OK;
  }
  const located = await locateTheme(name, roots);
  if (located === undefined) {
    context.stderr(`${loaded.message}\n`);
    return EXIT_DATA_ERROR;
  }
  // El directorio existe pero el tema no es utilizable: la ruta sirve precisamente para arreglarlo.
  context.stdout(`${located.directory}\n`);
  context.stderr(`Aviso: ${loaded.message}\n`);
  return EXIT_OK;
}

export interface ThemeCreateOptions {
  /** Tema del que partir (`--from`); por defecto `default`. */
  readonly from: string;
}

async function copyFonts(context: CliContext, source: string, target: string, root: ThemeRoot): Promise<number> {
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

export async function runThemeCreate(context: CliContext, name: string, options: ThemeCreateOptions): Promise<number> {
  if (!THEME_NAME_PATTERN.test(name)) {
    context.stderr(`${invalidName(name)}\n`);
    return EXIT_DATA_ERROR;
  }
  const roots = await projectThemeRoots(context);
  const source = await loadTheme(options.from, roots);
  if (!source.ok) {
    context.stderr(`No se puede partir del tema «${options.from}»: ${source.message}\n`);
    return EXIT_DATA_ERROR;
  }
  const directory = resolve(context.cwd, THEMES_DIRECTORY_NAME, name);
  if ((await kindOf(context.datasetFileSystem, directory)) !== 'missing') {
    context.stderr(`Ya existe ${directory}: elige otro nombre o bórralo antes (nunca se sobrescribe un tema)\n`);
    return EXIT_DATA_ERROR;
  }
  const from = source.theme;
  try {
    const config = (await from.root.fileSystem.readTextFile(from.configPath)).replace(/^name = "[^"]*"$/m, `name = "${name}"`);
    const template = await from.root.fileSystem.readTextFile(from.templatePath);
    await context.artifactFileSystem.mkdir(directory);
    await context.artifactFileSystem.writeFile(join(directory, THEME_CONFIG_FILE), config, THEME_FILE_MODE);
    await context.artifactFileSystem.writeFile(join(directory, THEME_TEMPLATE_FILE), template, THEME_FILE_MODE);
    const fonts = from.fontsDirectory === undefined ? 0 : await copyFonts(context, from.fontsDirectory, join(directory, THEME_FONTS_DIRECTORY), from.root);
    const shadowed = await locateTheme(name, roots.filter((root) => root.builtin));
    if (shadowed !== undefined) {
      context.stderr(`Aviso: «${name}» también es un tema distribuido; el del proyecto prevalecerá\n`);
    }
    context.stdout(`Tema «${name}» creado en ${directory} a partir de «${from.name}»: ${THEME_CONFIG_FILE}, ${THEME_TEMPLATE_FILE}${fonts === 0 ? '' : `, ${THEME_FONTS_DIRECTORY}/ (${pluralize(fonts, 'fichero', 'ficheros')})`}\n`);
    context.stdout(`Edita ${THEME_CONFIG_FILE} (colores, fuentes, tamaños, espaciados, página) o ${THEME_TEMPLATE_FILE} (maquetación) y genera con: cv generate-cv --format pdf --engine typst --theme ${name}\n`);
    return EXIT_OK;
  } catch (error) {
    context.stderr(`No se pudo crear el tema en ${directory}: ${describeError(error)}\n`);
    return EXIT_FAILURE;
  }
}
