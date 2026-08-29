/**
 * La interfaz web servida por `cv serve` (T-7.5, docs/gui-mvp.md §4.2): los ficheros de `gui/dist` que viajan
 * como assets, por una **lista cerrada** construida al arrancar —nunca por rutas del sistema de ficheros—, con
 * tipo de contenido por extensión, caché inmutable para los ficheros con hash de Vite y CSP estricta para el
 * HTML. Sin `gui/dist` (desarrollo sin construir la GUI) el servidor sirve una página mínima que lo explica.
 */
import { extname } from 'node:path';

import { AssetError, type AssetStore } from '../shared/assets';

export const GUI_PREFIX = 'gui/dist';

/**
 * Sin código en línea ni orígenes externos; PDF en blob:, nada en marcos ajenos. `style-src` admite estilos en
 * línea porque CodeMirror inyecta los suyos con elementos <style> (style-mod); los scripts siguen estrictos.
 */
export const GUI_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; frame-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export interface StaticFile {
  /** Clave del asset (`gui/dist/assets/index-abc123.js`). */
  readonly key: string;
  readonly contentType: string;
  readonly cacheControl: string;
  readonly html: boolean;
}

export interface StaticSite {
  /** Hay un `index.html`: la interfaz viene en esta compilación. */
  readonly available: boolean;
  /** El fichero de una ruta exacta (`/`, `/assets/index-abc123.js`), o nada. */
  lookup(pathname: string): StaticFile | undefined;
}

/** Las claves del prefijo; sin el directorio (la GUI no está construida) no hay ficheros, y cualquier otro fallo se propaga. */
async function guiKeys(assets: Pick<AssetStore, 'keys'>, prefix: string): Promise<readonly string[]> {
  try {
    return await assets.keys(prefix);
  } catch (error) {
    if (error instanceof AssetError && error.code === 'missing') {
      return [];
    }
    throw error;
  }
}

/** Construye la lista cerrada a partir de las claves del prefijo; las extensiones desconocidas no se sirven. */
export async function loadStaticSite(assets: Pick<AssetStore, 'keys'>, prefix: string = GUI_PREFIX): Promise<StaticSite> {
  const files = new Map<string, StaticFile>();
  for (const key of await guiKeys(assets, prefix)) {
    const relative = key.slice(prefix.length + 1);
    const extension = extname(relative).toLowerCase();
    const contentType = CONTENT_TYPES[extension];
    if (contentType === undefined) {
      continue;
    }
    const hashed = relative.startsWith('assets/');
    files.set(relative === 'index.html' ? '/' : `/${relative}`, {
      key,
      contentType,
      cacheControl: hashed ? 'public, max-age=31536000, immutable' : 'no-store',
      html: extension === '.html',
    });
  }
  return { available: files.has('/'), lookup: (pathname) => files.get(pathname) };
}
