/**
 * Barra lateral (T-8.6 S1): tres grupos de pantallas de la aplicación y, aparte, el portal público. El plegado a
 * iconos se recuerda en localStorage (`cv.nav.collapsed`); por debajo de 1024 px la hoja de estilos lo fuerza.
 */
import type { IconName } from './icons';
import type { Page } from './router';
import type { KeyValueStorage } from './storage';

export interface NavItem {
  readonly page: Page;
  readonly label: string;
  readonly icon: IconName;
}

export interface NavGroup {
  readonly label: string;
  readonly items: readonly NavItem[];
}

export interface PortalLink {
  readonly label: string;
  readonly href: string;
  readonly icon: IconName;
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'Perfil',
    items: [
      { page: 'fuentes', label: 'Fuentes', icon: 'folder' },
      { page: 'importar', label: 'Importar CV', icon: 'file-up' },
      { page: 'borradores', label: 'Borradores', icon: 'layers' },
      { page: 'duplicados', label: 'Duplicados', icon: 'copy' },
      { page: 'vida-laboral', label: 'Vida laboral', icon: 'shield' },
      { page: 'estado', label: 'Estado del artefacto', icon: 'check-circle' },
    ],
  },
  {
    label: 'Producir',
    items: [
      { page: 'generar', label: 'Generar', icon: 'play' },
      { page: 'linkedin', label: 'LinkedIn', icon: 'globe' },
      { page: 'salidas', label: 'Salidas', icon: 'file-down' },
    ],
  },
  {
    label: 'Co-piloto',
    items: [
      { page: 'copiloto', label: 'Trabajos', icon: 'robot' },
      { page: 'revisiones', label: 'Revisiones', icon: 'checklist' },
      { page: 'ajustes', label: 'Ajustes', icon: 'sliders' },
    ],
  },
];

export const PORTAL_URL = 'https://nunzi00.github.io/chameleon-cv/';

export const PORTAL_LINKS: readonly PortalLink[] = [
  { label: 'Portada', href: PORTAL_URL, icon: 'globe' },
  { label: 'Guía', href: `${PORTAL_URL}guide/quickstart`, icon: 'book' },
];

export const NAV_KEY = 'cv.nav.collapsed';

export function readCollapsed(storage: KeyValueStorage): boolean {
  try {
    return storage.getItem(NAV_KEY) === '1';
  } catch {
    return false;
  }
}

export function storeCollapsed(storage: KeyValueStorage, collapsed: boolean): void {
  try {
    if (collapsed) {
      storage.setItem(NAV_KEY, '1');
    } else {
      storage.removeItem(NAV_KEY);
    }
  } catch {
    // Sin persistencia: la barra vuelve a su ancho al recargar.
  }
}
