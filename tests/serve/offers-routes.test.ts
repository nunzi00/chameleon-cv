/**
 * Rutas de ofertas (T-8.5 S2, docs/offers-from-url.md §4.4): el listado de offers/ con tipo y orden,
 * la descarga por URL con consentimiento en dos pasos (403 sin --allow-remote, 409 con estimateId de un
 * solo uso, 200 con procedencia y origen) y el guardado saneado con cabecera de origen.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer, type ServerHandle } from '../../src/serve';
import type { FetchedResponse } from '../../src/typst/download';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const TOKEN = 'token-de-pruebas-fijo';
const OFFER_URL = 'https://203.0.113.10/ofertas/backend-senior';

const PAGE = `<html><head><title>t</title></head><body><script type="application/ld+json">${JSON.stringify({
  '@type': 'JobPosting',
  title: 'Backend Senior',
  hiringOrganization: { name: 'Acme' },
  description: '<p>APIs REST con PHP y PostgreSQL; despliegues con Docker y Kubernetes; guardias y SLO. '.repeat(12) + '</p>',
})}</script></body></html>`;

function respond(content: string | Uint8Array, contentType: string, url = OFFER_URL): FetchedResponse {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return { ok: true, status: 200, url, body: (async function* () { yield bytes; })(), contentLength: bytes.byteLength, contentType };
}

describe('cv serve: rutas de ofertas', () => {
  let fs: MemoryFileSystem;
  let closed: ServerHandle;
  let open: ServerHandle;
  let bare: ServerHandle;

  const call = (handle: ServerHandle, path: string, init: RequestInit = {}): Promise<Response> =>
    fetch(`${handle.url}api/v1${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const post = (handle: ServerHandle, path: string, body: unknown): Promise<Response> => call(handle, path, { method: 'POST', body: JSON.stringify(body) });

  /** El extractor de PDF del doble: falla cuando el flag está bajado (cubre los dos brazos del envoltorio). */
  let pdfOk = true;

  beforeAll(async () => {
    fs = new MemoryFileSystem({
      '/work/data/sources/profile.md': '---\nfullName: Ada\n---\n',
      '/work/offers/vieja.txt': { kind: 'file', content: 'x', mtimeMs: 1000 },
      '/work/offers/nueva.md': { kind: 'file', content: 'y', mtimeMs: 2000 },
      '/work/offers/pdf/informe.pdf': { kind: 'file', content: 'z', mtimeMs: 1500 },
      '/work/offers/notas.ini': 'no es una oferta',
    });
    const context = appContext(fs, {
      // Por URL: «…/pdf» responde un binario application/pdf; el resto, la página HTML con JSON-LD.
      fetcher: async (url) => (String(url).endsWith('/pdf') ? respond(new TextEncoder().encode('%PDF-1.4 finto'), 'application/pdf', String(url)) : respond(PAGE, 'text/html; charset=utf-8')),
      pdfExtractor: async () => (pdfOk ? { ok: true as const, text: 'Backend senior en Acme: APIs REST, Kafka y SLO. '.repeat(8), pages: 1 } : { ok: false as const, code: 'invalid' as const, message: 'PDF cifrado' }),
    });
    const options = { context, host: '127.0.0.1', port: 0, data: 'data/sources', profile: 'data/dist/profile.json', version: '9.9.9', apiOnly: true, allowedHosts: [], token: TOKEN };
    closed = await startServer({ ...options, allowRemote: false });
    open = await startServer({ ...options, allowRemote: true });
    // Sin fetcher inyectado: el brazo por defecto (offerFetcher real) + la guardia SSRF sin tocar la red.
    bare = await startServer({ ...options, context: appContext(new MemoryFileSystem({ '/work/data/sources/profile.md': '---\nfullName: Ada\n---\n' })), allowRemote: true });
  });

  afterAll(async () => {
    await closed.close();
    await open.close();
    await bare.close();
  });

  it('GET /offers lista con tipo, de la más reciente a la más antigua, e ignora extensiones ajenas', async () => {
    const response = await call(open, '/offers');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { files: readonly { path: string; kind: string; bytes: number }[] };
    expect(body.files.map((file) => [file.path, file.kind])).toEqual([
      ['offers/nueva.md', 'markdown'],
      ['offers/pdf/informe.pdf', 'pdf'],
      ['offers/vieja.txt', 'text'],
    ]);
  });

  it('POST /offers/fetch: 403 sin --allow-remote; URL inválida 422; consentimiento de un solo uso y 200 con procedencia', async () => {
    expect((await post(closed, '/offers/fetch', { url: OFFER_URL })).status).toBe(403);
    expect((await post(open, '/offers/fetch', { url: 'no-es-url' })).status).toBe(422);
    const first = await post(open, '/offers/fetch', { url: OFFER_URL });
    expect(first.status).toBe(409);
    const consent = (await first.json()) as { error: { code: string; estimateId: string; host: string; limitBytes: number } };
    expect(consent.error).toMatchObject({ code: 'consent-required', host: '203.0.113.10', limitBytes: 2 * 1024 * 1024 });
    const wrong = await post(open, '/offers/fetch', { url: OFFER_URL, consent: { estimateId: 'no-vale' } });
    expect(wrong.status).toBe(409);
    const fetched = await post(open, '/offers/fetch', { url: OFFER_URL, consent: { estimateId: consent.error.estimateId } });
    expect(fetched.status).toBe(200);
    const offer = (await fetched.json()) as { text: string; title?: string; source: string; origin: { url: string; kind: string; fetchedAt: string; bytes: number } };
    expect(offer.title).toBe('Backend Senior');
    expect(offer.source).toBe('json-ld');
    expect(offer.origin).toMatchObject({ url: OFFER_URL, kind: 'html' });
    expect(offer.origin.fetchedAt.startsWith('2')).toBe(true);
    expect(offer.text).toContain('Título: Backend Senior');
    const reuse = await post(open, '/offers/fetch', { url: OFFER_URL, consent: { estimateId: consent.error.estimateId } });
    expect(reuse.status).toBe(409);
  });

  it('cuerpo inválido en fetch y en guardar → 400; sin fetcher, la guardia corta un loopback antes de la red', async () => {
    expect((await post(open, '/offers/fetch', { nourl: true })).status).toBe(400);
    expect((await post(open, '/offers', { path: 'x.txt', text: '' })).status).toBe(400);
    const consent = await post(bare, '/offers/fetch', { url: 'https://127.0.0.1/oferta' });
    expect(consent.status).toBe(409);
    const { estimateId } = ((await consent.json()) as { error: { estimateId: string } }).error;
    const guarded = await post(bare, '/offers/fetch', { url: 'https://127.0.0.1/oferta', consent: { estimateId } });
    expect(guarded.status).toBe(422);
    expect((((await guarded.json()) as { error: { message: string } }).error.message)).toContain('127.0.0.1');
  });

  it('una oferta en PDF pasa por el extractor del contexto: texto si puede, 422 con el motivo si no', async () => {
    const url = 'https://203.0.113.10/ofertas/pdf';
    const ask = async (): Promise<{ status: number; json: unknown }> => {
      const first = await post(open, '/offers/fetch', { url });
      const { estimateId } = ((await first.json()) as { error: { estimateId: string } }).error;
      const second = await post(open, '/offers/fetch', { url, consent: { estimateId } });
      return { status: second.status, json: await second.json() };
    };
    pdfOk = true;
    const okCase = await ask();
    expect(okCase.status).toBe(200);
    expect((okCase.json as { origin: { kind: string } }).origin.kind).toBe('pdf');
    pdfOk = false;
    const koCase = await ask();
    expect(koCase.status).toBe(422);
    expect((koCase.json as { error: { message: string } }).error.message).toContain('PDF cifrado');
    pdfOk = true;
  });

  it('POST /offers guarda saneado con cabecera de origen; ruta fea o fuera 422; existente 409 salvo replace', async () => {
    const created = await post(open, '/offers', { path: 'acme/backend.md', text: 'Texto de la oferta', origin: { url: OFFER_URL } });
    expect(created.status).toBe(201);
    expect(((await created.json()) as { path: string }).path).toBe('offers/acme/backend.md');
    const saved = fs.file('/work/offers/acme/backend.md')?.content ?? '';
    expect(saved.startsWith(`# Origen: ${OFFER_URL}\n# Descargada: 2`)).toBe(true);
    expect(saved).toContain('\n\nTexto de la oferta\n');
    expect((await post(open, '/offers', { path: 'malo.exe', text: 'x' })).status).toBe(422);
    expect((await post(open, '/offers', { path: 'a/../../fuera.txt', text: 'x' })).status).toBe(422);
    expect((await post(open, '/offers', { path: 'a/../dentro.txt', text: 'ok' })).status).toBe(201);
    expect((await post(open, '/offers', { path: 'offers/nueva.md', text: 'x' })).status).toBe(409);
    expect((await post(open, '/offers', { path: 'nueva.md', text: 'sustituida', replace: true })).status).toBe(201);
    expect(fs.file('/work/offers/nueva.md')?.content).toBe('sustituida\n');
  });
});
