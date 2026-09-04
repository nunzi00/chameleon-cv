/**
 * La **organización** de la interfaz (T-9.29): dónde vive la navegación, cuánta cabecera hay y cuánto aire
 * respira el contenido. Es otra cosa que el tema claro/oscuro (`theme.ts`), y por eso son **dos conmutadores**:
 * claro/oscuro es una preferencia de ambiente —la luz de la habitación, no cómo trabajas— y combinarlos daría
 * doce opciones para dos decisiones que nadie toma a la vez.
 *
 * Regla de arquitectura (consulta al Director, 4-sep): **una sola carcasa dirigida por datos**, no cuatro
 * interfaces que mantener por separado. Las pantallas no saben en qué organización viven; `Nav.svelte` pinta el
 * MISMO modelo de navegación de tres formas y el resto lo hace la hoja de estilos con `data-ui`.
 */
import type { KeyValueStorage } from './storage';

export type UiLayout = 'barra' | 'cinta' | 'tablero' | 'foco';

export const UI_LAYOUT_KEY = 'cv.ui';
export const DEFAULT_UI_LAYOUT: UiLayout = 'barra';

/** Cómo pinta la navegación cada organización; tres formas para cuatro temas, y un solo modelo detrás. */
export type NavShape = 'sidebar' | 'ribbon' | 'launcher';

export interface UiLayoutOption {
  readonly layout: UiLayout;
  readonly label: string;
  /** Qué cambia de verdad, para que elegir no sea adivinar. */
  readonly description: string;
  readonly nav: NavShape;
}

/** Tres formas de pintar la navegación para cuatro organizaciones: «tablero» y «foco» comparten lanzador. */
const NAV_SHAPES: Readonly<Record<UiLayout, NavShape>> = { barra: 'sidebar', cinta: 'ribbon', tablero: 'launcher', foco: 'launcher' };

/** La forma de la navegación de una organización. */
export function navShapeOf(layout: UiLayout): NavShape {
  return NAV_SHAPES[layout];
}

export const UI_LAYOUTS: readonly UiLayoutOption[] = [
  { layout: 'barra', label: 'Barra', description: 'Navegación lateral siempre a la vista y cabecera con el estado. La de trabajar muchas horas seguidas.', nav: NAV_SHAPES.barra },
  { layout: 'cinta', label: 'Cinta', description: 'Navegación en una cinta superior y nada a los lados: todo el ancho para el contenido, con más densidad.', nav: NAV_SHAPES.cinta },
  { layout: 'tablero', label: 'Tablero', description: 'Sin navegación permanente: se abre en mosaico cuando la pides. Contenido en tarjetas y más aire.', nav: NAV_SHAPES.tablero },
  { layout: 'foco', label: 'Foco', description: 'Ni barra ni chips: una columna estrecha, tipografía mayor y la navegación solo cuando la llamas.', nav: NAV_SHAPES.foco },
];

const LAYOUTS: ReadonlySet<string> = new Set(UI_LAYOUTS.map((option) => option.layout));

export function isUiLayout(value: unknown): value is UiLayout {
  return typeof value === 'string' && LAYOUTS.has(value);
}

/** Lee la organización guardada; cualquier valor desconocido —o un almacenamiento que falla— es la de siempre. */
export function readUiLayout(storage: KeyValueStorage): UiLayout {
  try {
    const value = storage.getItem(UI_LAYOUT_KEY);
    return isUiLayout(value) ? value : DEFAULT_UI_LAYOUT;
  } catch {
    return DEFAULT_UI_LAYOUT;
  }
}

/**
 * Escribe `data-ui` en el elemento raíz. La organización por defecto **no** escribe atributo: así la hoja de
 * estilos base es la de siempre y no hay que repetirla dentro de un selector.
 */
export function applyUiLayout(root: Element, layout: UiLayout): void {
  if (layout === DEFAULT_UI_LAYOUT) {
    root.removeAttribute('data-ui');
  } else {
    root.setAttribute('data-ui', layout);
  }
}

export function storeUiLayout(storage: KeyValueStorage, layout: UiLayout): void {
  try {
    if (layout === DEFAULT_UI_LAYOUT) {
      storage.removeItem(UI_LAYOUT_KEY);
    } else {
      storage.setItem(UI_LAYOUT_KEY, layout);
    }
  } catch {
    // Sin persistencia: la organización simplemente no sobrevive a la recarga.
  }
}
