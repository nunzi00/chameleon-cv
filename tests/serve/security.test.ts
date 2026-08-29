import { describe, expect, it } from 'vitest';

import { allowedHosts, generateToken, isAllowedHost, isAllowedOrigin, isAuthorized } from '../../src/serve';

describe('seguridad del servidor local', () => {
  it('genera tokens de 256 bits distintos y los compara en tiempo constante solo como Bearer', () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(token);
    expect(isAuthorized(`Bearer ${token}`, token)).toBe(true);
    expect(isAuthorized(`Bearer  ${token} `, token)).toBe(true);
    expect(isAuthorized(undefined, token)).toBe(false);
    expect(isAuthorized(`Basic ${token}`, token)).toBe(false);
    expect(isAuthorized('Bearer corto', token)).toBe(false);
    expect(isAuthorized(`Bearer ${token.slice(0, -1)}x`, token)).toBe(false);
  });

  it('acepta Host solo en loopback (tres grafías) o en la lista del usuario, sin distinguir mayúsculas', () => {
    const allowed = allowedHosts(4310, [' MiHost:4310 ', '']);
    expect([...allowed]).toEqual(['127.0.0.1:4310', 'localhost:4310', '[::1]:4310', 'mihost:4310']);
    expect(isAllowedHost('LOCALHOST:4310', allowed)).toBe(true);
    expect(isAllowedHost('127.0.0.1:4311', allowed)).toBe(false);
    expect(isAllowedHost(undefined, allowed)).toBe(false);
  });

  it('acepta Origin ausente o igual al propio origen; rechaza cualquier otro o uno malformado', () => {
    const allowed = allowedHosts(4310, []);
    expect(isAllowedOrigin(undefined, allowed)).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:4310', allowed)).toBe(true);
    expect(isAllowedOrigin('HTTPS://localhost:4310', allowed)).toBe(true);
    expect(isAllowedOrigin('http://evil.example', allowed)).toBe(false);
    expect(isAllowedOrigin('null', allowed)).toBe(false);
  });
});
