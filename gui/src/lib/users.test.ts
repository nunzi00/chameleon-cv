import { describe, expect, it } from 'vitest';

import { isUserId } from './user-id';
import { USER_KEY, readUser, resolveUser, storeUser } from './users';
import { memoryStorage } from './storage';

describe('isUserId', () => {
  it('la misma regla que el servidor: minúsculas, dígitos y guiones interiores', () => {
    expect(['lucas', 'invitado1', 'a', 'a-b', '0'].every(isUserId)).toBe(true);
    expect(['', '..', 'a/b', 'Lucas', '-a', 'a-', 'ñ', 'x'.repeat(41)].some(isUserId)).toBe(false);
  });
});

describe('readUser y storeUser', () => {
  it('guarda, lee y olvida; un valor imposible en el almacenamiento se ignora', () => {
    const storage = memoryStorage();
    expect(readUser(storage)).toBeUndefined();
    storeUser(storage, 'invitado1');
    expect(storage.getItem(USER_KEY)).toBe('invitado1');
    expect(readUser(storage)).toBe('invitado1');
    storeUser(storage, undefined);
    expect(readUser(storage)).toBeUndefined();
    storage.setItem(USER_KEY, '../fuera');
    expect(readUser(storage)).toBeUndefined();
  });

  it('un almacenamiento que falla no rompe nada: la elección dura lo que la pestaña', () => {
    const broken = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
      removeItem: () => {
        throw new Error('bloqueado');
      },
    };
    expect(readUser(broken)).toBeUndefined();
    expect(() => storeUser(broken, 'lucas')).not.toThrow();
    expect(() => storeUser(broken, undefined)).not.toThrow();
  });
});

describe('resolveUser', () => {
  it('el servidor fijado manda sobre lo guardado', () => {
    expect(resolveUser({ stored: 'lucas', known: ['lucas'], pinned: 'invitado1', rootUsable: true })).toBe('invitado1');
  });

  it('se respeta lo guardado solo si ese usuario sigue existiendo', () => {
    expect(resolveUser({ stored: 'lucas', known: ['lucas', 'invitado1'], pinned: undefined, rootUsable: true })).toBe('lucas');
    expect(resolveUser({ stored: 'borrado', known: ['lucas'], pinned: undefined, rootUsable: true })).toBeUndefined();
  });

  it('sin elección y con la raíz inservible se entra por el primer usuario, no por una pantalla vacía', () => {
    expect(resolveUser({ stored: undefined, known: ['invitado1', 'lucas'], pinned: undefined, rootUsable: false })).toBe('invitado1');
    expect(resolveUser({ stored: undefined, known: [], pinned: undefined, rootUsable: false })).toBeUndefined();
  });
});
