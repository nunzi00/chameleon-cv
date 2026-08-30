import { describe, expect, it } from 'vitest';

import { ApiError, NetworkError, createApiClient, encodeId, ifMatchHeader } from './client';

interface Recorded {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | null;
}

function fakeFetch(responder: (call: Recorded) => Response | Promise<Response>): { fetch: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: globalThis.RequestInit) => {
    const body = init?.body instanceof Blob ? await init.body.text() : null;
    const call = { url: String(input), method: init?.method ?? 'GET', headers: { ...((init?.headers as Record<string, string> | undefined) ?? {}) }, body };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('cliente de la API', () => {
  it('envía Bearer, Accept y JSON, codifica los identificadores por segmento y devuelve el cuerpo', async () => {
    const { fetch: f, calls } = fakeFetch(() => json(200, { path: 'experience/acme.md', content: 'x', sha256: 'abc' }));
    const api = createApiClient({ fetch: f, token: () => 'tok-1234567890abcdef' });
    const file = await api.source('experience/ñ acme.md');
    expect(file.sha256).toBe('abc');
    expect(calls[0]).toMatchObject({ url: '/api/v1/sources/experience/%C3%B1%20acme.md', method: 'GET', headers: { Accept: 'application/json', Authorization: 'Bearer tok-1234567890abcdef' }, body: null });
    await api.writeSource('experience/acme.md', 'nuevo', 'abc');
    expect(calls[1]).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': '"abc"' }, body: '{"content":"nuevo"}' });
    await api.writeSource('nuevo.md', 'x', '*');
    expect(calls[2]?.headers['If-Match']).toBe('*');
    await api.validate();
    await api.build();
    await api.status();
    await api.profile();
    await api.sources();
    await api.shutdown();
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /api/v1/sources/experience/%C3%B1%20acme.md',
      'PUT /api/v1/sources/experience/acme.md',
      'PUT /api/v1/sources/nuevo.md',
      'POST /api/v1/validate',
      'POST /api/v1/build',
      'GET /api/v1/status',
      'GET /api/v1/profile',
      'GET /api/v1/sources',
      'POST /api/v1/shutdown',
    ]);
    expect(calls[3]?.body).toBe('{}');
  });

  it('generar, analizar, extraer un PDF, temas y salidas: cuerpos, tipos de contenido y respuestas binarias', async () => {
    const { fetch: f, calls } = fakeFetch((call) => {
      if (call.url.endsWith('/output/cv.pdf')) {
        return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { 'Content-Type': 'application/pdf' } });
      }
      if (call.url.endsWith('/output/sin-tipo')) {
        return new Response(null, { status: 200 });
      }
      return json(200, { ok: true });
    });
    const api = createApiClient({ fetch: f, token: () => 't' });
    await api.generate({ format: 'md', specialty: 'backend' });
    await api.analyze({ offer: { text: 'Kubernetes' } });
    await api.extractOffer(new Blob(['%PDF-1.7'], { type: 'application/pdf' }));
    await api.themes();
    await api.createTheme({ name: 'mio', from: 'classic' });
    await api.outputs();
    const pdf = await api.output('cv.pdf');
    expect(pdf).toMatchObject({ name: 'cv.pdf', contentType: 'application/pdf' });
    expect(await pdf.blob.text()).toBe('%PDF');
    expect((await api.output('sin-tipo')).contentType).toBe('application/octet-stream');
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['POST /api/v1/generate', 'POST /api/v1/analyze-offer', 'POST /api/v1/offers/extract', 'GET /api/v1/themes', 'POST /api/v1/themes', 'GET /api/v1/output', 'GET /api/v1/output/cv.pdf', 'GET /api/v1/output/sin-tipo']);
    expect(calls[0]?.body).toBe('{"format":"md","specialty":"backend"}');
    expect(calls[2]).toMatchObject({ headers: { 'Content-Type': 'application/pdf' }, body: '%PDF-1.7' });
    expect(calls[6]?.headers['Accept']).toBe('*/*');
  });

  it('trabajos: encolar, listar, consultar, cancelar y seguir los eventos por SSE con Accept y señal', async () => {
    const { fetch: f, calls } = fakeFetch((call) => (call.url.endsWith('/events') ? new Response('event: status\ndata: {"id":"j1","status":"done","lines":[]}\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } }) : json(202, { job: { id: 'j1' } })));
    const api = createApiClient({ fetch: f, token: () => 't' });
    await api.startJob({ kind: 'improve', body: { specialty: 'backend' } });
    await api.startJob({ kind: 'suggest-tags', body: { text: 'x' } });
    await api.jobs();
    await api.job('j1');
    await api.cancelJob('j1');
    const controller = new AbortController();
    const events = [];
    for await (const event of api.jobEvents('j1', controller.signal)) {
      events.push(event.event);
    }
    expect(events).toEqual(['status']);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['POST /api/v1/jobs/improve', 'POST /api/v1/jobs/suggest-tags', 'GET /api/v1/jobs', 'GET /api/v1/jobs/j1', 'DELETE /api/v1/jobs/j1', 'GET /api/v1/jobs/j1/events']);
    expect(calls[0]?.body).toBe('{"specialty":"backend"}');
    expect(calls[5]?.headers['Accept']).toBe('text/event-stream');
  });

  it('revisiones: listar, leer, guardar con If-Match, aplicar (plan y escritura) y borrar', async () => {
    const { fetch: f, calls } = fakeFetch(() => json(200, { ok: true }));
    const api = createApiClient({ fetch: f, token: () => 't' });
    await api.reviews();
    await api.review('revision-improve-2026-08-30.md');
    await api.writeReview('revision-improve-2026-08-30.md', '# x', 'abc');
    await api.applyReview('revision-improve-2026-08-30.md', {});
    await api.applyReview('revision-improve-2026-08-30.md', { dryRun: false, deleteReview: true });
    await api.deleteReview('revision-improve-2026-08-30.md');
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['GET /api/v1/reviews', 'GET /api/v1/reviews/revision-improve-2026-08-30.md', 'PUT /api/v1/reviews/revision-improve-2026-08-30.md', 'POST /api/v1/reviews/revision-improve-2026-08-30.md/apply', 'POST /api/v1/reviews/revision-improve-2026-08-30.md/apply', 'DELETE /api/v1/reviews/revision-improve-2026-08-30.md']);
    expect(calls[2]).toMatchObject({ headers: { 'If-Match': '"abc"' }, body: '{"content":"# x"}' });
    expect(calls[3]?.body).toBe('{}');
    expect(calls[4]?.body).toBe('{"dryRun":false,"deleteReview":true}');
  });

  it('portabilidad: exportar e importar', async () => {
    const { fetch: f, calls } = fakeFetch(() => json(200, { ok: true }));
    const api = createApiClient({ fetch: f, token: () => 't' });
    await api.exportProfile();
    await api.importProfile({ profile: { personal: { fullName: 'Ada' } }, replace: true, dryRun: false });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['GET /api/v1/export', 'POST /api/v1/import']);
    expect(calls[1]?.body).toBe('{"profile":{"personal":{"fullName":"Ada"}},"replace":true,"dryRun":false}');
  });

  it('sin token no envía Authorization y admite otra base', async () => {
    const { fetch: f, calls } = fakeFetch(() => json(200, {}));
    await createApiClient({ fetch: f, token: () => undefined, base: 'http://127.0.0.1:4310/api/v1' }).status();
    expect(calls[0]?.url).toBe('http://127.0.0.1:4310/api/v1/status');
    expect(calls[0]?.headers['Authorization']).toBeUndefined();
  });

  it('convierte la envoltura de error en ApiError con código, líneas y detalles; sin envoltura, HTTP <estado>', async () => {
    const { fetch: f } = fakeFetch((call) =>
      call.url.endsWith('/validate') ? json(422, { error: { code: 'invalid-data', message: '2 problemas', lines: ['a', 'b'], issues: [{ file: 'x.md', message: 'm' }] } }) : new Response('nada', { status: 502 }),
    );
    const api = createApiClient({ fetch: f, token: () => 't' });
    const error = await api.validate().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    if (error instanceof ApiError) {
      expect(error).toMatchObject({ status: 422, code: 'invalid-data', message: '2 problemas', lines: ['a', 'b'] });
      expect(error.details).toEqual({ issues: [{ file: 'x.md', message: 'm' }] });
    }
    const plain = await api.status().catch((caught: unknown) => caught);
    expect(plain).toMatchObject({ status: 502, code: 'http', message: 'HTTP 502', lines: [] });
    const { fetch: emptyOk } = fakeFetch(() => new Response(null, { status: 204 }));
    expect(await createApiClient({ fetch: emptyOk, token: () => 't' }).shutdown()).toBeUndefined();
  });

  it('sin respuesta lanza NetworkError con la causa', async () => {
    const { fetch: f } = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const error = await createApiClient({ fetch: f, token: () => 't' }).status().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as Error).message).toBe('No se pudo conectar con cv serve: Failed to fetch');
    const { fetch: g } = fakeFetch(() => Promise.reject('caído'));
    expect(((await createApiClient({ fetch: g, token: () => 't' }).status().catch((caught: unknown) => caught)) as Error).message).toBe('No se pudo conectar con cv serve: caído');
  });

  it('encodeId e ifMatchHeader', () => {
    expect(encodeId('a b/c#d')).toBe('a%20b/c%23d');
    expect(ifMatchHeader('*')).toBe('*');
    expect(ifMatchHeader('abc')).toBe('"abc"');
  });
});
