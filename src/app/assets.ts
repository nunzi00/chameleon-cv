/**
 * Puentes entre el `AssetStore` del contexto y los módulos que necesitan rutas reales (T-6.2): los temas
 * distribuidos y las fuentes para Typst salen de `assets.directory()`, que en el repositorio es el propio
 * árbol y en el ejecutable la caché materializada con hash comprobado.
 */
import { NodeFileSystem } from '../parsers';
import { builtinThemeRoot, themeRoots, type ThemeRoot } from '../themes';
import type { AppContext } from './context';

export async function builtinThemesRoot(context: Pick<AppContext, 'assets'>): Promise<ThemeRoot> {
  return builtinThemeRoot(new NodeFileSystem(), await context.assets.directory('themes'));
}

/**
 * `themes/` del usuario, `themes/` del espacio de trabajo compartido y después los distribuidos,
 * resueltos por la capa de assets. Con un usuario elegido son tres raíces; sin él, las dos de siempre.
 */
export async function projectThemeRoots(context: Pick<AppContext, 'cwd' | 'workspaceRoot' | 'datasetFileSystem' | 'assets'>): Promise<ThemeRoot[]> {
  return themeRoots(context.cwd, context.datasetFileSystem, await builtinThemesRoot(context), context.workspaceRoot);
}
