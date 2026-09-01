/**
 * Esperar y reintentar cuando el proveedor dice cuánto (T-9.16, encargo del PO del 1-sep: «me gustaría que
 * esperara el tiempo que indican y reintentar; también la opción de cancelar»). Hasta ahora un 429 detenía el
 * lote a la primera, y con un plan gratuito eso significa perder media tanda por quince segundos.
 *
 * Tres límites, porque esperar sin freno es peor que no esperar:
 *
 * 1. **Solo si el proveedor dice cuánto.** Sin `retry-after` no se inventa una espera: se para como siempre.
 * 2. **Un tope por espera.** Una cuota por minuto se aguanta; una diaria («reintenta en 3600 s») no, y ahí se
 *    para y se dice por qué en vez de dejar el proceso colgado una hora.
 * 3. **Un número de intentos.** Si tras ellos la cuota sigue agotada, se detiene con el mensaje del proveedor.
 *
 * Y la espera es **cancelable**: escucha la misma `AbortSignal` que corta el resto del lote, así que el botón de
 * cancelar de la web —y `Ctrl-C` en la terminal— la interrumpen en el acto.
 */

/** Lo mínimo que hace falta saber de un resultado para decidir si se reintenta. */
export interface QuotaAware {
  readonly ok: boolean;
  readonly code?: string | undefined;
  readonly retryAfterSeconds?: number | undefined;
}

export interface QuotaRetryOptions {
  /** Cuántas esperas se admiten; 0 = ninguna, que es el comportamiento de siempre. */
  readonly attempts?: number | undefined;
  /** Espera máxima admitida por intento, en segundos. */
  readonly maxWaitSeconds?: number | undefined;
  readonly progress?: ((line: string) => void) | undefined;
  readonly signal?: AbortSignal | undefined;
  /** Inyectable para las pruebas: por defecto, un temporizador real que se cancela con la señal. */
  readonly wait?: ((ms: number, signal?: AbortSignal) => Promise<void>) | undefined;
}

/** Dos esperas (tres intentos en total) y nada por encima de dos minutos: lo que cabe en una sesión. */
export const QUOTA_RETRY_DEFAULTS = { attempts: 2, maxWaitSeconds: 120 } as const;

/** Espera cancelable: si la señal se dispara, vuelve en el acto y quien llama ve el aborto. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Ejecuta `run` y, si el proveedor responde «cuota agotada» diciendo cuánto esperar, espera y lo vuelve a
 * intentar. Devuelve el último resultado: quien llama sigue viendo el mismo `quota-exceeded` de siempre si al
 * final no hubo suerte.
 */
export async function retryOnQuota<T extends QuotaAware>(run: () => Promise<T>, options: QuotaRetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? QUOTA_RETRY_DEFAULTS.attempts;
  const maxWaitSeconds = options.maxWaitSeconds ?? QUOTA_RETRY_DEFAULTS.maxWaitSeconds;
  const wait = options.wait ?? sleep;
  let result = await run();
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (result.ok || result.code !== 'quota-exceeded' || options.signal?.aborted === true) {
      return result;
    }
    const seconds = result.retryAfterSeconds;
    if (seconds === undefined) {
      options.progress?.('cuota agotada y el proveedor no dice cuánto esperar: no se reintenta');
      return result;
    }
    if (seconds > maxWaitSeconds) {
      options.progress?.(`cuota agotada: el proveedor pide esperar ${seconds} s, más de los ${maxWaitSeconds} s que se aguardan; no se reintenta`);
      return result;
    }
    options.progress?.(`cuota agotada: espero ${seconds} s y reintento (${attempt}/${attempts}) · cancela para no esperar`);
    await wait(seconds * 1000, options.signal);
    if (options.signal?.aborted ?? false) {
      return result;
    }
    result = await run();
  }
  return result;
}
