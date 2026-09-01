/**
 * La espera cancelable (T-9.16). `retryOnQuota` se prueba con el lote en `quota-batch.test.ts`; aquí se prueba
 * la pieza que de verdad toca el reloj: que el temporizador se cancele con la señal, que no espere si ya venía
 * abortada y que no deje temporizadores colgando.
 */
import { describe, expect, it } from 'vitest';

import { sleep, QUOTA_RETRY_DEFAULTS, retryOnQuota } from '../../src/llm/quota-retry';

describe('sleep: la espera que se puede cortar', () => {
  it('espera lo pedido cuando nadie la interrumpe', async () => {
    const started = Date.now();
    await sleep(20);
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });

  it('con la señal ya abortada vuelve en el acto, sin esperar nada', async () => {
    const controller = new AbortController();
    controller.abort();
    const started = Date.now();
    await sleep(5_000, controller.signal);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('abortar durante la espera la corta: es el botón de cancelar de la web y el Ctrl-C de la terminal', async () => {
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 10);
    await sleep(5_000, controller.signal);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe('retryOnQuota: los límites', () => {
  it('lo que no es cuota agotada no se reintenta nunca', async () => {
    let intentos = 0;
    const result = await retryOnQuota(
      () => {
        intentos += 1;
        return Promise.resolve({ ok: false, code: 'timeout', message: 'tarde' });
      },
      { wait: () => Promise.resolve() },
    );
    expect(intentos).toBe(1);
    expect(result).toMatchObject({ code: 'timeout' });
  });

  it('agotados los intentos, devuelve el último fallo del proveedor tal cual', async () => {
    const esperas: number[] = [];
    let intentos = 0;
    const result = await retryOnQuota(
      () => {
        intentos += 1;
        return Promise.resolve({ ok: false, code: 'quota-exceeded', message: 'cuota agotada', retryAfterSeconds: 2 });
      },
      { wait: (ms) => { esperas.push(ms); return Promise.resolve(); } },
    );
    expect(intentos).toBe(1 + QUOTA_RETRY_DEFAULTS.attempts);
    expect(esperas).toEqual([2000, 2000]);
    expect(result).toMatchObject({ code: 'quota-exceeded' });
  });

  it('a la primera buena, ni espera ni reintenta', async () => {
    const esperas: number[] = [];
    await retryOnQuota(() => Promise.resolve({ ok: true }), { wait: (ms) => { esperas.push(ms); return Promise.resolve(); } });
    expect(esperas).toEqual([]);
  });
});
