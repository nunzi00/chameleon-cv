/**
 * La **paleta** de la interfaz (T-9.30): la combinación de colores con la que se pinta todo lo que tiene
 * carácter —el acento de los enlaces, del ítem activo y de los botones, el anillo de foco, el fondo de la
 * aplicación—. Es el tercer eje, y los tres son ortogonales a propósito:
 *
 * - `data-theme` (claro/oscuro): la luz que hay en la habitación.
 * - `data-ui` (organización): cómo trabajas.
 * - `data-palette` (esta): qué color quieres mirar.
 *
 * Cada paleta trae sus valores para claro **y** para oscuro, porque un acento que funciona sobre blanco casi
 * nunca funciona sobre casi-negro. Lo que **no** toca ninguna es `--cv-surface` ni `--cv-text`: ahí vive el
 * contraste verificado del texto, y teñirlo sería cambiar un color a costa de poder leer.
 */
import type { KeyValueStorage } from './storage';

export type Palette = 'pizarra' | 'bosque' | 'ambar' | 'indigo' | 'carbon';

export const PALETTE_KEY = 'cv.palette';
export const DEFAULT_PALETTE: Palette = 'pizarra';

export interface PaletteOption {
  readonly palette: Palette;
  readonly label: string;
  readonly description: string;
}

export const PALETTES: readonly PaletteOption[] = [
  { palette: 'pizarra', label: 'Pizarra', description: 'Azul frío sobre neutros grises. La de siempre.' },
  { palette: 'bosque', label: 'Bosque', description: 'Verde profundo y fondo de tinte cálido tirando a verde.' },
  { palette: 'ambar', label: 'Ámbar', description: 'Acento tostado y fondo cálido: la más suave con luz baja.' },
  { palette: 'indigo', label: 'Índigo', description: 'Violeta azulado y fondo frío: la de más contraste de color.' },
  { palette: 'carbon', label: 'Carbón', description: 'Monocroma: sin color de acento, solo densidad de gris.' },
];

const NAMES: ReadonlySet<string> = new Set(PALETTES.map((option) => option.palette));

export function isPalette(value: unknown): value is Palette {
  return typeof value === 'string' && NAMES.has(value);
}

/** Lee la paleta guardada; cualquier valor desconocido —o un almacenamiento que falla— es la de siempre. */
export function readPalette(storage: KeyValueStorage): Palette {
  try {
    const value = storage.getItem(PALETTE_KEY);
    return isPalette(value) ? value : DEFAULT_PALETTE;
  } catch {
    return DEFAULT_PALETTE;
  }
}

/** La paleta por defecto no escribe atributo: sus valores son los tokens base de la hoja. */
export function applyPalette(root: Element, palette: Palette): void {
  if (palette === DEFAULT_PALETTE) {
    root.removeAttribute('data-palette');
  } else {
    root.setAttribute('data-palette', palette);
  }
}

export function storePalette(storage: KeyValueStorage, palette: Palette): void {
  try {
    if (palette === DEFAULT_PALETTE) {
      storage.removeItem(PALETTE_KEY);
    } else {
      storage.setItem(PALETTE_KEY, palette);
    }
  } catch {
    // Sin persistencia: la paleta simplemente no sobrevive a la recarga.
  }
}
