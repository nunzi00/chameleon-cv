import { describe, expect, it } from 'vitest';

import { DEFAULT_PALETTE, PALETTES, PALETTE_KEY, applyPalette, isPalette, readPalette, storePalette } from './palette';

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

describe('PALETTES', () => {
  it('son cinco combinaciones con nombre y explicación, y la primera es la de siempre', () => {
    expect(PALETTES.map((option) => option.palette)).toEqual(['pizarra', 'bosque', 'ambar', 'indigo', 'carbon']);
    expect(PALETTES[0]?.palette).toBe(DEFAULT_PALETTE);
    expect(PALETTES.every((option) => option.description.length > 20)).toBe(true);
  });

  it('isPalette no admite lo que no es una paleta', () => {
    expect(isPalette('carbon')).toBe(true);
    expect(isPalette('fucsia')).toBe(false);
    expect(isPalette(undefined)).toBe(false);
    expect(isPalette(7)).toBe(false);
  });
});

describe('readPalette', () => {
  it('lee la guardada, y cualquier cosa rara es la de siempre', () => {
    expect(readPalette(memory({ [PALETTE_KEY]: 'indigo' }))).toBe('indigo');
    expect(readPalette(memory({ [PALETTE_KEY]: 'fucsia' }))).toBe(DEFAULT_PALETTE);
    expect(readPalette(memory())).toBe(DEFAULT_PALETTE);
  });

  it('un almacenamiento que falla no rompe la interfaz', () => {
    expect(readPalette(broken)).toBe(DEFAULT_PALETTE);
  });
});

describe('applyPalette', () => {
  it('escribe data-palette, y la de siempre NO escribe atributo: sus valores son los tokens base', () => {
    const element = document.createElement('html');
    applyPalette(element, 'ambar');
    expect(element.getAttribute('data-palette')).toBe('ambar');
    applyPalette(element, 'pizarra');
    expect(element.hasAttribute('data-palette')).toBe(false);
  });
});

describe('storePalette', () => {
  it('guarda la elegida y borra la clave al volver a la de siempre', () => {
    const storage = memory();
    storePalette(storage, 'bosque');
    expect(storage.data[PALETTE_KEY]).toBe('bosque');
    storePalette(storage, 'pizarra');
    expect(storage.data[PALETTE_KEY]).toBeUndefined();
  });

  it('sin persistencia no es un error: la paleta solo no sobrevive a la recarga', () => {
    expect(() => storePalette(broken, 'carbon')).not.toThrow();
    expect(() => storePalette(broken, 'pizarra')).not.toThrow();
  });
});
