/**
 * Consentimiento de coste en dos pasos para proveedores remotos (T-7.4b, canon C11): la primera petición
 * recibe un 409 con la estimación y un `estimateId`; repetirla con ese id dentro del plazo es la
 * confirmación explícita. Cada id vale una sola vez y para la tarea que lo emitió.
 */
import { randomUUID } from 'node:crypto';

import type { JobKind } from './jobs';

export const CONSENT_TTL_MS = 10 * 60 * 1000;

/** Qué se confirma: un trabajo del co-piloto con proveedor remoto o la descarga de un tema (T-8.3). */
export type ConsentKind = JobKind | 'theme-install';

export class ConsentStore {
  private readonly pending = new Map<string, { readonly kind: ConsentKind; readonly issuedAt: number }>();
  private readonly now: () => Date;
  private readonly ttlMs: number;
  private readonly newId: () => string;

  constructor(now: () => Date = () => new Date(), ttlMs: number = CONSENT_TTL_MS, newId: () => string = randomUUID) {
    this.now = now;
    this.ttlMs = ttlMs;
    this.newId = newId;
  }

  issue(kind: ConsentKind): string {
    const id = this.newId();
    this.pending.set(id, { kind, issuedAt: this.now().getTime() });
    return id;
  }

  /** Consume el id: válido solo una vez, para la misma tarea y dentro del plazo. */
  redeem(id: string, kind: ConsentKind): boolean {
    const entry = this.pending.get(id);
    if (entry === undefined) {
      return false;
    }
    this.pending.delete(id);
    return entry.kind === kind && this.now().getTime() - entry.issuedAt <= this.ttlMs;
  }
}
