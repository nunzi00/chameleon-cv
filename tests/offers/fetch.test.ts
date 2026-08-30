/**
 * Descarga de ofertas por URL (T-8.5 S1, §4.2 y §7): guardia SSRF con resolutor inyectado, solo https, límites,
 * redirecciones re-validadas, tipos de contenido cerrados y juegos de caracteres. Todo con dobles: aquí no hay red.
 */
import { describe, expect, it } from 'vitest';

import { createServer } from 'node:http';

import { OFFER_URL_LIMITS, OFFER_URL_USER_AGENT, decodeBody, fetchOffer, isForbiddenAddress, offerFetcher, type FetchOfferOptions } from '../../src/offers';
import type { FetchedResponse } from '../../src/typst/download';

function response(overrides: Partial<FetchedResponse> & { readonly content?: string | Uint8Array }): FetchedResponse {
  const content = overrides.content ?? '';
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return {
    ok: true,
    status: 200,
    url: 'https://ofertas.example/puesto',
    body: (async function* () {
      yield bytes;
    })(),
    contentLength: bytes.byteLength,
    contentType: 'text/html; charset=utf-8',
    ...overrides,
  };
}

const PDF_OK = { ok: true as const, text: 'texto del pdf' };

function options(overrides: Partial<FetchOfferOptions> = {}): FetchOfferOptions {
  return {
    fetcher: async () => response({ content: '<html><body><main><p>' + 'palabra util relevante '.repeat(40) + '</p></main></body></html>' }),
    resolveHost: async () => ['203.0.113.10'],
    pdfExtractor: async () => PDF_OK,
    ...overrides,
  };
}

describe('isForbiddenAddress', () => {
  it('veta loopback, privadas, enlace local (metadatos incluidos), CGNAT, únicas locales y no especificadas', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1', '[::1]']) {
      expect(isForbiddenAddress(address), address).toBe(true);
    }
    for (const address of ['203.0.113.10', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2001:db8::1', '::ffff:8.8.8.8']) {
      expect(isForbiddenAddress(address), address).toBe(false);
    }
  });
});

describe('guardia de la URL', () => {
  it('rechaza URL inválidas, http, credenciales, IP privadas literales y hosts que resuelven a direcciones privadas', async () => {
    expect(await fetchOffer('no-es-url', options())).toMatchObject({ ok: false, code: 'invalid-url' });
    expect(await fetchOffer('http://ofertas.example/x', options())).toMatchObject({ ok: false, code: 'invalid-url', message: expect.stringContaining('https') as string });
    expect(await fetchOffer('https://usuario:clave@ofertas.example/x', options())).toMatchObject({ ok: false, code: 'invalid-url', message: 'La URL no puede llevar credenciales' });
    expect(await fetchOffer('https://192.168.1.10/x', options())).toMatchObject({ ok: false, code: 'forbidden-address' });
    expect(await fetchOffer('https://interna.example/x', options({ resolveHost: async () => ['203.0.113.10', '10.0.0.5'] }))).toMatchObject({
      ok: false,
      code: 'forbidden-address',
      message: expect.stringContaining('10.0.0.5') as string,
    });
    expect(await fetchOffer('https://caida.example/x', options({ resolveHost: async () => Promise.reject(new Error('NXDOMAIN')) }))).toMatchObject({ ok: false, code: 'download' });
  });

  it('una redirección que acaba en una dirección privada o en http se descarta', async () => {
    const toPrivate = options({ fetcher: async () => response({ url: 'https://127.0.0.1/interno', content: '<p>x</p>' }) });
    expect(await fetchOffer('https://ofertas.example/p', toPrivate)).toMatchObject({ ok: false, code: 'forbidden-address' });
    const toHttp = options({ fetcher: async () => response({ url: 'http://ofertas.example/p', content: '<p>x</p>' }) });
    expect(await fetchOffer('https://ofertas.example/p', toHttp)).toMatchObject({ ok: false, code: 'download', message: expect.stringContaining('no segura') as string });
  });
});

describe('descarga y tipos de contenido', () => {
  it('una IP literal pública (v4 o v6) salta el DNS y descarga directamente', async () => {
    const noDns = options({ resolveHost: async () => Promise.reject(new Error('no debería resolverse')) });
    const v4 = await fetchOffer('https://203.0.113.10/puesto', noDns);
    expect(v4.ok).toBe(true);
    const v6 = await fetchOffer('https://[2001:db8::1]/puesto', noDns);
    expect(v6.ok).toBe(true);
  });

  it('HTML feliz: extrae con el extractor y conserva URL final, bytes y clase', async () => {
    const result = await fetchOffer('https://ofertas.example/puesto', options());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.offer.kind).toBe('html');
      expect(result.offer.url).toBe('https://ofertas.example/puesto');
      expect(result.offer.bytes).toBeGreaterThan(100);
      expect(result.offer.text).toContain('palabra util relevante');
    }
  });

  it('HTTP de error, cuerpo por encima del límite y fallo de red se tipifican como download', async () => {
    expect(await fetchOffer('https://ofertas.example/404', options({ fetcher: async () => response({ ok: false, status: 404, body: null }) }))).toMatchObject({ ok: false, code: 'download', message: expect.stringContaining('404') as string });
    const big = new Uint8Array(OFFER_URL_LIMITS.maxBytes + 1);
    expect(await fetchOffer('https://ofertas.example/grande', options({ fetcher: async () => response({ content: big, contentLength: undefined }) }))).toMatchObject({ ok: false, code: 'download', message: expect.stringContaining('máximo') as string });
    expect(await fetchOffer('https://ofertas.example/cae', options({ fetcher: async () => Promise.reject(new Error('reset')) }))).toMatchObject({ ok: false, code: 'download' });
  });

  it('PDF: extrae el texto, tipifica el PDF ilegible y el vacío', async () => {
    const pdf = options({ fetcher: async () => response({ contentType: 'application/pdf', content: new Uint8Array([1, 2, 3]) }) });
    const result = await fetchOffer('https://ofertas.example/oferta.pdf', pdf);
    expect(result.ok && result.offer.kind).toBe('pdf');
    expect(result.ok && result.offer.text).toBe('texto del pdf');
    const broken = { ...pdf, pdfExtractor: async () => ({ ok: false as const, message: 'corrupto' }) };
    expect(await fetchOffer('https://ofertas.example/oferta.pdf', broken)).toMatchObject({ ok: false, code: 'pdf' });
    const blank = { ...pdf, pdfExtractor: async () => ({ ok: true as const, text: '   ' }) };
    expect(await fetchOffer('https://ofertas.example/oferta.pdf', blank)).toMatchObject({ ok: false, code: 'empty' });
  });

  it('texto plano y Markdown pasan tal cual; vacío y tipos raros se rechazan; sin content-type se asume HTML', async () => {
    const plain = await fetchOffer('https://ofertas.example/t', options({ fetcher: async () => response({ contentType: 'text/plain', content: 'Oferta en texto plano.' }) }));
    expect(plain.ok && plain.offer.kind).toBe('texto');
    const emptyText = await fetchOffer('https://ofertas.example/t', options({ fetcher: async () => response({ contentType: 'text/markdown', content: '  ' }) }));
    expect(emptyText).toMatchObject({ ok: false, code: 'empty' });
    expect(await fetchOffer('https://ofertas.example/z', options({ fetcher: async () => response({ contentType: 'application/zip', content: 'x' }) }))).toMatchObject({ ok: false, code: 'content-type' });
    const noType = await fetchOffer('https://ofertas.example/p', options({ fetcher: async () => response({ contentType: undefined, content: '<html><body><main><p>' + 'texto de oferta suficiente '.repeat(30) + '</p></main></body></html>' }) }));
    expect(noType.ok && noType.offer.kind).toBe('html');
    const emptyHtml = await fetchOffer('https://ofertas.example/vacia', options({ fetcher: async () => response({ content: '<html><body></body></html>' }) }));
    expect(emptyHtml).toMatchObject({ ok: false, code: 'empty' });
  });

  it('decodeBody: charset de la cabecera, del <meta>, y reserva UTF-8 ante uno desconocido', () => {
    const latin = new Uint8Array([0xe9]); // «é» en ISO-8859-1
    expect(decodeBody(latin, 'text/html; charset=iso-8859-1', true)).toBe('é');
    const metaHtml = new TextEncoder().encode('<html><head><meta charset="utf-8"></head><body>é</body></html>');
    expect(decodeBody(metaHtml, undefined, true)).toContain('é');
    expect(decodeBody(new TextEncoder().encode('hola'), 'text/plain; charset=marciano-9', false)).toBe('hola');
  });
});

describe('offerFetcher y el resolutor por defecto', () => {
  it('envía las cabeceras de oferta (UA de navegador, accept y accept-language) y devuelve el content-type', async () => {
    const seen: Record<string, string | undefined> = {};
    const server = createServer((request, response) => {
      seen['user-agent'] = request.headers['user-agent'];
      seen['accept'] = request.headers['accept'];
      seen['accept-language'] = request.headers['accept-language'];
      if (request.url === '/cruda') {
        // Sin content-type y en trozos (sin content-length): las dos cabeceras ausentes.
        response.removeHeader('Content-Type');
        response.write('ho');
        response.end('la');
        return;
      }
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.end('hola');
    });
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
    const port = (server.address() as { port: number }).port;
    try {
      const fetched = await offerFetcher('es-ES')(`http://127.0.0.1:${port}/oferta`, 2_000);
      expect(fetched.ok).toBe(true);
      expect(fetched.contentType).toContain('text/plain');
      expect(seen['user-agent']).toBe(OFFER_URL_USER_AGENT);
      expect(seen['accept']).toContain('text/html');
      expect(seen['accept-language']).toBe('es-ES');
      const bare = await offerFetcher(undefined)(`http://127.0.0.1:${port}/cruda`);
      expect(bare.status).toBe(200);
      expect(bare.contentType).toBeUndefined();
      expect(bare.contentLength).toBeUndefined();
    } finally {
      await new Promise((closed) => server.close(closed));
    }
  });

  it('el resolutor por defecto corta localhost antes de tocar la red (SSRF)', async () => {
    const result = await fetchOffer('https://localhost/interno', { pdfExtractor: async () => ({ ok: true, text: 'x' }) });
    expect(result).toMatchObject({ ok: false, code: 'forbidden-address' });
  });
});
