/** Ruta a un valor dentro de un MasterProfile, tal y como la emite la validación. */
export type SchemaPath = ReadonlyArray<PropertyKey>;

/**
 * Formatea una ruta como expresión de acceso legible: `experience[0].dates.end`.
 * La ruta vacía (la raíz del documento) se formatea como cadena vacía.
 */
export function formatPath(path: SchemaPath): string {
  return path.reduce<string>((formatted, key) => {
    if (typeof key === 'number') {
      return `${formatted}[${key}]`;
    }
    return formatted === '' ? String(key) : `${formatted}.${String(key)}`;
  }, '');
}
