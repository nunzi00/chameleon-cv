import { afterEach, describe, expect, it, vi } from 'vitest';

import { browserStorage, memoryStorage } from './storage';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('memoryStorage', () => {
  it('guarda, devuelve null para lo que no está y borra', () => {
    const storage = memoryStorage();
    expect(storage.getItem('a')).toBeNull();
    storage.setItem('a', '1');
    expect(storage.getItem('a')).toBe('1');
    storage.removeItem('a');
    expect(storage.getItem('a')).toBeNull();
  });
});

describe('browserStorage', () => {
  it('devuelve localStorage cuando el navegador lo expone', () => {
    const stub = memoryStorage();
    vi.stubGlobal('localStorage', stub);
    expect(browserStorage()).toBe(stub);
  });

  it('sin localStorage, o si acceder a él lanza, devuelve una memoria efímera', () => {
    vi.stubGlobal('localStorage', undefined);
    const fallback = browserStorage();
    fallback.setItem('k', 'v');
    expect(fallback.getItem('k')).toBe('v');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    expect(browserStorage().getItem('k')).toBeNull();
  });
});
