import { describe, expect, it } from 'vitest';

import { TYPST_VERSION } from '../../src/renderers/typst';
import { PLATFORM_KEYS, assetUrl, formatMegabytes, loadManifest, platformKey } from '../../src/typst';

describe('manifiesto de integridad (src/typst/releases.json)', () => {
  it('es válido, fija la misma versión que el motor y cubre las ocho plataformas con hashes SHA-256', () => {
    const manifest = loadManifest();
    expect(manifest.version).toBe(TYPST_VERSION);
    expect(manifest.baseUrl).toBe(`https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/`);
    expect(Object.keys(manifest.assets).sort()).toEqual([...PLATFORM_KEYS].sort());
    for (const key of PLATFORM_KEYS) {
      const asset = manifest.assets[key];
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.size).toBeGreaterThan(10_000_000);
      expect(asset.file.startsWith('typst-')).toBe(true);
      expect(assetUrl(manifest, key)).toBe(`${manifest.baseUrl}${asset.file}`);
      expect(asset.file.endsWith(key.startsWith('win32') ? '.zip' : '.tar.xz')).toBe(true);
    }
    expect(new Set(Object.values(manifest.assets).map((asset) => asset.sha256)).size).toBe(PLATFORM_KEYS.length);
  });

  it('rechaza manifiestos incompletos o con hashes mal formados', () => {
    const manifest = loadManifest();
    expect(() => loadManifest({ ...manifest, assets: { ...manifest.assets, 'linux-x64': { ...manifest.assets['linux-x64'], sha256: 'abc' } } })).toThrow();
    const { 'darwin-x64': _omitted, ...incomplete } = manifest.assets;
    expect(() => loadManifest({ ...manifest, assets: incomplete })).toThrow();
    expect(() => loadManifest({ ...manifest, baseUrl: 'http://example.com/' })).toThrow(/https/);
    expect(() => loadManifest({ ...manifest, extra: true })).toThrow();
  });

  it('traduce plataforma y arquitectura de Node a la clave del manifiesto', () => {
    expect(platformKey('linux', 'x64')).toBe('linux-x64');
    expect(platformKey('win32', 'arm64')).toBe('win32-arm64');
    expect(platformKey('freebsd', 'x64')).toBeUndefined();
    expect(platformKey('win32', 'ia32')).toBeUndefined();
    expect(formatMegabytes(17_462_992)).toBe('17,5 MB');
    expect(formatMegabytes(0)).toBe('0,0 MB');
  });
});
