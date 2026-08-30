/**
 * `cv theme list | path <nombre> | create <nombre>` (T-5.3): clientes de los casos de uso de temas.
 * `list` inventaría los temas visibles (origen, descripción, validez y cuál es el tema por defecto del
 * proyecto); `path` imprime la ruta absoluta de un tema para copiarlo o editarlo; `create` levanta
 * `themes/<nombre>/` en el proyecto a partir de un tema existente.
 */
import { createTheme, themeDirectory, themeInventory } from '../../app/themes';
import { THEME_CONFIG_FILE, THEME_FONTS_DIRECTORY, THEME_TEMPLATE_FILE } from '../../themes';
import type { CliContext } from '../context';
import { EXIT_OK, pluralize, reportError } from '../output';

export { THEME_FILE_MODE } from '../../app/themes';

/** Primera línea útil de un error de tema, para una lista compacta. */
function compactError(message: string): string {
  return message.replace(/:\n\s*- /, ': ').replace(/\n\s*- /g, '; ');
}

export async function runThemeList(context: CliContext): Promise<number> {
  const inventory = await themeInventory(context);
  if (inventory.configWarning !== undefined) {
    context.stderr(`Aviso: ${inventory.configWarning}\n`);
  }
  const width = inventory.entries.reduce((max, entry) => Math.max(max, entry.name.length), 0);
  for (const entry of inventory.entries) {
    const origin = entry.builtin ? 'distribuido ' : 'del proyecto';
    const detail = entry.error === undefined ? (entry.description ?? 'sin descripción') : `inválido: ${compactError(entry.error)}`;
    const credit = [entry.author === undefined ? '' : `autor: ${entry.author}`, entry.license === undefined ? '' : `licencia: ${entry.license}`].filter((note) => note !== '').join(' · ');
    const notes = [credit, entry.name === inventory.defaultName ? 'por defecto' : '', entry.shadows ? 'oculta al distribuido del mismo nombre' : ''].filter((note) => note !== '');
    context.stdout(`${entry.name.padEnd(width)}  ${origin}  ${detail}${notes.length === 0 ? '' : ` · ${notes.join(' · ')}`}\n`);
  }
  context.stderr(`${pluralize(inventory.entries.length, 'tema', 'temas')} en ${inventory.roots.map((root) => root.directory).join(' y ')}; elige uno con --theme <nombre> o con [theme] name en cv.toml\n`);
  return EXIT_OK;
}

export async function runThemePath(context: CliContext, name: string): Promise<number> {
  const result = await themeDirectory(context, name);
  if (!result.ok) {
    return reportError(context, result.error);
  }
  context.stdout(`${result.directory}\n`);
  if (result.warning !== undefined) {
    context.stderr(`Aviso: ${result.warning}\n`);
  }
  return EXIT_OK;
}

export interface ThemeCreateOptions {
  /** Tema del que partir (`--from`); por defecto `default`. */
  readonly from: string;
}

export async function runThemeCreate(context: CliContext, name: string, options: ThemeCreateOptions): Promise<number> {
  const result = await createTheme(context, name, options.from);
  if (!result.ok) {
    return reportError(context, result.error);
  }
  const { created } = result;
  if (created.shadowed) {
    context.stderr(`Aviso: «${name}» también es un tema distribuido; el del proyecto prevalecerá\n`);
  }
  context.stdout(`Tema «${name}» creado en ${created.directory} a partir de «${created.from}»: ${THEME_CONFIG_FILE}, ${THEME_TEMPLATE_FILE}${created.fonts === 0 ? '' : `, ${THEME_FONTS_DIRECTORY}/ (${pluralize(created.fonts, 'fichero', 'ficheros')})`}\n`);
  context.stdout(`Edita ${THEME_CONFIG_FILE} (colores, fuentes, tamaños, espaciados, página) o ${THEME_TEMPLATE_FILE} (maquetación) y genera con: cv generate-cv --format pdf --engine typst --theme ${name}\n`);
  return EXIT_OK;
}
