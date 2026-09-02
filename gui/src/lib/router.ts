/** Rutas por fragmento (`#/fuentes/experience%2Facme.md`): una pantalla por tarea y, opcionalmente, un elemento. */
export type Page = 'estado' | 'fuentes' | 'importar' | 'borradores' | 'duplicados' | 'generar' | 'copiloto' | 'revisiones' | 'salidas' | 'ajustes';

export interface Route {
  readonly page: Page;
  readonly item?: string | undefined;
}

export const PAGES: readonly { readonly page: Page; readonly label: string }[] = [
  { page: 'estado', label: 'Estado' },
  { page: 'fuentes', label: 'Fuentes' },
  { page: 'importar', label: 'Importar' },
  { page: 'borradores', label: 'Borradores' },
  { page: 'duplicados', label: 'Duplicados' },
  { page: 'generar', label: 'Generar' },
  { page: 'copiloto', label: 'Co-piloto' },
  { page: 'revisiones', label: 'Revisiones' },
  { page: 'salidas', label: 'Salidas' },
  { page: 'ajustes', label: 'Ajustes' },
];

export function parseRoute(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '');
  const slash = clean.indexOf('/');
  const head = slash === -1 ? clean : clean.slice(0, slash);
  const page = PAGES.find((entry) => entry.page === head)?.page ?? 'estado';
  if (slash === -1) {
    return { page };
  }
  let item = clean.slice(slash + 1);
  try {
    item = decodeURIComponent(item);
  } catch {
    // un fragmento mal codificado se usa tal cual
  }
  return item === '' ? { page } : { page, item };
}

export function formatRoute(route: Route): string {
  return route.item === undefined ? `#/${route.page}` : `#/${route.page}/${encodeURIComponent(route.item)}`;
}
