/**
 * Caché de usuario de Chameleon CV (T-3.3, T-6.2): un único directorio por plataforma para el binario
 * de Typst, las respuestas del co-piloto y los assets materializados del ejecutable autónomo.
 */
import { join } from 'node:path';

export function cacheDirectory(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string {
  if (platform === 'win32') {
    return join(env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local'), 'chameleon-cv');
  }
  if (platform === 'darwin') {
    return join(home, 'Library', 'Caches', 'chameleon-cv');
  }
  return join(env['XDG_CACHE_HOME'] ?? join(home, '.cache'), 'chameleon-cv');
}
