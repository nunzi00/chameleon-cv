/**
 * Lector de archivos de temas (T-8.3, docs/theme-gallery.md §4.2 paso 3 y §7): `.zip` y `.tar.gz` leídos en el
 * propio proceso —directorio central y entradas «store» o «deflate» con `zlib`; `gunzip` y cabeceras ustar—, sin
 * `tar` del sistema ni procesos, y una política de entradas cerrada: un único directorio raíz opcional, solo los
 * ficheros de un tema, nombres con el patrón de los temas, sin `..`, rutas absolutas, enlaces ni dispositivos, y
 * límites por fichero, totales y de entradas. Cualquier otra cosa es un error que nombra la entrada.
 */
import { crc32, gunzipSync, inflateRawSync } from 'node:zlib';

import { describeError } from '../shared/errors';
import { THEME_CONFIG_FILE, THEME_FONTS_DIRECTORY, THEME_TEMPLATE_FILE } from './loader';
import { THEME_NAME_PATTERN } from './schema';

export const ARCHIVE_LIMITS = {
  /** Entradas del archivo (ficheros y directorios). */
  maxEntries: 40,
  maxFileBytes: 2 * 1024 * 1024,
  maxFontBytes: 8 * 1024 * 1024,
  /** Bytes descomprimidos en total. */
  maxTotalBytes: 16 * 1024 * 1024,
} as const;

export type ArchiveKind = 'zip' | 'tar.gz';

/** Ficheros admitidos en la raíz del tema; las fuentes van en `fonts/<nombre>.ttf|otf`. */
export const THEME_ROOT_FILES: readonly string[] = [THEME_CONFIG_FILE, THEME_TEMPLATE_FILE, 'README.md', 'LICENSE'];
export const FONT_FILE_PATTERN = /^[a-z0-9][a-z0-9-]*\.(ttf|otf)$/;

export type RawEntryType = 'file' | 'directory' | 'symlink' | 'other';

/** Entrada tal como viene en el archivo o en el directorio, antes de la política; solo los ficheros tienen contenido. */
export type RawEntry =
  | {
      readonly path: string;
      readonly type: 'file';
      /** Tamaño descomprimido declarado. */
      readonly size: number;
      /** Contenido; se descomprime bajo demanda y nunca más allá de `limit` bytes. */
      readonly read: (limit: number) => Uint8Array;
    }
  | { readonly path: string; readonly type: 'directory' }
  | { readonly path: string; readonly type: 'symlink' }
  | { readonly path: string; readonly type: 'other' };

/** Fichero del tema ya admitido: ruta relativa a la raíz del tema (`theme.toml`, `fonts/x.ttf`…). */
export interface ThemeFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface ThemeArchive {
  /** Directorio raíz del archivo, si lo tenía (candidato a nombre del tema). */
  readonly root: string | undefined;
  readonly files: readonly ThemeFile[];
}

export type ThemeArchiveResult = { readonly ok: true; readonly archive: ThemeArchive } | { readonly ok: false; readonly message: string };

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveError';
  }
}

/** Por la firma, no por la extensión: `PK` (zip) o `1f 8b` (gzip). */
export function detectArchiveKind(bytes: Uint8Array): ArchiveKind | undefined {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05) && (bytes[3] === 0x04 || bytes[3] === 0x06)) {
    return 'zip';
  }
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return 'tar.gz';
  }
  return undefined;
}

/* ───────────────────────────────── zip ───────────────────────────────── */

const ZIP_LOCAL = 0x04034b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_END = 0x06054b50;
const ZIP64_MARK = 0xffffffff;
const ZIP_METHODS: Readonly<Record<number, string>> = { 0: 'store', 8: 'deflate' };

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const data = view(bytes);
  const floor = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= floor; offset -= 1) {
    if (data.getUint32(offset, true) === ZIP_END) {
      return offset;
    }
  }
  throw new ArchiveError('No es un archivo zip válido: falta el fin del directorio central');
}

function zipEntryType(name: string, externalAttributes: number): RawEntryType {
  const mode = (externalAttributes >>> 16) & 0xf000;
  if (mode === 0xa000) {
    return 'symlink';
  }
  if (mode === 0x4000 || (mode === 0 && name.endsWith('/'))) {
    return 'directory';
  }
  if (mode === 0x8000 || mode === 0) {
    return 'file';
  }
  return 'other';
}

function zipRead(name: string, method: number, compressed: Uint8Array, uncompressedSize: number, crc: number): (limit: number) => Uint8Array {
  return (limit) => {
    if (uncompressedSize > limit) {
      throw new ArchiveError(`La entrada «${name}» pesa ${uncompressedSize} bytes; el máximo es ${limit}`);
    }
    let content: Uint8Array;
    if (method === 0) {
      content = compressed;
    } else {
      try {
        content = inflateRawSync(compressed, { maxOutputLength: Math.max(1, uncompressedSize) });
      } catch (error) {
        throw new ArchiveError(`La entrada «${name}» está corrupta: ${describeError(error)}`);
      }
    }
    if (content.length !== uncompressedSize || crc32(content) !== crc) {
      throw new ArchiveError(`La entrada «${name}» está corrupta: tamaño o CRC-32 distintos de los declarados`);
    }
    return content;
  };
}

/** Entradas de un zip: directorio central (la fuente de verdad de tamaños y CRC) y cabecera local de cada una. */
export function readZipEntries(bytes: Uint8Array): RawEntry[] {
  const data = view(bytes);
  const end = findEndOfCentralDirectory(bytes);
  const count = data.getUint16(end + 10, true);
  const directoryOffset = data.getUint32(end + 16, true);
  if (count === 0xffff || directoryOffset === ZIP64_MARK || data.getUint32(end + 12, true) === ZIP64_MARK) {
    throw new ArchiveError('No se admiten archivos zip64');
  }
  const entries: RawEntry[] = [];
  let offset = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.length || data.getUint32(offset, true) !== ZIP_CENTRAL) {
      throw new ArchiveError(`Archivo zip corrupto: directorio central truncado en la entrada ${index + 1} de ${count}`);
    }
    const flags = data.getUint16(offset + 8, true);
    const method = data.getUint16(offset + 10, true);
    const crc = data.getUint32(offset + 16, true);
    const compressedSize = data.getUint32(offset + 20, true);
    const uncompressedSize = data.getUint32(offset + 24, true);
    const nameLength = data.getUint16(offset + 28, true);
    const extraLength = data.getUint16(offset + 30, true);
    const commentLength = data.getUint16(offset + 32, true);
    const externalAttributes = data.getUint32(offset + 38, true);
    const localOffset = data.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if ((flags & 0x1) !== 0) {
      throw new ArchiveError(`La entrada «${name}» está cifrada: no se admite`);
    }
    if (compressedSize === ZIP64_MARK || uncompressedSize === ZIP64_MARK || localOffset === ZIP64_MARK) {
      throw new ArchiveError('No se admiten archivos zip64');
    }
    const type = zipEntryType(name, externalAttributes);
    if (type === 'file' && ZIP_METHODS[method] === undefined) {
      throw new ArchiveError(`La entrada «${name}» usa el método de compresión ${method}; solo se admiten store y deflate`);
    }
    if (localOffset + 30 > bytes.length || data.getUint32(localOffset, true) !== ZIP_LOCAL) {
      throw new ArchiveError(`Archivo zip corrupto: la cabecera local de «${name}» no está donde el directorio central dice`);
    }
    const dataStart = localOffset + 30 + data.getUint16(localOffset + 26, true) + data.getUint16(localOffset + 28, true);
    if (dataStart + compressedSize > bytes.length) {
      throw new ArchiveError(`Archivo zip truncado: faltan datos de «${name}»`);
    }
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    entries.push(type === 'file' ? { path: name, type, size: uncompressedSize, read: zipRead(name, method, compressed, uncompressedSize, crc) } : { path: name, type });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/* ──────────────────────────────── tar.gz ─────────────────────────────── */

const TAR_BLOCK = 512;

function tarString(block: Uint8Array, start: number, length: number): string {
  const field = block.subarray(start, start + length);
  const end = field.indexOf(0);
  return new TextDecoder().decode(end === -1 ? field : field.subarray(0, end));
}

function tarNumber(block: Uint8Array, start: number, length: number, what: string, name: string): number {
  const text = tarString(block, start, length).trim();
  if (!/^[0-7]*$/.test(text)) {
    throw new ArchiveError(`Archivo tar corrupto: ${what} de «${name}» no es octal («${text}»)`);
  }
  return Number.parseInt(`0${text}`, 8);
}

function tarChecksumMatches(block: Uint8Array): boolean {
  let sum = 0;
  for (const [index, byte] of block.entries()) {
    sum += index >= 148 && index < 156 ? 0x20 : byte;
  }
  return sum === tarNumber(block, 148, 8, 'la suma de comprobación', '?');
}

function tarEntryType(flag: string): RawEntryType {
  switch (flag) {
    case '0':
    case '\0':
    case '':
      return 'file';
    case '5':
      return 'directory';
    case '1':
    case '2':
      return 'symlink';
    default:
      return 'other';
  }
}

/** Descomprime con límite y recorre las cabeceras ustar (sin nombres largos GNU ni cabeceras pax). */
export function readTarGzEntries(bytes: Uint8Array): RawEntry[] {
  let tar: Uint8Array;
  try {
    tar = gunzipSync(bytes, { maxOutputLength: ARCHIVE_LIMITS.maxTotalBytes + (ARCHIVE_LIMITS.maxEntries + 4) * TAR_BLOCK * 2 });
  } catch (error) {
    const message = describeError(error);
    throw new ArchiveError(
      /maxOutputLength|larger than/i.test(message) ? `El archivo descomprimido supera los ${ARCHIVE_LIMITS.maxTotalBytes} bytes admitidos` : `Archivo gzip corrupto: ${message}`,
    );
  }
  const entries: RawEntry[] = [];
  let offset = 0;
  while (offset + TAR_BLOCK <= tar.length) {
    const block = tar.subarray(offset, offset + TAR_BLOCK);
    if (block.every((byte) => byte === 0)) {
      break;
    }
    const name = tarString(block, 0, 100);
    if (!tarChecksumMatches(block)) {
      throw new ArchiveError(`Archivo tar corrupto: la suma de comprobación de «${name}» no cuadra`);
    }
    const size = tarNumber(block, 124, 12, 'el tamaño', name);
    const flag = tarString(block, 156, 1);
    // En un tar v7 (sin «ustar») el campo prefijo son ceros: leerlo siempre es inocuo.
    const prefix = tarString(block, 345, 155);
    const path = prefix === '' ? name : `${prefix}/${name}`;
    const type = tarEntryType(flag);
    if (type === 'other') {
      throw new ArchiveError(`La entrada «${path}» es de tipo «${flag}»: solo se admiten ficheros y directorios`);
    }
    const dataStart = offset + TAR_BLOCK;
    if (dataStart + size > tar.length) {
      throw new ArchiveError(`Archivo tar truncado: faltan datos de «${path}»`);
    }
    const content = tar.subarray(dataStart, dataStart + size);
    entries.push(
      type === 'file'
        ? {
            path,
            type,
            size,
            read: (limit) => {
              if (size > limit) {
                throw new ArchiveError(`La entrada «${path}» pesa ${size} bytes; el máximo es ${limit}`);
              }
              return content;
            },
          }
        : { path, type },
    );
    offset = dataStart + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
  }
  return entries;
}

/* ─────────────────────────── política de entradas ────────────────────── */

const ALLOWED_LIST = `solo ${THEME_ROOT_FILES.join(', ')} y ${THEME_FONTS_DIRECTORY}/<nombre>.ttf|otf (nombres en minúsculas, dígitos y guiones)`;

function segmentsOf(path: string): string[] {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  if (trimmed.startsWith('/') || trimmed.includes('\\') || /^[A-Za-z]:/.test(trimmed)) {
    throw new ArchiveError(`La entrada «${path}» es una ruta absoluta: no se admite`);
  }
  const segments = trimmed.split('/');
  for (const segment of segments) {
    if (segment === '..') {
      throw new ArchiveError(`La entrada «${path}» sale del tema («..»): no se admite`);
    }
    if (segment === '' || segment === '.') {
      throw new ArchiveError(`La entrada «${path}» tiene una ruta no admitida`);
    }
  }
  return segments;
}

function fileLimit(relative: readonly string[], path: string): number {
  // `relative` nunca está vacío aquí (la raíz se descarta antes): las aserciones evitan ramas muertas.
  if (relative.length === 1 && THEME_ROOT_FILES.includes(relative[0] as string)) {
    return ARCHIVE_LIMITS.maxFileBytes;
  }
  if (relative.length === 2 && relative[0] === THEME_FONTS_DIRECTORY && FONT_FILE_PATTERN.test(relative[1] as string)) {
    return ARCHIVE_LIMITS.maxFontBytes;
  }
  throw new ArchiveError(`La entrada «${path}» no se admite: ${ALLOWED_LIST}`);
}

/**
 * Aplica la política a las entradas crudas (de un archivo o de un directorio local) y devuelve los ficheros del
 * tema con su contenido. Un único directorio raíz es opcional: si todas las entradas cuelgan del mismo nombre y ese
 * nombre no es un fichero del tema, es la raíz (y debe cumplir el patrón de los nombres de tema).
 */
export function applyEntryPolicy(raw: readonly RawEntry[]): ThemeArchive {
  if (raw.length === 0) {
    throw new ArchiveError('El archivo está vacío');
  }
  if (raw.length > ARCHIVE_LIMITS.maxEntries) {
    throw new ArchiveError(`El archivo tiene ${raw.length} entradas; el máximo es ${ARCHIVE_LIMITS.maxEntries}`);
  }
  const parsed = raw.map((entry) => ({ entry, segments: segmentsOf(entry.path) }));
  const tops = new Set(parsed.map(({ segments }) => segments[0] as string));
  const [single] = tops;
  const root = tops.size === 1 && single !== undefined && !THEME_ROOT_FILES.includes(single) && single !== THEME_FONTS_DIRECTORY ? single : undefined;
  if (root !== undefined && !THEME_NAME_PATTERN.test(root)) {
    throw new ArchiveError(`El directorio raíz «${root}» no es un nombre de tema válido: minúsculas, dígitos y guiones`);
  }
  const files = new Map<string, Uint8Array>();
  let total = 0;
  for (const { entry, segments } of parsed) {
    const relative = root === undefined ? segments : segments.slice(1);
    if (entry.type === 'symlink') {
      throw new ArchiveError(`La entrada «${entry.path}» es un enlace: no se admiten enlaces simbólicos ni duros`);
    }
    if (entry.type === 'other') {
      throw new ArchiveError(`La entrada «${entry.path}» no es un fichero ni un directorio: no se admite`);
    }
    if (relative.length === 0) {
      continue; // el propio directorio raíz
    }
    if (entry.type === 'directory') {
      if (relative.length === 1 && relative[0] === THEME_FONTS_DIRECTORY) {
        continue;
      }
      throw new ArchiveError(`El directorio «${entry.path}» no se admite: ${ALLOWED_LIST}`);
    }
    const limit = fileLimit(relative, entry.path);
    if (entry.size > limit) {
      throw new ArchiveError(`La entrada «${entry.path}» pesa ${entry.size} bytes; el máximo es ${limit}`);
    }
    total += entry.size;
    if (total > ARCHIVE_LIMITS.maxTotalBytes) {
      throw new ArchiveError(`El contenido supera los ${ARCHIVE_LIMITS.maxTotalBytes} bytes admitidos en total`);
    }
    const path = relative.join('/');
    if (files.has(path)) {
      throw new ArchiveError(`La entrada «${entry.path}» está repetida`);
    }
    files.set(path, entry.read(limit));
  }
  return { root, files: [...files.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([path, bytes]) => ({ path, bytes })) };
}

/** Lee un archivo completo (zip o tar.gz, por su firma) y aplica la política; nunca lanza. */
export function readThemeArchive(bytes: Uint8Array): ThemeArchiveResult {
  try {
    const kind = detectArchiveKind(bytes);
    if (kind === undefined) {
      throw new ArchiveError('El fichero no es un archivo zip ni tar.gz (firma desconocida)');
    }
    return { ok: true, archive: applyEntryPolicy(kind === 'zip' ? readZipEntries(bytes) : readTarGzEntries(bytes)) };
  } catch (error) {
    return { ok: false, message: error instanceof ArchiveError ? error.message : `No se pudo leer el archivo: ${describeError(error)}` };
  }
}
