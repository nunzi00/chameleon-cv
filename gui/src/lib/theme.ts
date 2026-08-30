/**
 * Tema de la interfaz (T-8.6 S1): claro, oscuro o el del sistema. Se guarda en localStorage con la clave `cv.theme`
 * y se aplica como `data-theme` en <html> antes del primer render (main.ts), para no destellar. «Sistema» no escribe
 * atributo: manda `prefers-color-scheme` (tokens en app.css).
 */
export type ThemeMode = 'light' | 'dark' | 'system';

export const THEME_KEY = 'cv.theme';

export const THEME_OPTIONS: readonly { readonly mode: ThemeMode; readonly label: string }[] = [
  { mode: 'light', label: 'Claro' },
  { mode: 'dark', label: 'Oscuro' },
  { mode: 'system', label: 'Sistema' },
];

import type { KeyValueStorage } from './storage';

/** Lee el tema guardado; cualquier valor desconocido (o un almacenamiento que falla) equivale a «sistema». */
export function readTheme(storage: KeyValueStorage): ThemeMode {
  try {
    const value = storage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

/** Escribe (o retira) `data-theme` en el elemento raíz. */
export function applyTheme(root: Element, mode: ThemeMode): void {
  if (mode === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', mode);
  }
}

/** Persiste la elección; si el almacenamiento falla, el tema simplemente no sobrevive a la recarga. */
export function storeTheme(storage: KeyValueStorage, mode: ThemeMode): void {
  try {
    if (mode === 'system') {
      storage.removeItem(THEME_KEY);
    } else {
      storage.setItem(THEME_KEY, mode);
    }
  } catch {
    // Sin persistencia: no es un error para el usuario.
  }
}
