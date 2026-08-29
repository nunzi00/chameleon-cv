/**
 * Modelo de amenazas de un servidor local (docs/api-headless.md §6): token de sesión de 256 bits comparado
 * en tiempo constante, `Host` solo entre los permitidos (anti *DNS rebinding*) y `Origin`, cuando llega,
 * igual al propio origen (anti CSRF). Sin CORS: ninguna cabecera `Access-Control-Allow-*`.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** `Authorization: Bearer <token>`, comparado en tiempo constante. */
export function isAuthorized(authorization: string | undefined, token: string): boolean {
  if (authorization === undefined || !authorization.startsWith('Bearer ')) {
    return false;
  }
  const presented = Buffer.from(authorization.slice('Bearer '.length).trim(), 'utf8');
  const expected = Buffer.from(token, 'utf8');
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

/** Los `Host` aceptados para un puerto: loopback en sus tres grafías y los añadidos por el usuario. */
export function allowedHosts(port: number, extra: readonly string[]): ReadonlySet<string> {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, ...extra.map((host) => host.trim().toLowerCase()).filter((host) => host !== '')]);
}

export function isAllowedHost(host: string | undefined, allowed: ReadonlySet<string>): boolean {
  return host !== undefined && allowed.has(host.trim().toLowerCase());
}

/** `Origin` ausente (curl, misma página) o igual a un origen permitido; cualquier otro, rechazado. */
export function isAllowedOrigin(origin: string | undefined, allowed: ReadonlySet<string>): boolean {
  if (origin === undefined) {
    return true;
  }
  const match = /^https?:\/\/(.+)$/i.exec(origin.trim());
  return match !== null && allowed.has(String(match[1]).toLowerCase());
}
