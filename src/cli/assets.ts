/**
 * Puentes entre el `AssetStore` del contexto y los módulos que necesitan rutas reales (T-6.2):
 * los temas distribuidos y las fuentes para Typst salen de `assets.directory()`, que en el
 * repositorio es el propio árbol y en el ejecutable la caché materializada con hash comprobado.
 */
import { NodeFileSystem } from '../parsers';
import { builtinThemeRoot, themeRoots, type ThemeRoot } from '../themes';
import type { CliContext } from './context';

export async function builtinThemesRoot(context: Pick<CliContext, 'assets'>): Promise<ThemeRoot> {
  return builtinThemeRoot(new NodeFileSystem(), await context.assets.directory('themes'));
}

/** `themes/` del proyecto y después los distribuidos, resueltos por la capa de assets. */
export async function projectThemeRoots(context: Pick<CliContext, 'cwd' | 'datasetFileSystem' | 'assets'>): Promise<ThemeRoot[]> {
  return themeRoots(context.cwd, context.datasetFileSystem, await builtinThemesRoot(context));
}
