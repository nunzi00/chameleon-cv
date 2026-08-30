/**
 * Origen y huellas de un tema instalado (T-8.3, docs/theme-gallery.md §4.2 paso 5 y §4.3): `.origin.json` guarda
 * de dónde vino, la huella del archivo y la de cada fichero; `verify` las recalcula. El cargador ignora el
 * fichero (no forma parte del tema) y una copia con `cv theme create` no lo lleva: es un tema nuevo del usuario.
 */
import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { FileSystem } from '../parsers';
import { describeError } from '../shared/errors';
import type { ThemeFile } from './archive';
import { THEME_FONTS_DIRECTORY } from './loader';

export const ORIGIN_FILE = '.origin.json';
export const ORIGIN_KINDS = ['url', 'archive', 'directory'] as const;
export type OriginKind = (typeof ORIGIN_KINDS)[number];

const SHA256 = z.string().regex(/^[0-9a-f]{64}$/, { error: 'huella SHA-256 inválida' });

export const ThemeOriginSchema = z.strictObject({
  source: z.string().min(1),
  kind: z.enum(ORIGIN_KINDS),
  archiveSha256: SHA256,
  files: z.record(z.string().min(1), SHA256),
  installedAt: z.iso.datetime(),
  tool: z.string().min(1),
});

export type ThemeOrigin = z.output<typeof ThemeOriginSchema>;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Huella de cada fichero, con las rutas ordenadas. */
export function fileDigests(files: readonly ThemeFile[]): Record<string, string> {
  const digests: Record<string, string> = {};
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    digests[file.path] = sha256Hex(file.bytes);
  }
  return digests;
}

/** Huella canónica de un directorio (sin archivo): SHA-256 de «ruta\nhuella\n» por fichero, en orden. */
export function canonicalDigest(files: readonly ThemeFile[]): string {
  const digests = fileDigests(files);
  return sha256Hex(Buffer.from(Object.entries(digests).map(([path, digest]) => `${path}\n${digest}\n`).join(''), 'utf8'));
}

export function serializeOrigin(origin: ThemeOrigin): string {
  const ordered: ThemeOrigin = { source: origin.source, kind: origin.kind, archiveSha256: origin.archiveSha256, files: origin.files, installedAt: origin.installedAt, tool: origin.tool };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export type OriginParseResult = { readonly ok: true; readonly origin: ThemeOrigin } | { readonly ok: false; readonly message: string };

export function parseOrigin(text: string): OriginParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, message: `${ORIGIN_FILE} no es JSON válido: ${describeError(error)}` };
  }
  const parsed = ThemeOriginSchema.safeParse(value);
  return parsed.success
    ? { ok: true, origin: parsed.data }
    : { ok: false, message: `${ORIGIN_FILE} inválido: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || '<raíz>'}: ${issue.message}`).join('; ')}` };
}

export type VerifyState = 'intact' | 'modified' | 'none';
export type FileVerification = 'ok' | 'modified' | 'missing' | 'added';

export interface VerifiedFile {
  readonly path: string;
  readonly state: FileVerification;
}

export interface VerifyReport {
  readonly state: VerifyState;
  readonly origin: ThemeOrigin | undefined;
  readonly files: readonly VerifiedFile[];
  /** `.origin.json` presente pero ilegible: se considera modificado. */
  readonly problem: string | undefined;
}

async function readOriginFile(fileSystem: FileSystem, directory: string): Promise<{ readonly text: string } | undefined> {
  try {
    return { text: await fileSystem.readTextFile(`${directory}/${ORIGIN_FILE}`) };
  } catch {
    return undefined;
  }
}

/** Ficheros presentes en el directorio del tema (raíz y `fonts/`), sin `.origin.json`. */
export async function listThemeFiles(fileSystem: FileSystem, directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await fileSystem.readDirectory(directory)) {
    if (entry.kind === 'file' && entry.name !== ORIGIN_FILE) {
      found.push(entry.name);
    } else if (entry.kind === 'directory' && entry.name === THEME_FONTS_DIRECTORY) {
      for (const font of await fileSystem.readDirectory(`${directory}/${THEME_FONTS_DIRECTORY}`)) {
        if (font.kind === 'file') {
          found.push(`${THEME_FONTS_DIRECTORY}/${font.name}`);
        }
      }
    }
  }
  return found.sort();
}

/** Recalcula las huellas de un tema con origen: intacto, modificado (con cada fichero) o sin origen registrado. */
export async function verifyThemeDirectory(fileSystem: FileSystem, directory: string): Promise<VerifyReport> {
  const file = await readOriginFile(fileSystem, directory);
  if (file === undefined) {
    return { state: 'none', origin: undefined, files: [], problem: undefined };
  }
  const parsed = parseOrigin(file.text);
  if (!parsed.ok) {
    return { state: 'modified', origin: undefined, files: [], problem: parsed.message };
  }
  const present = await listThemeFiles(fileSystem, directory);
  const files: VerifiedFile[] = [];
  for (const [path, digest] of Object.entries(parsed.origin.files)) {
    if (!present.includes(path)) {
      files.push({ path, state: 'missing' });
      continue;
    }
    files.push({ path, state: sha256Hex(await fileSystem.readBinaryFile(`${directory}/${path}`)) === digest ? 'ok' : 'modified' });
  }
  for (const path of present) {
    if (parsed.origin.files[path] === undefined) {
      files.push({ path, state: 'added' });
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { state: files.every((entry) => entry.state === 'ok') ? 'intact' : 'modified', origin: parsed.origin, files, problem: undefined };
}
