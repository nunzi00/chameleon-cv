/**
 * Manifiesto de integridad (T-3.3, `docs/typst-integration.md` §2.3): la única fuente de verdad
 * de qué release oficial de Typst se instala, desde qué URL y con qué SHA-256, por plataforma.
 * Los hashes se calcularon descargando los assets oficiales (2026-08-28) y se revisan en cada
 * cambio de versión con un commit propio. Se valida al cargarlo: ni siquiera nuestro JSON se fía.
 */
import { z } from 'zod';

import releases from './releases.json';

/** `process.platform-process.arch` de las plataformas con binario oficial. */
export const PLATFORM_KEYS = ['linux-x64', 'linux-arm64', 'linux-arm', 'linux-riscv64', 'darwin-x64', 'darwin-arm64', 'win32-x64', 'win32-arm64'] as const;
export type PlatformKey = (typeof PLATFORM_KEYS)[number];

export const ReleaseAssetSchema = z.strictObject({
  /** Nombre del asset en el release (`typst-<target>.tar.xz` o `.zip`). */
  file: z.string().regex(/^typst-[a-z0-9_.-]+\.(tar(\.xz)?|zip)$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.int().positive(),
});

export const ReleaseManifestSchema = z.strictObject({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  baseUrl: z
    .string()
    .refine((url) => url.startsWith('https://') && url.endsWith('/'), { error: 'baseUrl debe ser https:// y terminar en /' }),
  assets: z.strictObject(Object.fromEntries(PLATFORM_KEYS.map((key) => [key, ReleaseAssetSchema])) as Record<PlatformKey, typeof ReleaseAssetSchema>),
});

export type ReleaseAsset = z.output<typeof ReleaseAssetSchema>;
export type ReleaseManifest = z.output<typeof ReleaseManifestSchema>;

/** Carga y valida el manifiesto (por defecto, el versionado en el repositorio). */
export function loadManifest(data: unknown = releases): ReleaseManifest {
  return ReleaseManifestSchema.parse(data);
}

export function platformKey(platform: string, arch: string): PlatformKey | undefined {
  const key = `${platform}-${arch}`;
  return (PLATFORM_KEYS as readonly string[]).includes(key) ? (key as PlatformKey) : undefined;
}

export function assetUrl(manifest: ReleaseManifest, key: PlatformKey): string {
  return `${manifest.baseUrl}${manifest.assets[key].file}`;
}

/** `17,5 MB` con un decimal (coma decimal, es-ES). */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1).replace('.', ',')} MB`;
}
