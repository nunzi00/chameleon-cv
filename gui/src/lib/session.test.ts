import { describe, expect, it } from 'vitest';

import { TOKEN_KEY, forgetToken, isPlausibleToken, rememberToken, startSession, tokenFromHash, type TokenStorage } from './session';

function memory(initial: Record<string, string> = {}): TokenStorage & { readonly map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => void map.set(key, value), removeItem: (key) => void map.delete(key) };
}

describe('sesión', () => {
  it('lee el token del fragmento exacto #token=… y lo guarda en la pestaña', () => {
    const storage = memory();
    expect(startSession('#token=abc123DEF-_.~', storage)).toEqual({ token: 'abc123DEF-_.~', fromUrl: true });
    expect(storage.map.get(TOKEN_KEY)).toBe('abc123DEF-_.~');
    expect(tokenFromHash('#/fuentes')).toBeUndefined();
    expect(tokenFromHash('#token=con espacio')).toBeUndefined();
    expect(tokenFromHash('#token=a&otro=b')).toBeUndefined();
  });

  it('sin token en la URL usa el guardado; sin ninguno, no hay sesión', () => {
    expect(startSession('#/estado', memory({ [TOKEN_KEY]: 'guardado' }))).toEqual({ token: 'guardado', fromUrl: false });
    expect(startSession('', memory({ [TOKEN_KEY]: '' }))).toEqual({ token: undefined, fromUrl: false });
    expect(startSession('', memory())).toEqual({ token: undefined, fromUrl: false });
  });

  it('recuerda un token pegado (recortado) y lo olvida; un almacén que falla no rompe la sesión', () => {
    const storage = memory();
    expect(rememberToken(storage, '  pegado-1234567890  ')).toBe('pegado-1234567890');
    expect(storage.map.get(TOKEN_KEY)).toBe('pegado-1234567890');
    forgetToken(storage);
    expect(storage.map.has(TOKEN_KEY)).toBe(false);
    const broken: TokenStorage = {
      getItem: () => {
        throw new Error('privado');
      },
      setItem: () => {
        throw new Error('privado');
      },
      removeItem: () => {
        throw new Error('privado');
      },
    };
    expect(startSession('#token=abcdefghijklmnop', broken)).toEqual({ token: 'abcdefghijklmnop', fromUrl: true });
    expect(startSession('', broken)).toEqual({ token: undefined, fromUrl: false });
    expect(() => forgetToken(broken)).not.toThrow();
    expect(rememberToken(broken, 'x')).toBe('x');
  });

  it('isPlausibleToken exige 16 caracteres seguros como mínimo', () => {
    expect(isPlausibleToken(' 0123456789abcdef ')).toBe(true);
    expect(isPlausibleToken('corto')).toBe(false);
    expect(isPlausibleToken('con espacios dentro 123')).toBe(false);
  });
});
