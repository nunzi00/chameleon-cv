import { request as httpRequest } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PdfExtractionResult } from '../../src/pdf';
import { startServer, urlHost, type ServerHandle } from '../../src/serve';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const PROFILE = '---\nschemaVersion: 1\nlocale: es-ES\nfullName: Ada Ejemplo\nemail: ada@example.com\n---\n\nResumen.\n';
const BACKEND = '---\ntitle: Senior Backend Engineer\ntags: [php, kubernetes]\n---\n';
const ACME = '---\ncompany: ACME\nrole: Dev\nstart: 2020\ntags: [php]\n---\n\n## Logros\n\n- Hice cosas con **PHP**. #php\n- Otra cosa. #devops\n';
const TOKEN = 'token-de-pruebas-fijo';

function tree(): Record<string, string> {
  return {
    '/work/data/sources/profile.md': PROFILE,
    '/work/data/sources/specialties/backend.md': BACKEND,
    '/work/data/sources/experience/acme.md': ACME,
    '/work/plantilla.hbs': '# {{fullName}} (plantilla propia)\n',
    '/work/oferta.txt': 'Buscamos Kubernetes\n',
  };
}

function pdfExtractor(bytes: Uint8Array): Promise<PdfExtractionResult> {
  const text = Buffer.from(bytes).toString('utf8');
  if (text === 'timeout') {
    return Promise.resolve({ ok: false, code: 'timeout', message: 'tiempo agotado' });
  }
  return Promise.resolve(text.startsWith('%PDF') ? { ok: true, text: 'Texto extraído', pages: 1 } : { ok: false, code: 'invalid', message: 'no es un PDF' });
}

describe('cv serve: el contrato /api/v1 sobre un espacio de trabajo en memoria', () => {
  let fs: MemoryFileSystem;
  let server: ServerHandle;
  const api = (path: string, init: RequestInit = {}, token: string | null = TOKEN): Promise<Response> =>
    fetch(`${server.url}api/v1${path}`, { ...init, headers: { ...(token === null ? {} : { Authorization: `Bearer ${token}` }), ...(init.headers ?? {}) } });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> => api(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } });

  beforeAll(async () => {
    fs = new MemoryFileSystem(tree());
    server = await startServer({ context: appContext(fs, { pdfExtractor }), host: '127.0.0.1', port: 0, data: 'data/sources', profile: 'data/dist/profile.json', version: '9.9.9', apiOnly: false, allowedHosts: ['mi-host:1'], token: TOKEN });
  });
  afterAll(async () => {
    await server.close();
  });

  it('sirve la página mínima en / y nada más fuera de /api/v1', async () => {
    const page = await fetch(server.url);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await page.text()).toContain('Chameleon CV 9.9.9');
    expect((await fetch(`${server.url}otra`)).status).toBe(404);
    expect((await fetch(server.url, { method: 'POST' })).status).toBe(404);
  });

  it('rechaza Host ajenos (DNS rebinding), Origin ajenos en escrituras y peticiones sin token', async () => {
    const status = await new Promise<number>((resolve) => {
      httpRequest({ host: '127.0.0.1', port: server.port, path: '/api/v1/status', headers: { Host: 'evil.example:80', Authorization: `Bearer ${TOKEN}` } }, (response) => resolve(response.statusCode ?? 0)).end();
    });
    expect(status).toBe(403);
    const origin = await post('/validate', {}, { Origin: 'http://evil.example' });
    expect(origin.status).toBe(403);
    expect(await origin.json()).toEqual({ error: { code: 'forbidden-origin', message: 'Origin no permitido: solo el propio origen puede escribir' } });
    expect((await post('/validate', {}, { Origin: `http://127.0.0.1:${server.port}` })).status).toBe(200);
    expect((await post('/validate', {}, { Origin: 'http://mi-host:1' })).status).toBe(200);
    const anonymous = await api('/status', {}, null);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('www-authenticate')).toBe('Bearer');
    expect((await api('/status', {}, 'otro-token-de-pruebas')).status).toBe(401);
  });

  it('devuelve 404 en rutas desconocidas, 405 con Allow y 413 con cuerpos excesivos; nunca cabeceras CORS', async () => {
    expect((await api('/nope')).status).toBe(404);
    const method = await api('/status', { method: 'DELETE' });
    expect(method.status).toBe(405);
    expect(method.headers.get('allow')).toBe('GET');
    expect(method.headers.get('access-control-allow-origin')).toBeNull();
    expect(method.headers.get('cache-control')).toBe('no-store');
    const huge = await post('/validate', { padding: 'x'.repeat(1024 * 1024 + 1) });
    expect(huge.status).toBe(413);
  });

  it('GET /status describe el espacio de trabajo sin objetos no serializables', async () => {
    const status = await api('/status');
    expect(status.status).toBe(200);
    const body = (await status.json()) as { version: string; workspace: string; artifact: { status: string }; themes: { defaultName: string; roots: string[]; entries: Array<{ name: string }> } };
    expect(body.version).toBe('9.9.9');
    expect(body.workspace).toBe('/work');
    expect(body.artifact.status).toBe('missing');
    expect(body.themes.defaultName).toBe('default');
    expect(body.themes.roots.every((root) => typeof root === 'string')).toBe(true);
    expect(body.themes.entries.map((entry) => entry.name)).toEqual(expect.arrayContaining(['default', 'classic']));
  });

  it('fuentes: árbol con huellas, lectura con ETag, escritura con If-Match (428, 409, 400) y creación atómica 0600', async () => {
    const list = (await (await api('/sources')).json()) as { root: string; entries: Array<{ path: string; sha256: string }> };
    expect(list.root).toBe('/work/data/sources');
    expect(list.entries.map((entry) => entry.path).sort()).toEqual(['experience/acme.md', 'profile.md', 'specialties/backend.md']);
    const read = await api('/sources/experience/acme.md');
    expect(read.status).toBe(200);
    const file = (await read.json()) as { content: string; sha256: string };
    expect(file.content).toBe(ACME);
    expect(read.headers.get('etag')).toBe(`"${file.sha256}"`);
    expect((await api('/sources/experience/nada.md')).status).toBe(404);
    expect((await api('/sources/..%2Ffuera.md')).status).toBe(400);
    const noMatch = await api('/sources/projects/nuevo.md', { method: 'PUT', body: JSON.stringify({ content: 'x' }), headers: { 'Content-Type': 'application/json' } });
    expect(noMatch.status).toBe(428);
    const badBody = await api('/sources/projects/nuevo.md', { method: 'PUT', body: '{"contenido": 1}', headers: { 'Content-Type': 'application/json', 'If-Match': '*' } });
    expect(badBody.status).toBe(400);
    const created = await api('/sources/projects/nuevo.md', { method: 'PUT', body: JSON.stringify({ content: '---\nname: Nuevo\nstart: 2024\n---\n' }), headers: { 'Content-Type': 'application/json', 'If-Match': '*' } });
    expect(created.status).toBe(200);
    const { sha256 } = (await created.json()) as { sha256: string };
    expect(created.headers.get('etag')).toBe(`"${sha256}"`);
    expect(fs.file('/work/data/sources/projects/nuevo.md')?.mode).toBe(0o600);
    const stale = await api('/sources/projects/nuevo.md', { method: 'PUT', body: JSON.stringify({ content: 'otro' }), headers: { 'Content-Type': 'application/json', 'If-Match': '"huella-vieja"' } });
    expect(stale.status).toBe(409);
    const replaced = await api('/sources/projects/nuevo.md', { method: 'PUT', body: JSON.stringify({ content: '---\nname: Nuevo 2\nstart: 2024\n---\n' }), headers: { 'Content-Type': 'application/json', 'If-Match': `"${sha256}"` } });
    expect(replaced.status).toBe(200);
  });

  it('validar, compilar, leer el perfil, generar (Markdown, plantilla propia, PDF), listar y servir la salida', async () => {
    expect((await api('/profile')).status).toBe(422);
    const validate = await post('/validate', {});
    expect(validate.status).toBe(200);
    expect(((await validate.json()) as { files: string[] }).files).toContain('profile.md');
    const build = await post('/build', {});
    expect(build.status).toBe(200);
    expect(((await build.json()) as { artifactPath: string }).artifactPath).toBe('/work/data/dist/profile.json');
    const profile = (await (await api('/profile')).json()) as { personal: { fullName: string } };
    expect(profile.personal.fullName).toBe('Ada Ejemplo');

    const markdown = await post('/generate', { specialty: 'backend', offer: { text: 'Buscamos PHP y Kubernetes' }, topN: 1 });
    expect(markdown.status).toBe(200);
    const generated = (await markdown.json()) as { output: { name: string; kind: string; path: string; markdown: string }; report: { selection: unknown; match: unknown; removed: unknown[] } };
    expect(generated.output).toMatchObject({ name: 'cv-ada-ejemplo-backend-oferta.md', kind: 'md', path: 'output/cv-ada-ejemplo-backend-oferta.md' });
    expect(generated.output.markdown).toContain('# Ada Ejemplo');
    expect(generated.report.match).toBeDefined();
    expect(fs.file('/work/output/cv-ada-ejemplo-backend-oferta.md')?.mode).toBe(0o600);

    const custom = await post('/generate', { template: { workspaceFile: 'plantilla.hbs' }, output: 'propio.md', format: 'md', engine: 'pdfkit', build: true, compact: true });
    expect(((await custom.json()) as { output: { markdown: string } }).output.markdown).toBe('# Ada Ejemplo (plantilla propia)\n');
    expect((await post('/generate', { template: { workspaceFile: '../plantilla.hbs' } })).status).toBe(400);
    expect((await post('/generate', { offer: { workspaceFile: '/etc/passwd' } })).status).toBe(400);
    const fromFile = await post('/generate', { specialty: 'backend', offer: { workspaceFile: 'oferta.txt' }, output: 'fichero.md' });
    expect(fromFile.status).toBe(200);
    expect(((await fromFile.json()) as { report: { match: unknown } }).report.match).toBeDefined();
    const unknown = await post('/generate', { specialty: 'nope' });
    expect(unknown.status).toBe(422);
    const unknownBody = (await unknown.json()) as { error: Record<string, unknown> };
    expect(unknownBody).toMatchObject({ error: { code: 'invalid-data', warnings: [] } });
    expect('report' in unknownBody.error).toBe(false);
    expect((await post('/generate', { format: 'docx' })).status).toBe(400);
    expect((await post('/generate', { output: 'con/barra.md' })).status).toBe(400);

    const pdf = await post('/generate', { specialty: 'backend', format: 'pdf', output: 'cv.pdf' });
    expect(pdf.status).toBe(200);
    const pdfBody = (await pdf.json()) as { output: { kind: string; bytes: number } };
    expect(pdfBody.output.kind).toBe('pdf');
    expect(pdfBody.output.bytes).toBeGreaterThan(1000);

    const list = (await (await api('/output')).json()) as { files: Array<{ name: string; bytes: number }> };
    expect(list.files.map((file) => file.name)).toEqual(['cv-ada-ejemplo-backend-oferta.md', 'cv.pdf', 'fichero.md', 'propio.md']);
    const served = await api('/output/cv.pdf');
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('application/pdf');
    expect((await served.arrayBuffer()).byteLength).toBe(pdfBody.output.bytes);
    expect((await api('/output/propio.md')).headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect((await api('/output/nada.pdf')).status).toBe(404);
    expect((await api('/output/..%2Fcv.pdf')).status).toBe(400);
    await fs.mkdir('/work/output/directorio.pdf');
    expect((await api('/output/directorio.pdf')).status).toBe(503);
    await fs.writeFile('/work/output/datos.json', '{}', 0o600);
    await fs.writeFile('/work/output/crudo.bin', 'x', 0o600);
    expect((await api('/output/datos.json')).headers.get('content-type')).toBe('application/json');
    expect((await api('/output/crudo.bin')).headers.get('content-type')).toBe('application/octet-stream');
  });

  it('analiza ofertas (texto o fichero del espacio de trabajo) y extrae el texto de un PDF', async () => {
    const analysis = await post('/analyze-offer', { offer: { text: 'Buscamos PHP' }, specialty: 'backend' });
    expect(analysis.status).toBe(200);
    expect((await analysis.json()) as object).toMatchObject({ offer: { source: 'oferta' }, summary: { recognized: 1 }, warnings: [] });
    expect((await post('/analyze-offer', { offer: { workspaceFile: '../fuera.txt' } })).status).toBe(400);
    expect((await post('/analyze-offer', {})).status).toBe(400);
    expect((await api('/offers/extract', { method: 'POST', body: new Uint8Array([1, 2, 3]) })).status).toBe(400);
    fs.touch('/work/data/sources/profile.md', 5_000_000_000_000);
    const stale = (await (await post('/analyze-offer', { offer: { text: 'PHP' } })).json()) as { warnings: unknown[] };
    expect(stale.warnings).toEqual([{ kind: 'stale-artifact', newestSource: 'profile.md' }]);
    const failing = await post('/analyze-offer', { offer: { text: 'PHP' }, build: true, specialty: 'nope' });
    expect(failing.status).toBe(422);

    const raw = (body: string, type = 'application/pdf'): Promise<Response> => api('/offers/extract', { method: 'POST', body, headers: { 'Content-Type': type } });
    expect((await raw('%PDF-1.7 …', 'text/plain')).status).toBe(400);
    expect(await (await raw('%PDF-1.7 …')).json()).toEqual({ text: 'Texto extraído' });
    expect((await raw('no')).status).toBe(422);
    expect((await raw('timeout')).status).toBe(503);
  });

  it('temas: inventario y creación (201), con validación del cuerpo y de los errores de la capa', async () => {
    const inventory = (await (await api('/themes')).json()) as { defaultName: string; entries: Array<{ name: string }> };
    expect(inventory.defaultName).toBe('default');
    expect(inventory.entries.map((entry) => entry.name)).toContain('classic');
    const created = await post('/themes', { name: 'mio', from: 'classic' });
    expect(created.status).toBe(201);
    expect((await created.json()) as object).toMatchObject({ name: 'mio', directory: '/work/themes/mio', from: 'classic', shadowed: false });
    expect(fs.file('/work/themes/mio/theme.toml')?.content).toContain('name = "mio"');
    expect((await post('/themes', { name: 'otro' })).status).toBe(201);
    expect((await post('/themes', { name: 'Mal Nombre' })).status).toBe(422);
    expect((await post('/themes', { nombre: 'x' })).status).toBe(400);
  });

  it('con fuentes inválidas, validar y compilar devuelven 422 con los problemas; sin output/, la lista está vacía', async () => {
    const invalid = await startServer({ context: appContext(new MemoryFileSystem({ ...tree(), '/work/data/sources/experience/rota.md': '---\nstart: 2020-13\n---\n', '/work/data/sources/desconocido.txt': 'x' })), host: '127.0.0.1', port: 0, data: 'data/sources', profile: 'data/dist/profile.json', version: '1', apiOnly: true, allowedHosts: [], token: TOKEN });
    const call = (path: string, init: RequestInit = {}): Promise<Response> => fetch(`${invalid.url}api/v1${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
    try {
      const validate = await call('/validate', { method: 'POST', body: '{}' });
      expect(validate.status).toBe(422);
      expect(((await validate.json()) as { error: { issues: unknown[]; lines: string[] } }).error.issues.length).toBeGreaterThan(0);
      expect((await call('/build', { method: 'POST', body: '{}' })).status).toBe(422);
      expect((await call('/sources')).status).toBe(422);
      expect(await (await call('/output')).json()).toEqual({ files: [] });
    } finally {
      await invalid.close();
    }
  });

  it('un fallo al escribir el CV o al leer output/ se responde como 503 con el motivo', async () => {
    const broken = new MemoryFileSystem({ ...tree(), '/work/output': 'no soy un directorio' });
    const instance = await startServer({ context: appContext(broken), host: '127.0.0.1', port: 0, data: 'data/sources', profile: 'data/dist/profile.json', version: '1', apiOnly: true, allowedHosts: [], token: TOKEN });
    const call = (path: string, init: RequestInit = {}): Promise<Response> => fetch(`${instance.url}api/v1${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
    try {
      expect((await call('/build', { method: 'POST', body: '{}' })).status).toBe(200);
      const listing = await call('/output');
      expect(listing.status).toBe(503);
      expect(((await listing.json()) as { error: { message: string } }).error.message).toContain('No se pudo leer /work/output');
      broken.failures.add('writeFile');
      const generated = await call('/generate', { method: 'POST', body: '{}' });
      expect(generated.status).toBe(503);
      expect(((await generated.json()) as { error: { message: string } }).error.message).toContain('No se pudo escribir el CV');
    } finally {
      await instance.close();
    }
  });

  it('un fallo inesperado en un manejador se responde como 503 sin tumbar el servidor', async () => {
    const broken = await startServer({ context: appContext(new MemoryFileSystem(tree()), { typstStatus: () => Promise.reject(new Error('boom')) }), host: '127.0.0.1', port: 0, data: 'data/sources', profile: 'data/dist/profile.json', version: '1', apiOnly: true, allowedHosts: [], token: TOKEN });
    try {
      const response = await fetch(`${broken.url}api/v1/status`, { headers: { Authorization: `Bearer ${TOKEN}` } });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: { code: 'environment', message: 'Error inesperado: boom' } });
      expect((await fetch(broken.url)).status).toBe(404);
    } finally {
      await broken.close();
    }
  });

  it('POST /shutdown detiene el servidor y un puerto ocupado hace fallar el arranque', async () => {
    const other = await startServer({ context: appContext(new MemoryFileSystem(tree())), host: '127.0.0.1', port: 0, data: 'data/sources', profile: 'data/dist/profile.json', version: '1', apiOnly: true, allowedHosts: [], token: TOKEN });
    await expect(startServer({ context: appContext(new MemoryFileSystem(tree())), host: '127.0.0.1', port: other.port, data: 'data/sources', profile: 'data/dist/profile.json', version: '1', apiOnly: true, allowedHosts: [] })).rejects.toThrow(/EADDRINUSE/);
    const shutdown = await fetch(`${other.url}api/v1/shutdown`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(shutdown.status).toBe(202);
    await other.closed;
    await expect(fetch(`${other.url}api/v1/status`)).rejects.toThrow();
  });

  it('anuncia la URL con 127.0.0.1 al escuchar en todas las interfaces y con corchetes en IPv6', () => {
    expect(urlHost('0.0.0.0')).toBe('127.0.0.1');
    expect(urlHost('::')).toBe('127.0.0.1');
    expect(urlHost('::1')).toBe('[::1]');
    expect(urlHost('localhost')).toBe('localhost');
  });
});
