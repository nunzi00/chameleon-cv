/**
 * Caché local de respuestas (T-4.3, canon C8 y C10): repetir una petición idéntica es gratis e
 * idéntico. Clave = SHA-256 de (tarea, versión del prompt, proveedor, modelo, entrada
 * seudonimizada). Solo se guardan respuestas válidas; ficheros 0600 en la caché de usuario;
 * `cv llm cache clear` la vacía. Almacén inyectable para las pruebas.
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { cacheDirectory } from '../renderers/typst/engine';
import type { LlmUsage } from './provider';

export interface LlmCacheEntry {
  readonly createdAt: string;
  readonly model: string;
  readonly raw: string;
  readonly json: unknown;
  readonly usage: LlmUsage;
  readonly elapsedMs: number;
}

export interface LlmCacheStore {
  get(key: string): Promise<LlmCacheEntry | undefined>;
  set(key: string, entry: LlmCacheEntry): Promise<void>;
  /** Vacía la caché; devuelve cuántas entradas había. */
  clear(): Promise<number>;
}

const EntrySchema = z.strictObject({
  createdAt: z.string(),
  model: z.string(),
  raw: z.string(),
  json: z.unknown(),
  usage: z.strictObject({ promptTokens: z.number().optional(), completionTokens: z.number().optional() }),
  elapsedMs: z.number(),
});

/** JSON canónico (claves ordenadas) para que la clave no dependa del orden de construcción. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b, 'en'));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export interface CacheKeyParts {
  readonly task: string;
  readonly promptVersion: string;
  readonly provider: string;
  readonly model: string;
  readonly input: unknown;
}

export function cacheKey(parts: CacheKeyParts): string {
  return createHash('sha256').update(canonicalJson(parts)).digest('hex');
}

export class MemoryLlmCache implements LlmCacheStore {
  private readonly entries = new Map<string, LlmCacheEntry>();

  get(key: string): Promise<LlmCacheEntry | undefined> {
    return Promise.resolve(this.entries.get(key));
  }

  set(key: string, entry: LlmCacheEntry): Promise<void> {
    this.entries.set(key, entry);
    return Promise.resolve();
  }

  clear(): Promise<number> {
    const count = this.entries.size;
    this.entries.clear();
    return Promise.resolve(count);
  }

  get size(): number {
    return this.entries.size;
  }
}

/** `<caché de usuario>/chameleon-cv/llm`. */
export function llmCacheDirectory(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = homedir()): string {
  return join(cacheDirectory(env, platform, home), 'llm');
}

/** Almacén en disco: un fichero JSON (0600) por clave; una entrada corrupta cuenta como ausente. */
export function createNodeLlmCache(directory: string = llmCacheDirectory()): LlmCacheStore {
  const pathOf = (key: string): string => join(directory, `${key}.json`);
  return {
    async get(key) {
      let text: string;
      try {
        text = await readFile(pathOf(key), 'utf8');
      } catch {
        return undefined;
      }
      try {
        const parsed = EntrySchema.safeParse(JSON.parse(text));
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    },
    async set(key, entry) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(pathOf(key), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    },
    async clear() {
      let names: string[];
      try {
        names = (await readdir(directory)).filter((name) => name.endsWith('.json'));
      } catch {
        return 0;
      }
      await rm(directory, { recursive: true, force: true });
      return names.length;
    },
  };
}
