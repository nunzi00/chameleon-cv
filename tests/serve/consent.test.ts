import { describe, expect, it } from 'vitest';

import { CONSENT_TTL_MS, ConsentStore } from '../../src/serve/consent';

describe('ConsentStore', () => {
  it('cada estimateId vale una sola vez, para la misma tarea y dentro del plazo', () => {
    let now = Date.UTC(2026, 7, 29, 10, 0, 0);
    let n = 0;
    const store = new ConsentStore(() => new Date(now), CONSENT_TTL_MS, () => `c-${++n}`);
    const id = store.issue('improve');
    expect(id).toBe('c-1');
    expect(store.redeem(id, 'summarize')).toBe(false);
    expect(store.redeem(id, 'improve')).toBe(false);
    const again = store.issue('improve');
    expect(store.redeem(again, 'improve')).toBe(true);
    expect(store.redeem(again, 'improve')).toBe(false);
    const late = store.issue('suggest-tags');
    now += CONSENT_TTL_MS + 1;
    expect(store.redeem(late, 'suggest-tags')).toBe(false);
    expect(store.redeem('desconocido', 'improve')).toBe(false);
    expect(new ConsentStore().issue('improve')).toMatch(/^[0-9a-f-]{36}$/);
  });
});
