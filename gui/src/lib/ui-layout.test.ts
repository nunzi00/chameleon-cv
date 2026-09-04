import { describe, expect, it } from 'vitest';

import { DEFAULT_UI_LAYOUT, UI_LAYOUTS, UI_LAYOUT_KEY, applyUiLayout, isUiLayout, navShapeOf, readUiLayout, storeUiLayout } from './ui-layout';

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

/** Un elemento raíz de mentira: solo hace falta poner y quitar un atributo. */
function root(): Element {
  return document.createElement('html');
}

describe('UI_LAYOUTS', () => {
  it('son seis organizaciones distintas, cada una con su forma de navegación y su explicación', () => {
    expect(UI_LAYOUTS.map((option) => option.layout)).toEqual(['barra', 'rail', 'cinta', 'pestanas', 'tablero', 'foco']);
    // Elegir no puede ser adivinar: cada una dice qué cambia.
    expect(UI_LAYOUTS.every((option) => option.description.length > 30)).toBe(true);
    // Tres formas de pintar el mismo modelo de navegación, no cuatro interfaces que mantener.
    expect(new Set(UI_LAYOUTS.map((option) => option.nav))).toEqual(new Set(['sidebar', 'rail', 'ribbon', 'tabs', 'launcher']));
  });

  it('navShapeOf dice cómo se pinta la navegación de cada una', () => {
    expect(navShapeOf('barra')).toBe('sidebar');
    expect(navShapeOf('rail')).toBe('rail');
    expect(navShapeOf('cinta')).toBe('ribbon');
    expect(navShapeOf('pestanas')).toBe('tabs');
    expect(navShapeOf('tablero')).toBe('launcher');
    expect(navShapeOf('foco')).toBe('launcher');
  });

  it('isUiLayout no admite lo que no es una organización', () => {
    expect(isUiLayout('foco')).toBe(true);
    expect(isUiLayout('inventada')).toBe(false);
    expect(isUiLayout(undefined)).toBe(false);
    expect(isUiLayout(3)).toBe(false);
  });
});

describe('readUiLayout', () => {
  it('lee la guardada, y cualquier cosa rara es la de siempre', () => {
    expect(readUiLayout(memory({ [UI_LAYOUT_KEY]: 'tablero' }))).toBe('tablero');
    expect(readUiLayout(memory({ [UI_LAYOUT_KEY]: 'inventada' }))).toBe(DEFAULT_UI_LAYOUT);
    expect(readUiLayout(memory())).toBe(DEFAULT_UI_LAYOUT);
  });

  it('un almacenamiento que falla no rompe la interfaz: se abre con la de siempre', () => {
    expect(readUiLayout(broken)).toBe(DEFAULT_UI_LAYOUT);
  });
});

describe('applyUiLayout', () => {
  it('escribe data-ui, y la organización por defecto NO escribe atributo', () => {
    const element = root();
    applyUiLayout(element, 'cinta');
    expect(element.getAttribute('data-ui')).toBe('cinta');
    applyUiLayout(element, 'barra');
    expect(element.hasAttribute('data-ui')).toBe(false);
  });
});

describe('storeUiLayout', () => {
  it('guarda la elegida y borra la clave al volver a la de siempre', () => {
    const storage = memory();
    storeUiLayout(storage, 'foco');
    expect(storage.data[UI_LAYOUT_KEY]).toBe('foco');
    storeUiLayout(storage, 'barra');
    expect(storage.data[UI_LAYOUT_KEY]).toBeUndefined();
  });

  it('sin persistencia no es un error: la organización solo no sobrevive a la recarga', () => {
    expect(() => storeUiLayout(broken, 'tablero')).not.toThrow();
    expect(() => storeUiLayout(broken, 'barra')).not.toThrow();
  });
});
