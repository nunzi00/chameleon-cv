/** Ruta relativa y contenida: ni absoluta, ni con `..`, ni con barras invertidas; un identificador manipulado no puede salir del directorio. */
export function isSafeSourcePath(file: string): boolean {
  return !file.startsWith('/') && !file.includes('\\') && file.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}
