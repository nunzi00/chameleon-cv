/**
 * Almacenamiento clave-valor para preferencias de la interfaz (tema, barra plegada). En el navegador es
 * localStorage; si no existe o acceder a él lanza (contextos restringidos), una memoria efímera que no persiste.
 */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

export function browserStorage(): KeyValueStorage {
  try {
    const storage = window.localStorage as KeyValueStorage | undefined;
    if (storage) {
      return storage;
    }
  } catch {
    // Acceso prohibido (por ejemplo, un marco sin origen): sin persistencia.
  }
  return memoryStorage();
}
