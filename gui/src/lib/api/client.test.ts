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
    await api.offerHistory({ offer: { text: 'Kubernetes' } });
    // Borradores y duplicados (T-9.19, T-9.20): el nombre y la ruta se codifican por segmento, como las fuentes.
    await api.drafts();
    await api.draftFiles('cv-lucas');
    await api.draftFile('cv-lucas', 'experience/ñ acme.md');
    await api.writeDraftFile('cv-lucas', 'experience/acme.md', 'nuevo', 'abc');
    await api.adoptDraftEntries({ entries: [{ draft: 'cv-lucas', section: 'experience', id: 'exp-acme' }] });
    await api.replaceSourcesWithDraft({ draft: 'cv-lucas' });
    await api.duplicates();
    await api.resolveDuplicate({ keep: 'edu-a', absorb: ['edu-b'], dryRun: true });
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
      'POST /api/v1/offers/history',
      'GET /api/v1/drafts',
      'GET /api/v1/drafts/cv-lucas/files',
      'GET /api/v1/drafts/cv-lucas/files/experience/%C3%B1%20acme.md',
      'PUT /api/v1/drafts/cv-lucas/files/experience/acme.md',
      'POST /api/v1/drafts/adopt',
      'POST /api/v1/drafts/replace',
      'GET /api/v1/duplicates',
      'POST /api/v1/duplicates/resolve',
    ]);
    expect(calls[3]?.body).toBe('{}');
    // Corregir un borrador exige la huella, igual que corregir una fuente.
    expect(calls.find((call) => call.url === '/api/v1/drafts/cv-lucas/files/experience/acme.md')).toMatchObject({ method: 'PUT', headers: { 'If-Match': '"abc"' }, body: '{"content":"nuevo"}' });
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
    await api.importCv(new Blob(['%PDF-1.4']), { name: 'mío borrador', replace: true });
    await api.importCv(new Blob(['PK\u0003\u0004']));
    await api.importLinkedIn(new Blob(['PK\u0003\u0004']), { name: 'mio', replace: true });
    await api.importLinkedIn(new Blob(['PK\u0003\u0004']));
    await api.offers();
    await api.offerFetch({ url: 'https://e.com/o' });
    await api.offerSave({ path: 'x.txt', text: 't' });
    await api.applyImportProposal({ name: 'mio', line: 9, section: 'habilidad' });
    await api.saveAliases({ proposals: [{ tag: 'kafka', evidence: 'sistemas de mensajería' }] });
    await api.applyTags({ proposals: [{ id: 'exp-acme-1', tags: ['kubernetes'] }] });
    await api.rankOffers({ offers: [{ workspaceFile: 'offers/a.txt' }, { text: 'PHP' }] });
    await api.importFolder({ directory: 'mis-cv' });
    await api.cvFolders();
    await api.importManfred(new Blob(['{}']), { name: 'mac', replace: true });
    await api.importManfred(new Blob(['{}']));
    await api.setLlmKey('gemini', 'sk-secreta');
    await api.removeLlmKey('gemini');
    await api.themes();
    await api.createTheme({ name: 'mio', from: 'classic' });
    await api.outputs();
    const pdf = await api.output('cv.pdf');
    expect(pdf).toMatchObject({ name: 'cv.pdf', contentType: 'application/pdf' });
    expect(await pdf.blob.text()).toBe('%PDF');
    expect((await api.output('sin-tipo')).contentType).toBe('application/octet-stream');
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['POST /api/v1/generate', 'POST /api/v1/analyze-offer', 'POST /api/v1/offers/extract', 'POST /api/v1/import-cv', 'POST /api/v1/import-cv', 'POST /api/v1/import-linkedin', 'POST /api/v1/import-linkedin', 'GET /api/v1/offers', 'POST /api/v1/offers/fetch', 'POST /api/v1/offers', 'POST /api/v1/import/apply', 'POST /api/v1/aliases', 'POST /api/v1/tags/apply', 'POST /api/v1/offers/rank', 'POST /api/v1/import-cv/folder', 'GET /api/v1/import-cv/folders', 'POST /api/v1/import-manfred', 'POST /api/v1/import-manfred', 'PUT /api/v1/config/llm/keys/gemini', 'DELETE /api/v1/config/llm/keys/gemini', 'GET /api/v1/themes', 'POST /api/v1/themes', 'GET /api/v1/output', 'GET /api/v1/output/cv.pdf', 'GET /api/v1/output/sin-tipo']);
    expect(calls[0]?.body).toBe('{"format":"md","specialty":"backend"}');
    expect(calls[2]).toMatchObject({ headers: { 'Content-Type': 'application/pdf' }, body: '%PDF-1.7' });
    expect(calls[3]).toMatchObject({ headers: { 'x-cv-import-name': 'mío borrador', 'x-cv-import-replace': '1' }, body: '%PDF-1.4' });
    expect(calls[4]?.headers['x-cv-import-name']).toBeUndefined();
    expect(calls[4]?.headers['x-cv-import-replace']).toBeUndefined();
    // La descarga de una salida no pide JSON: acepta cualquier cosa. Se busca por su URL para que añadir una
    // llamada más arriba no obligue a renumerar.
    expect(calls.find((call) => call.url === '/api/v1/output/cv.pdf')?.headers['Accept']).toBe('*/*');
    // Y el MAC de Manfred viaja como cuerpo binario, con sus cabeceras de nombre y sustitución.
    const manfred = calls.filter((call) => call.url === '/api/v1/import-manfred');
    expect(manfred[0]).toMatchObject({ headers: { 'Content-Type': 'application/pdf', 'x-cv-import-name': 'mac', 'x-cv-import-replace': '1' } });
    expect(manfred[1]?.headers['x-cv-import-name']).toBeUndefined();
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

  it('revisiones: listar, leer, guardar con If-Match, aplicar (plan y escritura), archivar, deshacer y borrar', async () => {
    const { fetch: f, calls } = fakeFetch(() => json(200, { ok: true }));
    const api = createApiClient({ fetch: f, token: () => 't' });
    await api.reviews();
    await api.review('revision-improve-2026-08-30.md');
    await api.writeReview('revision-improve-2026-08-30.md', '# x', 'abc');
    await api.applyReview('revision-improve-2026-08-30.md', {});
    await api.applyReview('revision-improve-2026-08-30.md', { dryRun: false, deleteReview: true });
    await api.archiveReview('revision-improve-2026-08-30.md', true);
    await api.undoReview('revision-improve-2026-08-30.md');
    await api.deleteReview('revision-improve-2026-08-30.md');
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /api/v1/reviews',
      'GET /api/v1/reviews/revision-improve-2026-08-30.md',
      'PUT /api/v1/reviews/revision-improve-2026-08-30.md',
      'POST /api/v1/reviews/revision-improve-2026-08-30.md/apply',
      'POST /api/v1/reviews/revision-improve-2026-08-30.md/apply',
      'POST /api/v1/reviews/revision-improve-2026-08-30.md/archive',
      'POST /api/v1/reviews/revision-improve-2026-08-30.md/undo',
      'DELETE /api/v1/reviews/revision-improve-2026-08-30.md',
    ]);
    expect(calls[2]).toMatchObject({ headers: { 'If-Match': '"abc"' }, body: '{"content":"# x"}' });
    expect(calls[3]?.body).toBe('{}');
    expect(calls[4]?.body).toBe('{"dryRun":false,"deleteReview":true}');
    expect(calls[5]?.body).toBe('{"archived":true}');
    expect(calls[6]?.body).toBe('{}');
  });

  it('vida laboral: el informe se sube como PDF (T-9.28)', async () => {
    const { fetch: f, calls } = fakeFetch(() => json(200, { spells: 1, employers: 1, items: [] }));
    const api = createApiClient({ fetch: f, token: () => 't' });
    await api.vidaLaboral(new Blob(['%PDF'], { type: 'application/pdf' }));
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['POST /api/v1/vida-laboral']);
    expect(calls[0]?.headers['Content-Type']).toBe('application/pdf');
  });

  it('linkedin: el plan se pide por POST y sin borrador va con el cuerpo vacío (T-9.27)', async () => {
    const { fetch: f, calls } = fakeFetch(() => json(200, { ok: true }));
    const api = createApiClient({ fetch: f, token: () => 't' });
    await api.linkedinPlan({});
    await api.linkedinPlan({ draft: 'perfil' });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['POST /api/v1/linkedin/plan', 'POST /api/v1/linkedin/plan']);
    expect(calls[0]?.body).toBe('{}');
    expect(calls[1]?.body).toBe('{"draft":"perfil"}');
  });

  it('fuentes: el plan de borrado no borra y el borrado exige la huella (T-9.25)', async () => {
    const { fetch: f, calls } = fakeFetch(() => json(200, { ok: true }));
    const api = createApiClient({ fetch: f, token: () => 't' });
    await api.deleteSourcePlan('experience/acme.md');
    await api.deleteSource('experience/acme.md', 'abc');
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['POST /api/v1/sources-delete-plan/experience/acme.md', 'DELETE /api/v1/sources/experience/acme.md']);
    expect(calls[1]?.headers['If-Match']).toBe('"abc"');
  });

  it('portabilidad: exportar e importar', async () => {
    const { fetch: f, calls } = fakeFetch(() => json(200, { ok: true }));
    const api = createApiClient({ fetch: f, token: () => 't' });
    await api.exportProfile();
    await api.importProfile({ profile: { personal: { fullName: 'Ada' } }, replace: true, dryRun: false });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['GET /api/v1/export', 'POST /api/v1/import']);
    expect(calls[1]?.body).toBe('{"profile":{"personal":{"fullName":"Ada"}},"replace":true,"dryRun":false}');
  });

  it('configuración del co-piloto: leer, guardar con If-Match y comprobar', async () => {
    const { fetch: f, calls } = fakeFetch(() => json(200, { ok: true }));
    const api = createApiClient({ fetch: f, token: () => 't' });
    await api.llmConfig();
    await api.writeLlmConfig({ provider: 'ollama', model: 'qwen' }, 'abc');
    await api.writeLlmConfig({}, '*');
    await api.checkLlm({ provider: 'groq' });
    await api.writeServeConfig({ allow_remote: true }, 'abc');
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['GET /api/v1/config/llm', 'PUT /api/v1/config/llm', 'PUT /api/v1/config/llm', 'POST /api/v1/config/llm/check', 'PUT /api/v1/config/serve']);
    expect(calls[4]).toMatchObject({ headers: { 'If-Match': '"abc"' }, body: '{"allow_remote":true}' });
    expect(calls[1]).toMatchObject({ headers: { 'If-Match': '"abc"' }, body: '{"provider":"ollama","model":"qwen"}' });
    expect(calls[2]).toMatchObject({ headers: { 'If-Match': '*' } });
    expect(calls[3]?.body).toBe('{"provider":"groq"}');
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

describe('temas de la comunidad (T-8.3)', () => {
  it('instalar y verificar temas: cuerpos y rutas', async () => {
    const { fetch: f, calls } = fakeFetch(() => json(200, { ok: true }));
    const api = createApiClient({ fetch: f, token: () => 't' });
    await api.installTheme({ source: 'themes/comunidad.zip', dryRun: true });
    await api.installTheme({ source: 'https://cdn.example/t.zip', name: 'otra', sha256: 'abc', consent: { estimateId: 'e1' } });
    await api.verifyTheme('comunidad');
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['POST /api/v1/themes/install', 'POST /api/v1/themes/install', 'POST /api/v1/themes/comunidad/verify']);
    expect(calls[0]?.body).toBe('{"source":"themes/comunidad.zip","dryRun":true}');
    expect(calls[1]?.body).toBe('{"source":"https://cdn.example/t.zip","name":"otra","sha256":"abc","consent":{"estimateId":"e1"}}');
    expect(calls[2]?.body).toBe('{}');
  });
});

describe('runtime de Ollama (T-8.8)', () => {
  it('consulta el estado y envía las acciones al servidor', async () => {
    const { fetch: f, calls } = fakeFetch((call) => json(call.method === 'GET' ? 200 : 202, call.method === 'GET' ? { runtime: { running: false } } : { job: { id: 'j1' } }));
    const api = createApiClient({ fetch: f, token: () => 'tok-1234567890abcdef' });
    expect(await api.llmRuntime()).toEqual({ runtime: { running: false } });
    expect(await api.llmRuntimeAction({ action: 'up', model: 'llama3:8b', pull: true })).toEqual({ job: { id: 'j1' } });
    expect(await api.llmModels()).toEqual({ runtime: { running: false } });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['GET /api/v1/llm/runtime', 'POST /api/v1/llm/runtime', 'GET /api/v1/llm/models']);
    expect(calls[1]?.body).toBe(JSON.stringify({ action: 'up', model: 'llama3:8b', pull: true }));
  });
});

describe('histórico de versiones de las fuentes (T-8.10)', () => {
  it('lista, lee y restaura versiones contra el servidor', async () => {
    const { fetch: f, calls } = fakeFetch((call) => json(200, call.method === 'GET' ? { entries: [] } : { path: '/w/a.md' }));
    const api = createApiClient({ fetch: f, token: () => 'tok-1234567890abcdef' });
    expect(await api.sourceHistory()).toEqual({ entries: [] });
    await api.sourceVersion({ entry: 'latest', path: 'a.md' });
    await api.restoreSourceVersion({ entry: 'x', path: 'a.md' });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['GET /api/v1/history', 'POST /api/v1/history/version', 'POST /api/v1/history/restore']);
  });
});

describe('peticiones GET a la vez', () => {
  it('las idénticas que coinciden en vuelo comparten una sola llamada, y después se vuelve a preguntar', async () => {
    let sirve = (): void => {};
    const espera = new Promise<void>((resolve) => { sirve = resolve; });
    const { fetch: f, calls } = fakeFetch(() => json(200, { version: '9.9.9' }));
    const lento = (async (url: string, init: unknown): Promise<Response> => { await espera; return f(url, init as never); }) as typeof f;
    const api = createApiClient({ fetch: lento, token: () => 't' });
    const dos = Promise.all([api.status(), api.status()]);
    sirve();
    const [uno, otro] = await dos;
    expect(uno).toEqual(otro);
    expect(calls).toHaveLength(1);
    // No es una caché: la siguiente pregunta vuelve a salir a la red.
    await api.status();
    expect(calls).toHaveLength(2);
    // Y lo que no es un GET nunca se comparte: dos escrituras son dos escrituras.
    await Promise.all([api.build(), api.build()]);
    expect(calls).toHaveLength(4);
  });
});

describe('usuarios del espacio de trabajo (T-9.32)', () => {
  it('manda x-cv-user cuando hay usuario elegido y no la manda cuando no lo hay', async () => {
    const { fetch: f, calls } = fakeFetch(() => json(200, { root: '/work', users: [], current: undefined, pinned: undefined, rootUsable: true }));
    let user: string | undefined;
    const api = createApiClient({ fetch: f, token: () => 't', user: () => user });
    await api.users();
    expect(calls[0]?.headers['x-cv-user']).toBeUndefined();
    user = 'invitado1';
    await api.users();
    expect(calls[1]?.headers['x-cv-user']).toBe('invitado1');
    // Una elección vacía es «la raíz», no una cabecera vacía que el servidor tendría que interpretar.
    user = '';
    await api.users();
    expect(calls[2]?.headers['x-cv-user']).toBeUndefined();
  });

  it('crea y retira usuarios por las rutas del contrato, con el identificador codificado', async () => {
    const { fetch: f, calls } = fakeFetch(() => json(200, {}));
    const api = createApiClient({ fetch: f, token: () => 't' });
    await api.createUser({ id: 'invitado1' });
    expect(calls[0]).toMatchObject({ url: '/api/v1/users', method: 'POST', body: '{"id":"invitado1"}' });
    await api.removeUser('invitado 1');
    expect(calls[1]).toMatchObject({ url: '/api/v1/users/invitado%201', method: 'DELETE' });
  });

  it('dos GET iguales de USUARIOS DISTINTOS no comparten petición: la clave lleva el usuario', async () => {
    const pending: ((response: Response) => void)[] = [];
    const calls: string[] = [];
    let user = 'a';
    const f = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push(String((init as { headers?: Record<string, string> } | undefined)?.headers?.['x-cv-user'] ?? ''));
      void input;
      return new Promise<Response>((resolve) => pending.push(resolve));
    }) as typeof fetch;
    const api = createApiClient({ fetch: f, token: () => 't', user: () => user });
    const first = api.status();
    user = 'b';
    const second = api.status();
    // Dos peticiones de verdad, una por usuario: compartirlas devolvería a «b» los datos de «a».
    expect(calls).toEqual(['a', 'b']);
    for (const resolve of pending) {
      resolve(json(200, {}));
    }
    await Promise.all([first, second]);
  });
});
