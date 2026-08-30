import { describe, expect, it } from 'vitest';

import { THEME_KEY, THEME_OPTIONS, applyTheme, readTheme, storeTheme } from './theme';

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

describe('readTheme', () => {
  it('devuelve el tema guardado y «sistema» para valores desconocidos o ausentes', () => {
    expect(readTheme(memory({ [THEME_KEY]: 'dark' }))).toBe('dark');
    expect(readTheme(memory({ [THEME_KEY]: 'light' }))).toBe('light');
    expect(readTheme(memory({ [THEME_KEY]: 'sepia' }))).toBe('system');
    expect(readTheme(memory())).toBe('system');
  });

  it('con un almacenamiento que falla, «sistema»', () => {
    expect(readTheme(broken)).toBe('system');
  });
});

describe('applyTheme', () => {
  it('escribe data-theme para claro y oscuro y lo retira para sistema', () => {
    const root = document.createElement('html');
    applyTheme(root, 'dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
    applyTheme(root, 'light');
    expect(root.getAttribute('data-theme')).toBe('light');
    applyTheme(root, 'system');
    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});

describe('storeTheme', () => {
  it('guarda claro y oscuro y borra la clave para sistema', () => {
    const storage = memory();
    storeTheme(storage, 'dark');
    expect(storage.data[THEME_KEY]).toBe('dark');
    storeTheme(storage, 'system');
    expect(storage.data[THEME_KEY]).toBeUndefined();
  });

  it('no propaga los fallos del almacenamiento', () => {
    expect(() => storeTheme(broken, 'dark')).not.toThrow();
    expect(() => storeTheme(broken, 'system')).not.toThrow();
  });
});

describe('THEME_OPTIONS', () => {
  it('ofrece los tres modos en el orden del diseño', () => {
    expect(THEME_OPTIONS.map((option) => option.mode)).toEqual(['light', 'dark', 'system']);
  });
});
