/**
 * Claves de API de proveedores remotos (T-4.5, `docs/llm-integration.md` §5): solo desde variables
 * `CHAMELEON_<PROVEEDOR>_API_KEY` o desde `~/.config/chameleon-cv/keys.json` con permisos 0600.
 * Nunca se piden de forma interactiva, nunca se escriben, nunca se imprimen (ni enmascaradas en
 * logs: solo su procedencia). Una clave en un fichero con permisos abiertos se rechaza.
 */
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { describeError } from '../shared/errors';

export type RemoteProviderId = 'openai' | 'anthropic';

export const KEY_ENV_VARIABLES: Readonly<Record<RemoteProviderId, string>> = {
  openai: 'CHAMELEON_OPENAI_API_KEY',
  anthropic: 'CHAMELEON_ANTHROPIC_API_KEY',
};

const KeysFileSchema = z.strictObject({
  openai: z.string().min(1).optional(),
  anthropic: z.string().min(1).optional(),
});

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

/** Procedencia de las claves definidas, sin valores (para `cv llm status`). */
export async function describeKeys(options: KeyLookupOptions = {}): Promise<Record<RemoteProviderId, KeySource | 'none' | 'insecure-file' | 'invalid-file'>> {
  const result = {} as Record<RemoteProviderId, KeySource | 'none' | 'insecure-file' | 'invalid-file'>;
  for (const provider of ['openai', 'anthropic'] as const) {
    const lookup = await resolveApiKey(provider, options);
    result[provider] = lookup.ok ? lookup.source : lookup.code === 'missing' ? 'none' : lookup.code;
  }
  return result;
}
