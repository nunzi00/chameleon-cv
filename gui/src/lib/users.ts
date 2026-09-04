/**
 * El usuario con el que trabaja ESTA pestaña (T-9.32). Varias personas —tú, un invitado— comparten el
 * mismo espacio de trabajo y el mismo `cv serve`, cada una con sus fuentes en `usuarios/<id>/`.
 *
 * No es una sesión ni una identidad: es una elección de la interfaz, como la paleta. Se guarda en el
 * navegador porque quien vuelve a abrir la web espera seguir donde estaba, y viaja en la cabecera
 * `x-cv-user` de cada petición. Quien tiene el token puede pedir cualquiera de ellos: los usuarios
 * separan el trabajo, no protegen nada.
 */
import type { KeyValueStorage } from './storage';
import { isUserId } from './user-id';

export const USER_KEY = 'cv.user';

/** Lee el usuario guardado; un valor imposible —o un almacenamiento que falla— es «la raíz». */
export function readUser(storage: KeyValueStorage): string | undefined {
  try {
    const value = storage.getItem(USER_KEY);
    return value !== null && isUserId(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Guarda la elección; `undefined` la borra (se vuelve a trabajar sobre la raíz del espacio de trabajo). */
export function storeUser(storage: KeyValueStorage, id: string | undefined): void {
  try {
    if (id === undefined) {
      storage.removeItem(USER_KEY);
    } else {
      storage.setItem(USER_KEY, id);
    }
  } catch {
    // Sin almacenamiento la elección dura lo que la pestaña; no es motivo para romper nada.
  }
}

/**
 * El usuario que se debe usar de verdad, ya conocidos los que hay. Tres reglas, en este orden:
 * el servidor fijado manda sobre todo (`cv serve --user`), un usuario guardado que ya no existe no
 * se hereda, y si la raíz no sirve para trabajar se entra por el primer usuario en vez de por una
 * pantalla vacía.
 */
export function resolveUser(options: { readonly stored: string | undefined; readonly known: readonly string[]; readonly pinned: string | undefined; readonly rootUsable: boolean }): string | undefined {
  if (options.pinned !== undefined) {
    return options.pinned;
  }
  if (options.stored !== undefined && options.known.includes(options.stored)) {
    return options.stored;
  }
  return options.rootUsable ? undefined : options.known[0];
}
