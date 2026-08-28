/**
 * Renderers (T-1.7, T-2.6): salidas del CV. Un renderer convierte un `MasterProfile` (normalmente ya
 * seleccionado) en un documento a partir del mismo modelo de vista; nunca parsea ni selecciona.
 */
export * from './markdown';
export * from './pdf';
