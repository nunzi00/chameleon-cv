/**
 * La sesión (docs/gui-mvp.md §4.3): el token llega en el fragmento (`#token=…`) de la URL que imprime cv serve,
 * pasa al almacén de la pestaña y se retira de la URL. Puro: el almacén y el fragmento se inyectan.
 */
export const TOKEN_KEY = 'chameleon-cv.token';

export interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SessionStart {
  readonly token: string | undefined;
  /** Venía en la URL: hay que retirarlo del fragmento. */
  readonly fromUrl: boolean;
}

/** `#token=<token>` exacto; cualquier otro fragmento no lleva token. */
export function tokenFromHash(hash: string): string | undefined {
  const match = /^#token=([A-Za-z0-9_.~-]+)$/.exec(hash);
  return match === null ? undefined : match[1];
}

/** Un token pegado a mano: sin espacios, de longitud razonable. */
export function isPlausibleToken(value: string): boolean {
  return /^[A-Za-z0-9_.~-]{16,}$/.test(value.trim());
}

function safely<T>(action: () => T, fallback: T): T {
  try {
    return action();
  } catch {
    return fallback;
  }
}

export function startSession(hash: string, storage: TokenStorage): SessionStart {
  const fromUrl = tokenFromHash(hash);
  if (fromUrl !== undefined) {
    safely(() => storage.setItem(TOKEN_KEY, fromUrl), undefined);
    return { token: fromUrl, fromUrl: true };
  }
  const stored = safely(() => storage.getItem(TOKEN_KEY), null);
  return { token: stored === null || stored === '' ? undefined : stored, fromUrl: false };
}

export function rememberToken(storage: TokenStorage, token: string): string {
  const clean = token.trim();
  safely(() => storage.setItem(TOKEN_KEY, clean), undefined);
  return clean;
}

export function forgetToken(storage: TokenStorage): void {
  safely(() => storage.removeItem(TOKEN_KEY), undefined);
}
