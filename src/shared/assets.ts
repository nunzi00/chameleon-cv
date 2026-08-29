/**
 * Capa unificada de assets (T-6.2, `docs/asset-layer.md`): una sola puerta para los ficheros que la
 * herramienta distribuye —temas, fuentes, plantilla Markdown, dataset de ejemplo, prompts,
 * `package.json`, worker de PDF—. En desarrollo y desde `dist/` se leen del repositorio
 * (`DiskAssets`); en el ejecutable autónomo, del propio binario (`SeaAssets`, `node:sea`), y lo que
 * deba existir como fichero real (Typst, `cv init`, `cv theme path`) se **materializa** en la caché
 * de usuario con su SHA-256 comprobado contra el manifiesto embebido, en cada uso.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import * as nodeSea from 'node:sea';

import { z } from 'zod';

import { cacheDirectory } from './cache';
import { describeError } from './errors';

export type AssetErrorCode = 'invalid-key' | 'missing' | 'corrupt' | 'unwritable';

export class AssetError extends Error {
  readonly code: AssetErrorCode;

  constructor(code: AssetErrorCode, message: string) {
    super(message);
    this.name = 'AssetError';
    this.code = code;
  }
}

export interface AssetStore {
  readonly kind: 'disk' | 'sea' | 'memory';
  /** Contenido de un asset por su clave (`themes/default/theme.toml`). */
  text(key: string): Promise<string>;
  bytes(key: string): Promise<Uint8Array>;
  /** Claves bajo un prefijo (`templates/dataset` → todos sus ficheros), ordenadas; `''` = todas. */
  keys(prefix?: string): Promise<readonly string[]>;
  /** Directorio real, legible por procesos externos y por el `FileSystem` inyectable, con todo lo que hay bajo `prefix`. */
  directory(prefix: string): Promise<string>;
}

/** Raíz del repositorio (vale desde `src/` con ts-node y desde `dist/`). */
export const REPO_ROOT = resolve(__dirname, '..', '..');

/** Clave de asset: ruta relativa POSIX, sin «..», sin segmentos vacíos ni barras invertidas. */
export function assertKey(key: string): string {
  if (key === '' || key.includes('\\') || key.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new AssetError('invalid-key', `Clave de asset inválida «${key}»: debe ser una ruta relativa POSIX sin «..»`);
  }
  return key;
}

export function assertPrefix(prefix: string): string {
  return prefix === '' ? '' : assertKey(prefix);
}

function under(key: string, prefix: string): boolean {
  return prefix === '' || key === prefix || key.startsWith(`${prefix}/`);
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

/** Ficheros bajo `root`, como rutas POSIX relativas y ordenadas. */
async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

/* ───────────────────────────── disco (desarrollo y dist/) ───────────────────────────── */

export class DiskAssets implements AssetStore {
  readonly kind = 'disk' as const;
  readonly root: string;

  constructor(root: string = REPO_ROOT) {
    this.root = root;
  }

  async bytes(key: string): Promise<Uint8Array> {
    const path = join(this.root, assertKey(key));
    try {
      return new Uint8Array(await readFile(path));
    } catch (error) {
      throw new AssetError('missing', `No existe el asset «${key}» (${path}): ${describeError(error)}`);
    }
  }

  async text(key: string): Promise<string> {
    return decode(await this.bytes(key));
  }

  async keys(prefix = ''): Promise<readonly string[]> {
    const clean = assertPrefix(prefix);
    let files: string[];
    try {
      files = await listFiles(join(this.root, clean));
    } catch (error) {
      throw new AssetError('missing', `No hay assets bajo «${prefix}» (${join(this.root, clean)}): ${describeError(error)}`);
    }
    return files.map((file) => (clean === '' ? file : `${clean}/${file}`));
  }

  async directory(prefix: string): Promise<string> {
    const path = join(this.root, assertPrefix(prefix));
    let isDirectory = false;
    try {
      isDirectory = (await stat(path)).isDirectory();
    } catch {
      isDirectory = false;
    }
    if (!isDirectory) {
      throw new AssetError('missing', `No existe el directorio de assets «${prefix}» (${path})`);
    }
    return path;
  }
}

/* ───────────────────────────── materialización con integridad ───────────────────────────── */

async function hashOfFile(path: string): Promise<string | undefined> {
  try {
    return sha256(new Uint8Array(await readFile(path)));
  } catch {
    return undefined;
  }
}

/**
 * Copia los assets bajo `prefix` a `target/<clave>` y devuelve `target/prefix`. Reescribe lo ausente o
 * alterado (comparando el SHA-256 del fichero con el esperado); con `manifestHash`, además exige que
 * cada asset figure en el manifiesto y coincida con él. Escritura atómica, directorios 0700, ficheros 0644.
 */
export async function materialize(store: Pick<AssetStore, 'keys' | 'bytes'>, prefix: string, target: string, manifestHash?: (key: string) => string | undefined): Promise<string> {
  const keys = await store.keys(prefix);
  if (keys.length === 0) {
    throw new AssetError('missing', `No hay assets bajo «${prefix}»`);
  }
  for (const key of keys) {
    const bytes = await store.bytes(key);
    const actual = sha256(bytes);
    let expected = actual;
    if (manifestHash !== undefined) {
      const declared = manifestHash(key);
      if (declared === undefined) {
        throw new AssetError('corrupt', `El asset «${key}» no figura en el manifiesto`);
      }
      if (declared !== actual) {
        throw new AssetError('corrupt', `El asset «${key}» no coincide con el manifiesto (${actual} ≠ ${declared})`);
      }
      expected = declared;
    }
    const path = join(target, key);
    if ((await hashOfFile(path)) === expected) {
      continue;
    }
    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, bytes, { mode: 0o644 });
      await rename(temporary, path);
    } catch (error) {
      throw new AssetError('unwritable', `No se pudo materializar «${key}» en ${path}: ${describeError(error)}`);
    }
  }
  return join(target, prefix);
}

/* ───────────────────────────── memoria (pruebas) ───────────────────────────── */

export class MemoryAssets implements AssetStore {
  readonly kind = 'memory' as const;
  private readonly files = new Map<string, Uint8Array>();
  private readonly materializeRoot: string | undefined;

  /** `files`: clave → contenido; `materializeRoot`: dónde materializar `directory()` (sin él, no se puede). */
  constructor(files: Readonly<Record<string, string | Uint8Array>>, materializeRoot?: string) {
    this.materializeRoot = materializeRoot;
    for (const [key, content] of Object.entries(files)) {
      this.files.set(assertKey(key), typeof content === 'string' ? new TextEncoder().encode(content) : content);
    }
  }

  async bytes(key: string): Promise<Uint8Array> {
    const found = this.files.get(assertKey(key));
    if (found === undefined) {
      throw new AssetError('missing', `No existe el asset «${key}»`);
    }
    return found;
  }

  async text(key: string): Promise<string> {
    return decode(await this.bytes(key));
  }

  async keys(prefix = ''): Promise<readonly string[]> {
    const clean = assertPrefix(prefix);
    return [...this.files.keys()].filter((key) => under(key, clean)).sort();
  }

  async directory(prefix: string): Promise<string> {
    if (this.materializeRoot === undefined) {
      throw new AssetError('unwritable', 'MemoryAssets sin directorio de materialización');
    }
    return materialize(this, assertPrefix(prefix), this.materializeRoot);
  }
}

/* ───────────────────────────── ejecutable autónomo (node:sea) ───────────────────────────── */

/** Lo que usamos de `node:sea`, inyectable en las pruebas. */
export interface SeaApi {
  isSea(): boolean;
  getAsset(key: string): ArrayBuffer;
  getAssetKeys(): string[];
}

export const ASSET_MANIFEST_KEY = 'assets-manifest.json';

export const AssetManifestSchema = z.strictObject({
  version: z.string().min(1),
  files: z.record(z.string(), z.strictObject({ sha256: z.string().regex(/^[0-9a-f]{64}$/), bytes: z.int().nonnegative() })),
});

export type AssetManifest = z.output<typeof AssetManifestSchema>;

export function parseManifest(text: string): AssetManifest {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new AssetError('corrupt', `Manifiesto de assets ilegible: ${describeError(error)}`);
  }
  const parsed = AssetManifestSchema.safeParse(data);
  if (!parsed.success) {
    throw new AssetError('corrupt', `Manifiesto de assets inválido: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  }
  return parsed.data;
}

export interface SeaAssetsOptions {
  readonly sea?: SeaApi | undefined;
  /** Raíz de la caché de usuario; por defecto la de la plataforma (`cacheDirectory`). */
  readonly cacheRoot?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly platform?: NodeJS.Platform | undefined;
  readonly home?: string | undefined;
}

export class SeaAssets implements AssetStore {
  readonly kind = 'sea' as const;
  private manifest: AssetManifest | undefined;
  private readonly options: SeaAssetsOptions;

  constructor(options: SeaAssetsOptions = {}) {
    this.options = options;
  }

  private get sea(): SeaApi {
    return this.options.sea ?? nodeSea;
  }

  private async loadManifest(): Promise<AssetManifest> {
    if (this.manifest === undefined) {
      let text: string;
      try {
        text = decode(new Uint8Array(this.sea.getAsset(ASSET_MANIFEST_KEY)));
      } catch (error) {
        throw new AssetError('corrupt', `El ejecutable no lleva el manifiesto de assets: ${describeError(error)}`);
      }
      this.manifest = parseManifest(text);
    }
    return this.manifest;
  }

  async bytes(key: string): Promise<Uint8Array> {
    assertKey(key);
    try {
      return new Uint8Array(this.sea.getAsset(key));
    } catch (error) {
      throw new AssetError('missing', `El ejecutable no lleva el asset «${key}»: ${describeError(error)}`);
    }
  }

  async text(key: string): Promise<string> {
    return decode(await this.bytes(key));
  }

  async keys(prefix = ''): Promise<readonly string[]> {
    const clean = assertPrefix(prefix);
    const manifest = await this.loadManifest();
    return Object.keys(manifest.files)
      .filter((key) => under(key, clean))
      .sort();
  }

  /** Raíz de la materialización: `<caché>/assets/<versión>`, para que dos versiones no se pisen. */
  async cacheDirectory(): Promise<string> {
    const manifest = await this.loadManifest();
    const root = this.options.cacheRoot ?? cacheDirectory(this.options.env ?? process.env, this.options.platform ?? process.platform, this.options.home ?? homedir());
    return join(root, 'assets', manifest.version);
  }

  async directory(prefix: string): Promise<string> {
    const clean = assertPrefix(prefix);
    const manifest = await this.loadManifest();
    return materialize(this, clean, await this.cacheDirectory(), (key) => manifest.files[key]?.sha256);
  }
}

/** La implementación de este proceso: el binario si es un SEA; si no, el repositorio. */
export function defaultAssets(sea: SeaApi = nodeSea): AssetStore {
  return sea.isSea() ? new SeaAssets({ sea }) : new DiskAssets(REPO_ROOT);
}
