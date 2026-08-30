/**
 * Cuota viva (T-8.2, `docs/copilot-settings.md` §4.4): lo que el proveedor devuelve en las cabeceras
 * de las respuestas que el usuario ya pidió, guardado solo en memoria del proceso. Ninguna llamada
 * nace de aquí: cero telemetría. Entiende las familias `x-ratelimit-*` (OpenAI, Groq),
 * `anthropic-ratelimit-*` y `retry-after`.
 */
import type { RemoteProviderId } from './registry';

export interface QuotaSnapshot {
  readonly provider: RemoteProviderId;
  /** ISO 8601 del momento de la lectura. */
  readonly observedAt: string;
  readonly limitRequests?: number | undefined;
  readonly remainingRequests?: number | undefined;
  /** Segundos hasta que se renueva el cupo de peticiones. */
  readonly resetRequestsSeconds?: number | undefined;
  readonly limitTokens?: number | undefined;
  readonly remainingTokens?: number | undefined;
  readonly resetTokensSeconds?: number | undefined;
  /** `retry-after` de un 429, en segundos. */
  readonly retryAfterSeconds?: number | undefined;
}

export type QuotaReading = Omit<QuotaSnapshot, 'provider' | 'observedAt'>;

const HEADER = /^(?:x-ratelimit-(limit|remaining|reset)-(requests|tokens)|anthropic-ratelimit-(requests|tokens)-(limit|remaining|reset))$/;

/** `7.66s`, `2m59.56s`, `1h2m`, `45` (segundos), `Wed, 21 Oct 2026 07:28:00 GMT` o una fecha ISO → segundos (entero, ≥ 0). */
export function parseDuration(value: string, now: Date = new Date()): number | undefined {
  const text = value.trim();
  if (text === '') {
    return undefined;
  }
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    return Math.max(0, Math.round(Number(text)));
  }
  const units = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$/.exec(text);
  if (units !== null) {
    const [, hours, minutes, seconds, millis] = units;
    const total = Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0) + Number(millis ?? 0) / 1000;
    return Math.max(0, Math.round(total));
  }
  const date = Date.parse(text);
  if (Number.isNaN(date)) {
    return undefined;
  }
  return Math.max(0, Math.round((date - now.getTime()) / 1000));
}

function integer(value: string): number | undefined {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : undefined;
}

/** Las cabeceras de cuota de una respuesta (nombres en minúsculas) como lectura normalizada; vacía si no hay ninguna. */
export function parseQuotaHeaders(headers: Readonly<Record<string, string>>, now: Date = new Date()): QuotaReading {
  const reading: { -readonly [K in keyof QuotaReading]: QuotaReading[K] } = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (key === 'retry-after') {
      reading.retryAfterSeconds = parseDuration(value, now);
      continue;
    }
    const match = HEADER.exec(key);
    if (match === null) {
      continue;
    }
    // La familia x-ratelimit-* captura (campo, sujeto) en [1],[2]; la de Anthropic, (sujeto, campo) en [3],[4].
    const field = String(match[1] ?? match[4]);
    const subject = String(match[2] ?? match[3]);
    if (field === 'reset') {
      const seconds = parseDuration(value, now);
      if (subject === 'requests') {
        reading.resetRequestsSeconds = seconds;
      } else {
        reading.resetTokensSeconds = seconds;
      }
      continue;
    }
    const amount = integer(value);
    if (subject === 'requests') {
      if (field === 'limit') {
        reading.limitRequests = amount;
      } else {
        reading.remainingRequests = amount;
      }
    } else if (field === 'limit') {
      reading.limitTokens = amount;
    } else {
      reading.remainingTokens = amount;
    }
  }
  return reading;
}

export function hasQuotaData(reading: QuotaReading): boolean {
  return Object.values(reading).some((value) => value !== undefined);
}

/** Última lectura por proveedor; vive lo que el proceso. */
export class QuotaLedger {
  private readonly snapshots = new Map<RemoteProviderId, QuotaSnapshot>();

  /** Registra las cabeceras de una respuesta; devuelve la instantánea o `undefined` si no traían cuota. */
  record(provider: RemoteProviderId, headers: Readonly<Record<string, string>>, now: Date = new Date()): QuotaSnapshot | undefined {
    const reading = parseQuotaHeaders(headers, now);
    if (!hasQuotaData(reading)) {
      return undefined;
    }
    const snapshot: QuotaSnapshot = { provider, observedAt: now.toISOString(), ...reading };
    this.snapshots.set(provider, snapshot);
    return snapshot;
  }

  get(provider: RemoteProviderId): QuotaSnapshot | undefined {
    return this.snapshots.get(provider);
  }

  all(): readonly QuotaSnapshot[] {
    return [...this.snapshots.values()];
  }

  clear(): void {
    this.snapshots.clear();
  }
}

/** El libro del proceso (la CLI y `cv serve` comparten uno por ejecución). */
export const defaultQuotaLedger = new QuotaLedger();

function ratio(remaining: number | undefined, limit: number | undefined, unit: string): string | undefined {
  if (remaining === undefined && limit === undefined) {
    return undefined;
  }
  const left = remaining === undefined ? '?' : String(remaining);
  return limit === undefined ? `${left} ${unit} restantes` : `${left}/${limit} ${unit}`;
}

function renewal(seconds: number | undefined): string {
  return seconds === undefined ? '' : ` (se renueva en ${seconds} s)`;
}

/** «quedan 28/30 peticiones (se renueva en 12 s) · 7000/8000 tokens (se renueva en 8 s)»; `undefined` sin datos. */
export function describeQuotaSnapshot(snapshot: QuotaSnapshot): string {
  const parts: string[] = [];
  const requests = ratio(snapshot.remainingRequests, snapshot.limitRequests, 'peticiones');
  if (requests !== undefined) {
    parts.push(`${requests}${renewal(snapshot.resetRequestsSeconds)}`);
  }
  const tokens = ratio(snapshot.remainingTokens, snapshot.limitTokens, 'tokens');
  if (tokens !== undefined) {
    parts.push(`${tokens}${renewal(snapshot.resetTokensSeconds)}`);
  }
  if (snapshot.retryAfterSeconds !== undefined) {
    parts.push(`reintentar en ${snapshot.retryAfterSeconds} s`);
  }
  return parts.length === 0 ? 'sin datos de cuota' : `quedan ${parts.join(' · ')}`;
}
