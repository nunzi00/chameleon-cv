/**
 * `cv theme list | path <nombre> | create <nombre>` (T-5.3): clientes de los casos de uso de temas.
 * `list` inventaría los temas visibles (origen, descripción, validez y cuál es el tema por defecto del
 * proyecto); `path` imprime la ruta absoluta de un tema para copiarlo o editarlo; `create` levanta
 * `themes/<nombre>/` en el proyecto a partir de un tema existente.
 */
import { join } from 'node:path';

import { THEME_DOWNLOAD_LIMITS, classifyInstallSource, createTheme, installTheme, themeDirectory, themeInventory, verifyThemes, type ThemeInstallPlan, type ThemeVerification } from '../../app/themes';
import { ORIGIN_FILE, THEME_CONFIG_FILE, THEME_FONTS_DIRECTORY, THEME_TEMPLATE_FILE } from '../../themes';
import type { CliContext } from '../context';
import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK, pluralize, reportError } from '../output';
import { readVersion } from '../version';

export { THEME_FILE_MODE } from '../../app/themes';

/** Primera línea útil de un error de tema, para una lista compacta. */
function compactError(message: string): string {
  return message.replace(/:\n\s*- /, ': ').replace(/\n\s*- /g, '; ');
}

export interface ThemeListOptions {
  /** Recalcula las huellas de los temas instalados. */
  readonly verify: boolean;
}

function describeOrigin(entry: { readonly origin?: { readonly source: string; readonly verified?: 'intact' | 'modified' | undefined } | undefined }): string {
  if (entry.origin === undefined) {
    return '';
  }
  const state = entry.origin.verified === undefined ? '' : entry.origin.verified === 'intact' ? ', intacto' : ', MODIFICADO LOCALMENTE';
  return `origen: ${entry.origin.source}${state}`;
}

export async function runThemeList(context: CliContext, options: ThemeListOptions = { verify: false }): Promise<number> {
  const inventory = await themeInventory(context, { verify: options.verify });
  if (inventory.configWarning !== undefined) {
    context.stderr(`Aviso: ${inventory.configWarning}\n`);
  }
  const width = inventory.entries.reduce((max, entry) => Math.max(max, entry.name.length), 0);
  for (const entry of inventory.entries) {
    const origin = entry.builtin ? 'distribuido ' : 'del proyecto';
    const detail = entry.error === undefined ? (entry.description ?? 'sin descripción') : `inválido: ${compactError(entry.error)}`;
    const credit = [entry.author === undefined ? '' : `autor: ${entry.author}`, entry.license === undefined ? '' : `licencia: ${entry.license}`].filter((note) => note !== '').join(' · ');
    const notes = [credit, describeOrigin(entry), entry.name === inventory.defaultName ? 'por defecto' : '', entry.shadows ? 'oculta al distribuido del mismo nombre' : ''].filter((note) => note !== '');
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

/* ───────────────────────── install y verify (T-8.3) ───────────────────────── */

export const INSTALL_CANCELLED = 'Operación cancelada: no se ha descargado nada';

export interface ThemeInstallCliOptions {
  readonly as?: string | undefined;
  readonly sha256?: string | undefined;
  readonly dryRun: boolean;
  readonly replace: boolean;
  readonly yes: boolean;
}

/** Anuncio y consentimiento antes de la única descarga (docs/theme-gallery.md §4.2 paso 1); una ruta local no pregunta. */
async function consentToDownload(context: CliContext, url: URL, name: string | undefined, yes: boolean): Promise<boolean> {
  const limit = `${THEME_DOWNLOAD_LIMITS.maxBytes / 1024 / 1024} MiB`;
  context.stderr(`Se descargará «${url.href}» (host ${url.host}, máximo ${limit}) para instalarlo como themes/${name ?? '<nombre del tema>'}/; la huella se mostrará antes de instalar\n`);
  if (yes) {
    context.stderr('Confirmado con --yes\n');
    return true;
  }
  if (context.confirm === undefined) {
    context.stderr(`${INSTALL_CANCELLED}: sin terminal interactiva, confirma con --yes\n`);
    return false;
  }
  const accepted = await context.confirm('¿Descargar e instalar el tema? [s/N] ');
  if (!accepted) {
    context.stderr(`${INSTALL_CANCELLED}\n`);
  }
  return accepted;
}

function describePlanSource(plan: ThemeInstallPlan): string {
  return plan.kind === 'url' ? `la URL ${plan.source}` : plan.kind === 'archive' ? `el archivo ${plan.source}` : `el directorio ${plan.source}`;
}

export async function runThemeInstall(context: CliContext, source: string, options: ThemeInstallCliOptions): Promise<number> {
  const classified = classifyInstallSource(context.cwd, source);
  if (!classified.ok) {
    return reportError(context, classified.error);
  }
  if (classified.source.kind === 'url' && !(await consentToDownload(context, classified.source.url, options.as, options.yes))) {
    return EXIT_FAILURE;
  }
  // La versión sale de los assets (package.json del repositorio o del ejecutable), nunca de una ruta fija: en el binario publicado no hay package.json en disco.
  const result = await installTheme(context, { source, as: options.as, sha256: options.sha256, dryRun: options.dryRun, replace: options.replace }, { toolVersion: readVersion(await context.assets.text('package.json')) });
  if (!result.ok) {
    return reportError(context, result.error);
  }
  const { plan, written, backup } = result.installed;
  const width = plan.files.reduce((max, file) => Math.max(max, file.path.length), 0);
  context.stdout(`${written ? 'Tema' : 'Plan (--dry-run): el tema'} «${plan.name}» ${written ? 'instalado en' : 'se instalaría en'} ${plan.directory} desde ${describePlanSource(plan)}\n`);
  for (const file of plan.files) {
    context.stdout(`  ${file.path.padEnd(width)}  ${String(file.bytes).padStart(8)} bytes  ${file.sha256}\n`);
  }
  context.stdout(`Huella del ${plan.kind === 'directory' ? 'contenido' : 'archivo'} (SHA-256): ${plan.archiveSha256}${options.sha256 === undefined ? '' : ' · coincide con --sha256'}\n`);
  if (plan.shadowed) {
    context.stderr(`Aviso: «${plan.name}» también es un tema distribuido; el del proyecto prevalecerá\n`);
  }
  if (!written) {
    context.stdout(`No se ha escrito nada (--dry-run)${plan.replaces === undefined ? '' : `; con --replace se apartaría ${plan.replaces} a una copia .bak`}\n`);
    return EXIT_OK;
  }
  if (backup !== undefined) {
    context.stderr(`El tema anterior se ha apartado a ${backup}\n`);
  }
  context.stdout(`Origen fijado en ${join(plan.directory, ORIGIN_FILE)}. Úsalo con «cv generate-cv --format pdf --engine typst --theme ${plan.name}» y compruébalo con «cv theme verify ${plan.name}»; el tema se ejecuta contenido, como todos.\n`);
  return EXIT_OK;
}

function describeVerification(verification: ThemeVerification): string {
  const { name, report } = verification;
  if (report.origin === undefined) {
    // Sin `.origin.json` no hay origen; con uno ilegible, el tema cuenta como modificado.
    return report.problem === undefined ? `${name}: sin origen registrado (tema creado o copiado a mano)` : `${name}: modificado localmente: ${report.problem}`;
  }
  const origin = ` (origen ${report.origin.source}, instalado el ${report.origin.installedAt})`;
  if (report.state === 'intact') {
    return `${name}: intacto${origin}`;
  }
  const labels = { modified: 'modificado', missing: 'falta', added: 'añadido' } as const;
  const changed = report.files.filter((file) => file.state !== 'ok').map((file) => `${file.path} (${labels[file.state as keyof typeof labels]})`);
  return `${name}: modificado localmente: ${changed.join(', ')}${origin}`;
}

export async function runThemeVerify(context: CliContext, name?: string): Promise<number> {
  const result = await verifyThemes(context, name);
  if (!result.ok) {
    return reportError(context, result.error);
  }
  if (result.verifications.length === 0) {
    context.stdout('No hay temas en themes/ del proyecto\n');
    return EXIT_OK;
  }
  for (const verification of result.verifications) {
    context.stdout(`${describeVerification(verification)}\n`);
  }
  return result.failed ? EXIT_DATA_ERROR : EXIT_OK;
}
