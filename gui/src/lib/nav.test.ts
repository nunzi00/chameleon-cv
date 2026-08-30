import { describe, expect, it } from 'vitest';

import { NAV_GROUPS, NAV_KEY, PORTAL_LINKS, PORTAL_URL, readCollapsed, storeCollapsed } from './nav';
import { PAGES } from './router';

function memory(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

const broken: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
  getItem: () => {
    throw new Error('sin almacenamiento');
  },
  setItem: () => {
    throw new Error('sin almacenamiento');
  },
  removeItem: () => {
    throw new Error('sin almacenamiento');
  },
};

describe('NAV_GROUPS', () => {
  it('cubre cada pantalla del enrutador exactamente una vez, en tres grupos', () => {
    const pages = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.page));
    expect(NAV_GROUPS.map((group) => group.label)).toEqual(['Perfil', 'Producir', 'Co-piloto']);
    expect([...pages].sort()).toEqual(PAGES.map((entry) => entry.page).sort());
    expect(new Set(pages).size).toBe(pages.length);
  });

  it('el portal enlaza fuera de la aplicación', () => {
    expect(PORTAL_LINKS.every((link) => link.href.startsWith(PORTAL_URL))).toBe(true);
  });
});

describe('plegado persistente', () => {
  it('lee «1» como plegada y cualquier otra cosa como desplegada', () => {
    expect(readCollapsed(memory({ [NAV_KEY]: '1' }))).toBe(true);
    expect(readCollapsed(memory({ [NAV_KEY]: 'sí' }))).toBe(false);
    expect(readCollapsed(memory())).toBe(false);
    expect(readCollapsed(broken)).toBe(false);
  });

  it('guarda la clave al plegar y la borra al desplegar, sin propagar fallos', () => {
    const storage = memory();
    storeCollapsed(storage, true);
    expect(storage.data[NAV_KEY]).toBe('1');
    storeCollapsed(storage, false);
    expect(storage.data[NAV_KEY]).toBeUndefined();
    expect(() => storeCollapsed(broken, true)).not.toThrow();
    expect(() => storeCollapsed(broken, false)).not.toThrow();
  });
});
