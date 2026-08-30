/**
 * Transporte HTTP sin límite de cabeceras para P2 (T-8.4): el `fetch` de Node (undici) corta a los 300 s si el servidor
 * no ha enviado las cabeceras, y un llama-server en CPU tarda más en generar el JSON completo. Solo para medir el spike:
 * sustituye el `fetch` global por una petición `node:http` (únicamente para URL http://) que respeta la señal de aborto
 * y devuelve un `Response` estándar. Nada de esto entra en el producto.
 */
import { request } from 'node:http';

const original = globalThis.fetch;

export function patientFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.protocol !== 'http:') {
    return original(input, init);
  }
  return new Promise<Response>((resolve, reject) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const req = request(url, { method: init.method ?? 'GET', headers, timeout: 0 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const responseHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(res.headers)) {
          if (typeof value === 'string') {
            responseHeaders[key] = value;
          }
        }
        resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 0, statusText: res.statusMessage ?? '', headers: responseHeaders }));
      });
    });
    req.on('error', reject);
    init.signal?.addEventListener('abort', () => req.destroy(init.signal?.reason instanceof Error ? init.signal.reason : new Error('Petición abortada')), { once: true });
    if (typeof init.body === 'string') {
      req.write(init.body);
    }
    req.end();
  });
}

export function installPatientFetch(): void {
  globalThis.fetch = patientFetch as typeof fetch;
}
