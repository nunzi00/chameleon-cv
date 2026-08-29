import { describe, expect, it } from 'vitest';

import { GUI_CSP, GUI_PREFIX, loadStaticSite } from '../../src/serve/static';
import { AssetError } from '../../src/shared/assets';

describe('loadStaticSite', () => {
  it('construye la lista cerrada: index en /, ficheros con hash inmutables, el resto sin caché; extensiones desconocidas fuera', async () => {
    const site = await loadStaticSite({ keys: async () => [`${GUI_PREFIX}/index.html`, `${GUI_PREFIX}/assets/index-abc123.js`, `${GUI_PREFIX}/assets/index-abc123.css`, `${GUI_PREFIX}/favicon.svg`, `${GUI_PREFIX}/assets/notas.md`, `${GUI_PREFIX}/fuente.woff2`] });
    expect(site.available).toBe(true);
    expect(site.lookup('/')).toEqual({ key: `${GUI_PREFIX}/index.html`, contentType: 'text/html; charset=utf-8', cacheControl: 'no-store', html: true });
    expect(site.lookup('/assets/index-abc123.js')).toEqual({ key: `${GUI_PREFIX}/assets/index-abc123.js`, contentType: 'text/javascript; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable', html: false });
    expect(site.lookup('/assets/index-abc123.css')?.contentType).toBe('text/css; charset=utf-8');
    expect(site.lookup('/favicon.svg')).toMatchObject({ contentType: 'image/svg+xml', cacheControl: 'no-store' });
    expect(site.lookup('/fuente.woff2')?.contentType).toBe('font/woff2');
    expect(site.lookup('/assets/notas.md')).toBeUndefined();
    expect(site.lookup('/index.html')).toBeUndefined();
    expect(site.lookup('/../package.json')).toBeUndefined();
  });

  it('sin index.html la interfaz no está disponible y la lista queda vacía', async () => {
    const site = await loadStaticSite({ keys: async () => [] }, 'otro/prefijo');
    expect(site.available).toBe(false);
    expect(site.lookup('/')).toBeUndefined();
  });

  it('sin el directorio gui/dist (GUI no construida) no hay interfaz; cualquier otro fallo del almacén se propaga', async () => {
    const missing = await loadStaticSite({ keys: () => Promise.reject(new AssetError('missing', 'No hay assets bajo «gui/dist»')) });
    expect(missing.available).toBe(false);
    await expect(loadStaticSite({ keys: () => Promise.reject(new AssetError('corrupt', 'manifiesto roto')) })).rejects.toThrow('manifiesto roto');
    await expect(loadStaticSite({ keys: () => Promise.reject(new Error('disco')) })).rejects.toThrow('disco');
  });

  it('la CSP no admite scripts en línea ni orígenes externos y prohíbe los marcos (los estilos en línea son de CodeMirror)', () => {
    expect(GUI_CSP).toContain("script-src 'self';");
    expect(GUI_CSP).toContain("style-src 'self' 'unsafe-inline'");
    expect(GUI_CSP).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(GUI_CSP).toContain("frame-ancestors 'none'");
    expect(GUI_CSP).toContain('frame-src blob:');
  });
});
