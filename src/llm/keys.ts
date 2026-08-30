/**
 * Claves de API de proveedores remotos (T-4.5, `docs/llm-integration.md` §5): solo desde variables
 * `CHAMELEON_<PROVEEDOR>_API_KEY` o desde `~/.config/chameleon-cv/keys.json` con permisos 0600.
 * Nunca se piden de forma interactiva, nunca se escriben, nunca se imprimen (ni enmascaradas en
 * logs: solo su procedencia). Una clave en un fichero con permisos abiertos se rechaza.
 */
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import { describeError } from '../shared/errors';
import { REMOTE_PROVIDERS, REMOTE_PROVIDER_IDS, type RemoteProviderId } from './registry';

export const KEY_ENV_VARIABLES: Readonly<Record<RemoteProviderId, string>> = Object.fromEntries(REMOTE_PROVIDERS.map((entry) => [entry.id, entry.keyEnv])) as Record<RemoteProviderId, string>;

/** Una clave opcional por proveedor del registro; cualquier otra clave es un error. */
const KeysFileSchema = z.strictObject(Object.fromEntries(REMOTE_PROVIDER_IDS.map((id) => [id, z.string().min(1).optional()])) as Record<RemoteProviderId, z.ZodOptional<z.ZodString>>);

export type KeySource = 'env' | 'file';

export type ApiKeyResult =
  | { readonly ok: true; readonly key: string; readonly source: KeySource }
  | { readonly ok: false; readonly code: 'missing' | 'insecure-file' | 'invalid-file'; readonly message: string };

/** `~/.config/chameleon-cv/keys.json` (o `$XDG_CONFIG_HOME`; `%APPDATA%` en Windows). */
export function keysFilePath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = homedir()): string {
  const base = platform === 'win32' ? (env['APPDATA'] ?? join(home, 'AppData', 'Roaming')) : (env['XDG_CONFIG_HOME'] ?? join(home, '.config'));
  return join(base, 'chameleon-cv', 'keys.json');
}

export interface KeyLookupOptions {
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly platform?: NodeJS.Platform | undefined;
  readonly home?: string | undefined;
  /** Ruta explícita del fichero de claves (por defecto, la de la plataforma). */
  readonly keysFile?: string | undefined;
}

function missing(provider: RemoteProviderId, file: string): ApiKeyResult {
  return {
    ok: false,
    code: 'missing',
    message: `No hay clave para «${provider}»: define ${KEY_ENV_VARIABLES[provider]} o añádela a ${file} (permisos 0600, {"${provider}": "…"})`,
  };
}

/** Busca la clave de un proveedor: variable de entorno primero, después el fichero de claves. */
export async function resolveApiKey(provider: RemoteProviderId, options: KeyLookupOptions = {}): Promise<ApiKeyResult> {
  const env = options.env ?? process.env;
  const fromEnv = env[KEY_ENV_VARIABLES[provider]];
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return { ok: true, key: fromEnv.trim(), source: 'env' };
  }
  const file = options.keysFile ?? keysFilePath(env, options.platform ?? process.platform, options.home ?? homedir());
  let mode: number;
  try {
    mode = (await stat(file)).mode;
  } catch {
    return missing(provider, file);
  }
  if ((options.platform ?? process.platform) !== 'win32' && (mode & 0o077) !== 0) {
    return { ok: false, code: 'insecure-file', message: `El fichero de claves ${file} es legible por otros usuarios (permisos ${(mode & 0o777).toString(8)}); corrígelo con «chmod 600» antes de usarlo` };
  }
  let parsed: z.infer<typeof KeysFileSchema>;
  try {
    parsed = KeysFileSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  } catch (error) {
    return { ok: false, code: 'invalid-file', message: `El fichero de claves ${file} no es válido: ${describeError(error)}` };
  }
  const key = parsed[provider];
  return key === undefined ? missing(provider, file) : { ok: true, key: key.trim(), source: 'file' };
}

export type KeyWriteResult = { readonly ok: true; readonly file: string } | { readonly ok: false; readonly message: string };

type KeysFile = z.infer<typeof KeysFileSchema>;

/** El contenido actual del fichero de claves, o `{}` si no existe; un fichero inseguro o inválido no se toca. */
async function readKeysFile(file: string, platform: NodeJS.Platform): Promise<{ readonly ok: true; readonly keys: KeysFile } | { readonly ok: false; readonly message: string }> {
  let mode: number;
  try {
    mode = (await stat(file)).mode;
  } catch {
    return { ok: true, keys: {} };
  }
  if (platform !== 'win32' && (mode & 0o077) !== 0) {
    return { ok: false, message: `El fichero de claves ${file} es legible por otros usuarios (permisos ${(mode & 0o777).toString(8)}); corrígelo con chmod 600 antes de modificarlo` };
  }
  try {
    return { ok: true, keys: KeysFileSchema.parse(JSON.parse(await readFile(file, 'utf8'))) };
  } catch (error) {
    return { ok: false, message: `El fichero de claves ${file} no es válido: ${describeError(error)}` };
  }
}

async function saveKeysFile(file: string, keys: KeysFile): Promise<KeyWriteResult> {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(temporary, `${JSON.stringify(keys, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, file);
  } catch (error) {
    return { ok: false, message: `No se pudo escribir el fichero de claves ${file}: ${describeError(error)}` };
  }
  return { ok: true, file };
}

function keysFileFor(options: KeyLookupOptions): { readonly file: string; readonly platform: NodeJS.Platform } {
  const platform = options.platform ?? process.platform;
  return { platform, file: options.keysFile ?? keysFilePath(options.env ?? process.env, platform, options.home ?? homedir()) };
}

/** Guarda (o sustituye) la clave de un proveedor en el fichero de claves (0600, directorio 0700). Nunca la imprime. */
export async function writeApiKey(provider: RemoteProviderId, key: string, options: KeyLookupOptions = {}): Promise<KeyWriteResult> {
  const trimmed = key.trim();
  if (trimmed === '') {
    return { ok: false, message: 'La clave está vacía' };
  }
  if (/[\r\n]/.test(trimmed)) {
    return { ok: false, message: 'La clave no puede contener saltos de línea' };
  }
  const { file, platform } = keysFileFor(options);
  const current = await readKeysFile(file, platform);
  if (!current.ok) {
    return current;
  }
  return saveKeysFile(file, { ...current.keys, [provider]: trimmed });
}

export type KeyRemoveResult = { readonly ok: true; readonly file: string; readonly removed: boolean } | { readonly ok: false; readonly message: string };

/** Elimina la clave de un proveedor del fichero de claves; si no estaba, lo dice. */
export async function removeApiKey(provider: RemoteProviderId, options: KeyLookupOptions = {}): Promise<KeyRemoveResult> {
  const { file, platform } = keysFileFor(options);
  const current = await readKeysFile(file, platform);
  if (!current.ok) {
    return current;
  }
  if (current.keys[provider] === undefined) {
    return { ok: true, file, removed: false };
  }
  const rest: KeysFile = { ...current.keys };
  delete rest[provider];
  const saved = await saveKeysFile(file, rest);
  return saved.ok ? { ok: true, file, removed: true } : saved;
}

/** Procedencia de las claves definidas, sin valores (para `cv llm status`). */
export async function describeKeys(options: KeyLookupOptions = {}): Promise<Record<RemoteProviderId, KeySource | 'none' | 'insecure-file' | 'invalid-file'>> {
  const result = {} as Record<RemoteProviderId, KeySource | 'none' | 'insecure-file' | 'invalid-file'>;
  for (const provider of REMOTE_PROVIDER_IDS) {
    const lookup = await resolveApiKey(provider, options);
    result[provider] = lookup.ok ? lookup.source : lookup.code === 'missing' ? 'none' : lookup.code;
  }
  return result;
}
