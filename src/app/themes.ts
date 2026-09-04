/**
 * Temas de Typst (T-5.3): inventario, ruta y creación a partir de otro tema, con lecturas por el sistema
 * de ficheros inyectado y escrituras por el escribible; nunca se sobrescribe un tema existente.
 */
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';

import { describeError } from '../shared/errors';
import {
  ARCHIVE_LIMITS,
  ArchiveError,
  DEFAULT_THEME,
  ORIGIN_FILE,
  THEMES_DIRECTORY_NAME,
  THEME_CONFIG_FILE,
  THEME_FONTS_DIRECTORY,
  THEME_NAME_PATTERN,
  THEME_TEMPLATE_FILE,
  applyEntryPolicy,
  canonicalDigest,
  fileDigests,
  inventoryThemes,
  kindOf,
  listThemes,
  loadProjectConfig,
  loadTheme,
  locateTheme,
  parseOrigin,
  parseThemeConfig,
  readThemeArchive,
  serializeOrigin,
  sha256Hex,
  verifyThemeDirectory,
  type OriginKind,
  type RawEntry,
  type ThemeConfig,
  type ThemeFile,
  type ThemeInventoryEntry,
  type ThemeOrigin,
  type ThemeOriginSummary,
  type ThemeRoot,
  type VerifyReport,
} from '../themes';
import { downloadToBuffer, type Fetcher } from '../typst';
import { projectThemeRoots } from './assets';
import type { AppContext } from './context';
import { conflictError, dataError, environmentError, notFoundError, type AppError } from './errors';
import { backupDirectory } from './portability';

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

export interface ThemeInventoryOptions {
  /** Recalcula las huellas de los temas con origen (`cv theme list --verify`). */
  readonly verify?: boolean | undefined;
}

/** Origen de un tema del proyecto según su `.origin.json`, si lo tiene y es legible. */
async function originOf(root: ThemeRoot, entry: ThemeInventoryEntry, verify: boolean): Promise<ThemeOriginSummary | undefined> {
  let text: string;
  try {
    text = await root.fileSystem.readTextFile(join(entry.directory, ORIGIN_FILE));
  } catch {
    return undefined;
  }
  const parsed = parseOrigin(text);
  if (!parsed.ok) {
    return undefined;
  }
  const summary: ThemeOriginSummary = { source: parsed.origin.source, kind: parsed.origin.kind, installedAt: parsed.origin.installedAt };
  if (!verify) {
    return summary;
  }
  const report = await verifyThemeDirectory(root.fileSystem, entry.directory);
  return { ...summary, verified: report.state === 'intact' ? 'intact' : 'modified' };
}

export async function themeInventory(context: AppContext, options: ThemeInventoryOptions = {}): Promise<ThemeInventory> {
  const roots = await projectThemeRoots(context);
  const project = await loadProjectConfig(context.cwd, context.datasetFileSystem, context.workspaceRoot);
  const defaultName = project.ok ? (project.config?.theme?.name ?? DEFAULT_THEME) : DEFAULT_THEME;
  const entries: ThemeInventoryEntry[] = [];
  for (const entry of await inventoryThemes(roots)) {
    const root = roots.find((candidate) => candidate.builtin === entry.builtin);
    const origin = entry.builtin || root === undefined ? undefined : await originOf(root, entry, options.verify === true);
    entries.push(origin === undefined ? entry : { ...entry, origin });
  }
  return { entries, roots, defaultName, configWarning: project.ok ? undefined : project.message };
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

/* ───────────────────────── instalación y verificación (T-8.3) ───────────────────────── */

/** Límite anunciado antes de descargar un tema (docs/theme-gallery.md §4.2 paso 2). */
export const THEME_DOWNLOAD_LIMITS = { maxBytes: 8 * 1024 * 1024, timeoutMs: 60_000 } as const;

export type InstallSource = { readonly kind: 'url'; readonly url: URL } | { readonly kind: 'local'; readonly path: string };
export type SourceClassification = { readonly ok: true; readonly source: InstallSource } | { readonly ok: false; readonly error: AppError };

/** Qué es el origen antes de tocar nada: URL https (pide consentimiento), ruta local, o rechazado (http y otros esquemas). */
export function classifyInstallSource(cwd: string, source: string): SourceClassification {
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(source);
  if (scheme === null) {
    return { ok: true, source: { kind: 'local', path: resolve(cwd, source) } };
  }
  if ((scheme[1] as string).toLowerCase() !== 'https') {
    return { ok: false, error: dataError(`Origen no admitido «${source}»: solo URL https:// o rutas locales (nada de ${(scheme[1] as string).toLowerCase()}://)`) };
  }
  try {
    return { ok: true, source: { kind: 'url', url: new URL(source) } };
  } catch {
    return { ok: false, error: dataError(`URL inválida «${source}»`) };
  }
}

export interface InstallThemeRequest {
  readonly source: string;
  readonly as?: string | undefined;
  readonly sha256?: string | undefined;
  readonly dryRun?: boolean | undefined;
  readonly replace?: boolean | undefined;
}

export interface InstallThemeOptions {
  readonly fetcher?: Fetcher | undefined;
  /** Versión de la herramienta para `.origin.json` (`tool`). */
  readonly toolVersion?: string | undefined;
  /** Sufijo del directorio temporal (inyectable en las pruebas). */
  readonly tempSuffix?: string | undefined;
}

export interface InstallFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ThemeInstallPlan {
  readonly name: string;
  readonly directory: string;
  readonly kind: OriginKind;
  /** URL final (tras redirecciones) o ruta local absoluta. */
  readonly source: string;
  readonly archiveSha256: string;
  readonly files: readonly InstallFile[];
  readonly totalBytes: number;
  readonly config: ThemeConfig;
  /** Directorio de un tema existente con ese nombre que `--replace` apartará. */
  readonly replaces: string | undefined;
  readonly shadowed: boolean;
}

export interface InstalledTheme {
  readonly plan: ThemeInstallPlan;
  /** `false` con `--dry-run`: nada escrito. */
  readonly written: boolean;
  readonly backup: string | undefined;
}

export type ThemeInstallResult = { readonly ok: true; readonly installed: InstalledTheme } | { readonly ok: false; readonly error: AppError };

interface Obtained {
  readonly kind: OriginKind;
  readonly source: string;
  readonly root: string | undefined;
  readonly files: readonly ThemeFile[];
  readonly archiveSha256: string;
}

type ObtainResult = { readonly ok: true; readonly value: Obtained } | { readonly ok: false; readonly error: AppError };

function fromArchive(kind: OriginKind, source: string, bytes: Uint8Array): ObtainResult {
  const read = readThemeArchive(bytes);
  if (!read.ok) {
    return { ok: false, error: dataError(`El archivo «${source}» no es un tema instalable: ${read.message}`) };
  }
  return { ok: true, value: { kind, source, root: read.archive.root, files: read.archive.files, archiveSha256: sha256Hex(bytes) } };
}

/** Un directorio local se lee con la misma política que un archivo: raíz, `fonts/` y nada más profundo; `.origin.json` no cuenta. */
async function directoryEntries(context: AppContext, root: string): Promise<RawEntry[]> {
  const entries: RawEntry[] = [];
  const fileSystem = context.datasetFileSystem;
  const visit = async (directory: string, prefix: string, depth: number): Promise<void> => {
    for (const entry of await fileSystem.readDirectory(directory)) {
      if (prefix === '' && entry.name === ORIGIN_FILE) {
        continue;
      }
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const full = join(directory, entry.name);
      if (entry.kind === 'directory') {
        entries.push({ path, type: 'directory' });
        // Raíz opcional (1) → fonts/ (2) como mucho; lo más profundo se entrega como directorio y la política lo rechaza.
        if (depth < 3) {
          await visit(full, path, depth + 1);
        }
      } else if (entry.kind === 'file') {
        const size = (await fileSystem.stat(full)).size;
        // Nada por encima del mayor límite se carga en memoria; la política aplica después el límite de cada tipo.
        if (size > ARCHIVE_LIMITS.maxFontBytes) {
          throw new ArchiveError(`La entrada «${path}» pesa ${size} bytes; el máximo es ${ARCHIVE_LIMITS.maxFontBytes}`);
        }
        const bytes = await fileSystem.readBinaryFile(full);
        entries.push({ path, type: 'file', size, read: () => bytes });
      } else {
        entries.push({ path, type: entry.kind });
      }
    }
  };
  await visit(root, '', 1);
  return entries;
}

async function obtain(context: AppContext, source: InstallSource, fetcher: Fetcher | undefined): Promise<ObtainResult> {
  if (source.kind === 'url') {
    try {
      const downloaded = await downloadToBuffer(source.url.href, { maxBytes: THEME_DOWNLOAD_LIMITS.maxBytes, timeoutMs: THEME_DOWNLOAD_LIMITS.timeoutMs, fetcher });
      return fromArchive('url', downloaded.url, downloaded.content);
    } catch (error) {
      // downloadToBuffer solo lanza DownloadError, siempre con un mensaje completo.
      return { ok: false, error: environmentError(describeError(error)) };
    }
  }
  const kind = await kindOf(context.datasetFileSystem, source.path);
  if (kind === 'missing') {
    return { ok: false, error: notFoundError(`No existe «${source.path}»`) };
  }
  if (kind === 'directory') {
    try {
      const archive = applyEntryPolicy(await directoryEntries(context, source.path));
      return { ok: true, value: { kind: 'directory', source: source.path, root: archive.root, files: archive.files, archiveSha256: canonicalDigest(archive.files) } };
    } catch (error) {
      return { ok: false, error: dataError(`El directorio «${source.path}» no es un tema instalable: ${error instanceof ArchiveError ? error.message : describeError(error)}`) };
    }
  }
  if (kind !== 'file') {
    return { ok: false, error: dataError(`«${source.path}» no es un archivo ni un directorio`) };
  }
  try {
    const size = (await context.datasetFileSystem.stat(source.path)).size;
    if (size > THEME_DOWNLOAD_LIMITS.maxBytes) {
      return { ok: false, error: dataError(`«${source.path}» pesa ${size} bytes; el máximo admitido es ${THEME_DOWNLOAD_LIMITS.maxBytes}`) };
    }
    return fromArchive('archive', source.path, await context.datasetFileSystem.readBinaryFile(source.path));
  } catch (error) {
    return { ok: false, error: environmentError(`No se pudo leer «${source.path}»: ${describeError(error)}`) };
  }
}

function decode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf8');
}

async function removeQuietly(context: AppContext, path: string): Promise<void> {
  try {
    await context.artifactFileSystem.remove(path);
  } catch {
    // El error que importa es el que provocó la limpieza.
  }
}

/**
 * Instala un tema (docs/theme-gallery.md §4.2): origen → lectura con política → validación → huellas → escritura
 * atómica con `.origin.json`. Ninguna escritura en `themes/` hasta el último paso; con `dryRun`, ninguna.
 * El consentimiento para descargar es del cliente (la CLI pregunta antes de llamar).
 */
export async function installTheme(context: AppContext, request: InstallThemeRequest, options: InstallThemeOptions = {}): Promise<ThemeInstallResult> {
  const classified = classifyInstallSource(context.cwd, request.source);
  if (!classified.ok) {
    return classified;
  }
  const expected = request.sha256?.trim().toLowerCase();
  if (expected !== undefined && !/^[0-9a-f]{64}$/.test(expected)) {
    return { ok: false, error: dataError(`Huella inválida «${String(request.sha256)}»: se espera un SHA-256 en hexadecimal (64 caracteres)`) };
  }
  if (request.as !== undefined && !THEME_NAME_PATTERN.test(request.as)) {
    return { ok: false, error: dataError(invalidName(request.as)) };
  }
  const obtained = await obtain(context, classified.source, options.fetcher ?? context.fetcher);
  if (!obtained.ok) {
    return obtained;
  }
  const { kind, source, root, archiveSha256 } = obtained.value;
  if (expected !== undefined && expected !== archiveSha256) {
    return { ok: false, error: dataError(`La huella del archivo no coincide: esperada ${expected}, obtenida ${archiveSha256}; no se ha instalado nada`) };
  }
  let files = obtained.value.files;
  const toml = files.find((file) => file.path === THEME_CONFIG_FILE);
  if (toml === undefined) {
    return { ok: false, error: dataError(`El origen «${source}» no contiene ${THEME_CONFIG_FILE}`) };
  }
  if (!files.some((file) => file.path === THEME_TEMPLATE_FILE)) {
    return { ok: false, error: dataError(`El origen «${source}» no contiene ${THEME_TEMPLATE_FILE}`) };
  }
  let parsed = parseThemeConfig(decode(toml.bytes));
  if (!parsed.ok) {
    return { ok: false, error: dataError(`${THEME_CONFIG_FILE} del origen «${source}» inválido`, [`${THEME_CONFIG_FILE} del origen «${source}» inválido:`, ...parsed.errors.map((error) => `  - ${error}`)]) };
  }
  const name = request.as ?? parsed.config.theme.name ?? root;
  if (name === undefined) {
    return { ok: false, error: dataError(`No se puede determinar el nombre del tema: ${THEME_CONFIG_FILE} no lleva name y el archivo no tiene directorio raíz; indícalo con --as <nombre>`) };
  }
  if (parsed.config.theme.name !== undefined && parsed.config.theme.name !== name) {
    const rewritten = decode(toml.bytes).replace(/^name = "[^"]*"$/m, `name = "${name}"`);
    const reparsed = parseThemeConfig(rewritten);
    if (!reparsed.ok || reparsed.config.theme.name !== name) {
      return { ok: false, error: dataError(`${THEME_CONFIG_FILE} declara name = "${parsed.config.theme.name}" y no se ha podido reescribir como «${name}»; edítalo o instala sin --as`) };
    }
    parsed = reparsed;
    files = files.map((file) => (file.path === THEME_CONFIG_FILE ? { path: file.path, bytes: Buffer.from(rewritten, 'utf8') } : file));
  }
  const directory = resolve(context.cwd, THEMES_DIRECTORY_NAME, name);
  const existing = (await kindOf(context.datasetFileSystem, directory)) !== 'missing';
  // Con --dry-run el plan cuenta el conflicto (`replaces`) en lugar de fallar: es lo que --replace apartaría.
  if (existing && request.replace !== true && request.dryRun !== true) {
    return { ok: false, error: conflictError(`Ya existe ${directory}: usa --replace para apartarlo a ${directory}.<marca>.bak/ o --as <otro-nombre> (nunca se sobrescribe un tema)`) };
  }
  const roots = await projectThemeRoots(context);
  const shadowed = (await locateTheme(name, roots.filter((candidate) => candidate.builtin))) !== undefined;
  const digests = fileDigests(files);
  const plan: ThemeInstallPlan = {
    name,
    directory,
    kind,
    source,
    archiveSha256,
    files: files.map((file) => ({ path: file.path, bytes: file.bytes.length, sha256: digests[file.path] as string })),
    totalBytes: files.reduce((sum, file) => sum + file.bytes.length, 0),
    config: parsed.config,
    replaces: existing ? directory : undefined,
    shadowed,
  };
  if (request.dryRun === true) {
    return { ok: true, installed: { plan, written: false, backup: undefined } };
  }
  const origin: ThemeOrigin = {
    source,
    kind,
    archiveSha256,
    files: digests,
    installedAt: (context.now?.() ?? new Date()).toISOString(),
    tool: `chameleon-cv ${options.toolVersion ?? 'dev'}`,
  };
  const staging = join(resolve(context.cwd, THEMES_DIRECTORY_NAME), `.install-${name}-${options.tempSuffix ?? randomBytes(4).toString('hex')}`);
  const writer = context.artifactFileSystem;
  let backup: string | undefined;
  try {
    await writer.mkdir(staging);
    if (files.some((file) => file.path.startsWith(`${THEME_FONTS_DIRECTORY}/`))) {
      await writer.mkdir(join(staging, THEME_FONTS_DIRECTORY));
    }
    for (const file of files) {
      await writer.writeBinaryFile(join(staging, file.path), file.bytes, THEME_FILE_MODE);
    }
    await writer.writeFile(join(staging, ORIGIN_FILE), serializeOrigin(origin), THEME_FILE_MODE);
    if (existing) {
      backup = await backupDirectory(context, directory);
      await writer.rename(directory, backup);
    }
    await writer.rename(staging, directory);
  } catch (error) {
    await removeQuietly(context, staging);
    return { ok: false, error: environmentError(`No se pudo instalar el tema en ${directory}: ${describeError(error)}`) };
  }
  return { ok: true, installed: { plan, written: true, backup } };
}

export interface ThemeVerification {
  readonly name: string;
  readonly directory: string;
  readonly report: VerifyReport;
}

export type ThemeVerifyResult =
  | { readonly ok: true; readonly verifications: readonly ThemeVerification[]; readonly failed: boolean }
  | { readonly ok: false; readonly error: AppError };

/** `cv theme verify [<nombre>]` (§4.3): un tema del proyecto o todos; los distribuidos no tienen origen que verificar. */
export async function verifyThemes(context: AppContext, name?: string): Promise<ThemeVerifyResult> {
  const roots = await projectThemeRoots(context);
  const project = roots.filter((root) => !root.builtin);
  let names: readonly string[];
  if (name === undefined) {
    names = await listThemes(project);
  } else {
    if (!THEME_NAME_PATTERN.test(name)) {
      return { ok: false, error: dataError(invalidName(name)) };
    }
    if ((await locateTheme(name, project)) === undefined) {
      const builtin = await locateTheme(name, roots.filter((root) => root.builtin));
      return {
        ok: false,
        error:
          builtin === undefined
            ? notFoundError(`No existe el tema «${name}» en ${project.map((root) => root.directory).join(', ') || 'este proyecto'}`)
            : dataError(`«${name}» es un tema distribuido: no tiene origen que verificar (solo los de ${THEMES_DIRECTORY_NAME}/ del proyecto)`),
      };
    }
    names = [name];
  }
  const verifications: ThemeVerification[] = [];
  for (const root of project) {
    for (const themeName of names) {
      const directory = join(root.directory, themeName);
      verifications.push({ name: themeName, directory, report: await verifyThemeDirectory(root.fileSystem, directory) });
    }
  }
  return { ok: true, verifications, failed: verifications.some((verification) => verification.report.state === 'modified') };
}
