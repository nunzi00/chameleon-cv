import { request as httpRequest } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PdfExtractionResult } from '../../src/pdf';
import { GUI_CSP, GUI_PREFIX, startServer, urlHost, type ServerHandle } from '../../src/serve';
import { MemoryAssets } from '../../src/shared/assets';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';
import type { Fetcher } from '../../src/typst';
import { themeToml } from '../fixtures/theme';
import { buildZip } from '../helpers/archives';

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
    server = await startServer({ context: appContext(fs, { pdfExtractor }), host: '127.0.0.1', port: 0, data: 'data/sources', profile: 'data/dist/profile.json', version: '9.9.9', apiOnly: false, allowRemote: false, allowedHosts: ['mi-host:1'], token: TOKEN });
  });
  afterAll(async () => {
    await server.close();
  });

  it('fuera de /api/v1 no hay más rutas que la interfaz (GET)', async () => {
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
    expect((generated as unknown as { history: unknown[] }).history).toEqual([]);
    const again = (await (await post('/generate', { specialty: 'backend', offer: { text: 'buscamos php y kubernetes' }, topN: 1 })).json()) as { history: { action: string; specialty: string; output: { path: string; format: string } }[] };
    expect(again.history).toHaveLength(1);
    expect(again.history[0]).toMatchObject({ action: 'generate', specialty: 'backend', output: { path: 'output/cv-ada-ejemplo-backend-oferta.md', format: 'md' } });
    const lookup = await post('/offers/history', { offer: { text: 'Buscamos PHP y Kubernetes' } });
    expect(lookup.status).toBe(200);
    expect(((await lookup.json()) as { entries: unknown[] }).entries).toHaveLength(2);
    expect(((await (await post('/offers/history', { offer: { text: 'otra oferta' } })).json()) as { entries: unknown[] }).entries).toEqual([]);
    expect((await post('/offers/history', { offer: { workspaceFile: '/etc/passwd' } })).status).toBe(400);
    expect((await post('/offers/history', { nada: true })).status).toBe(400);
    expect((await post('/offers/history', { offer: { workspaceFile: 'no-existe.txt' } })).status).toBe(503);
    const originalWriteFile = fs.writeFile.bind(fs);
    fs.writeFile = (path, content, mode) => (path.endsWith('historial-ofertas.json') ? Promise.reject(new Error('disco lleno')) : originalWriteFile(path, content, mode));
    const unwritable = (await (await post('/generate', { specialty: 'backend', offer: { text: 'Buscamos PHP y Kubernetes' }, output: 'sin-historial.md' })).json()) as { warnings: { kind: string; message?: string }[] };
    expect(unwritable.warnings).toContainEqual({ kind: 'history-unwritable', message: 'disco lleno' });
    fs.writeFile = originalWriteFile;

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

    // ODT (T-9.23): un documento abierto para seguir editándolo; se sirve con su tipo, no como binario suelto.
    const odt = await post('/generate', { specialty: 'backend', format: 'odt', output: 'cv.odt' });
    expect(odt.status).toBe(200);
    const odtBody = (await odt.json()) as { output: { kind: string; bytes: number } };
    expect(odtBody.output.kind).toBe('odt');
    expect(odtBody.output.bytes).toBeGreaterThan(500);
    const servedOdt = await api('/output/cv.odt');
    expect(servedOdt.headers.get('content-type')).toBe('application/vnd.oasis.opendocument.text');
    expect(Buffer.from(await servedOdt.arrayBuffer()).subarray(30, 38).toString('latin1')).toBe('mimetype');

    const list = (await (await api('/output')).json()) as { files: Array<{ name: string; bytes: number }> };
    expect(list.files.map((file) => file.name)).toEqual(['cv-ada-ejemplo-backend-oferta.md', 'cv.odt', 'cv.pdf', 'fichero.md', 'historial-ofertas.json', 'propio.md', 'sin-historial.md']);
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
    const invalid = await startServer({ context: appContext(new MemoryFileSystem({ ...tree(), '/work/data/sources/experience/rota.md': '---\nstart: 2020-13\n---\n', '/work/data/sources/desconocido.txt': 'x' })), host: '127.0.0.1', port: 0, data: 'data/sources', profile: 'data/dist/profile.json', version: '1', apiOnly: true, allowRemote: false, allowedHosts: [], token: TOKEN });
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
    const instance = await startServer({ context: appContext(broken), host: '127.0.0.1', port: 0, data: 'data/sources', profile: 'data/dist/profile.json', version: '1', apiOnly: true, allowRemote: false, allowedHosts: [], token: TOKEN });
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
    const broken = await startServer({ context: appContext(new MemoryFileSystem(tree()), { typstStatus: () => Promise.reject(new Error('boom')) }), host: '127.0.0.1', port: 0, data: 'data/sources', profile: 'data/dist/profile.json', version: '1', apiOnly: true, allowRemote: false, allowedHosts: [], token: TOKEN });
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
    const other = await startServer({ context: appContext(new MemoryFileSystem(tree())), host: '127.0.0.1', port: 0, data: 'data/sources', profile: 'data/dist/profile.json', version: '1', apiOnly: true, allowRemote: false, allowedHosts: [], token: TOKEN });
    await expect(startServer({ context: appContext(new MemoryFileSystem(tree())), host: '127.0.0.1', port: other.port, data: 'data/sources', profile: 'data/dist/profile.json', version: '1', apiOnly: true, allowRemote: false, allowedHosts: [] })).rejects.toThrow(/EADDRINUSE/);
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

describe('cv serve: la interfaz web desde el almacén de assets (lista cerrada, CSP, caché)', () => {
  const assets = new MemoryAssets({
    [`${GUI_PREFIX}/index.html`]: '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>GUI</title><script type="module" src="/assets/index-abc123.js"></script></head><body></body></html>',
    [`${GUI_PREFIX}/assets/index-abc123.js`]: 'console.log("gui")',
    [`${GUI_PREFIX}/assets/index-abc123.css`]: 'body{margin:0}',
    [`${GUI_PREFIX}/favicon.svg`]: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'package.json': '{"version":"9.9.9"}',
  });
  let server: ServerHandle;
  let apiOnly: ServerHandle;
  beforeAll(async () => {
    const fs = new MemoryFileSystem(tree());
    server = await startServer({ context: appContext(fs, { assets }), host: '127.0.0.1', port: 0, data: 'data/sources', profile: 'data/dist/profile.json', version: '9.9.9', apiOnly: false, allowRemote: false, allowedHosts: [], token: TOKEN });
    apiOnly = await startServer({ context: appContext(fs, { assets }), host: '127.0.0.1', port: 0, data: 'data/sources', profile: 'data/dist/profile.json', version: '9.9.9', apiOnly: true, allowRemote: false, allowedHosts: [], token: TOKEN });
  });
  afterAll(async () => {
    await server.close();
    await apiOnly.close();
  });

  it('sirve index.html en / con la CSP estricta, sin caché y sin token', async () => {
    const page = await fetch(server.url);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(page.headers.get('content-security-policy')).toBe(GUI_CSP);
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    expect(await page.text()).toContain('index-abc123.js');
  });

  it('sirve los ficheros con hash como inmutables y el resto por su ruta exacta; nada fuera de la lista', async () => {
    const script = await fetch(`${server.url}assets/index-abc123.js`);
    expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(script.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(script.headers.get('content-security-policy')).not.toBe(GUI_CSP);
    expect(await script.text()).toBe('console.log("gui")');
    expect((await fetch(`${server.url}assets/index-abc123.css`)).headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect((await fetch(`${server.url}favicon.svg`)).status).toBe(200);
    expect((await fetch(`${server.url}index.html`)).status).toBe(404);
    expect((await fetch(`${server.url}assets/otro.js`)).status).toBe(404);
    expect((await fetch(`${server.url}assets/..%2F..%2Fpackage.json`)).status).toBe(404);
    expect((await fetch(server.url, { method: 'POST' })).status).toBe(404);
    const head = await fetch(server.url, { method: 'HEAD' });
    expect(head.status).toBe(200);
  });

  it('sin gui/dist en el almacén sirve la página mínima en / (desarrollo sin construir la GUI)', async () => {
    const noGui = await startServer({ context: appContext(new MemoryFileSystem(tree()), { assets: new MemoryAssets({ 'package.json': '{"version":"9.9.9"}' }) }), host: '127.0.0.1', port: 0, data: 'data/sources', profile: 'data/dist/profile.json', version: '9.9.9', apiOnly: false, allowRemote: false, allowedHosts: [], token: TOKEN });
    try {
      const page = await fetch(noGui.url);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(await page.text()).toContain('Chameleon CV 9.9.9');
      expect((await fetch(`${noGui.url}assets/index-abc123.js`)).status).toBe(404);
    } finally {
      await noGui.close();
    }
  });

  it('con --api-only no sirve la interfaz', async () => {
    expect((await fetch(apiOnly.url)).status).toBe(404);
    expect((await fetch(`${apiOnly.url}assets/index-abc123.js`)).status).toBe(404);
  });
});

describe('cv serve: instalar y verificar temas de la comunidad (T-8.3)', () => {
  const ZIP = buildZip([
    { path: 'comunidad/' },
    { path: 'comunidad/theme.toml', data: themeToml('comunidad') },
    { path: 'comunidad/template.typ', data: '#let cv(d, theme) = d.fullName\n' },
  ]);
  const NOW = new Date('2026-08-30T10:00:00.000Z');
  let fs: MemoryFileSystem;
  let local: ServerHandle;
  let remote: ServerHandle;
  const calls: string[] = [];
  async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
    yield bytes;
  }
  const fetcher: Fetcher = (url) => {
    calls.push(url);
    return Promise.resolve({ ok: true, status: 200, url: 'https://cdn.example/comunidad.zip', body: once(ZIP), contentLength: ZIP.length });
  };
  const call = (server: ServerHandle, path: string, body?: unknown): Promise<Response> =>
    fetch(`${server.url}api/v1${path}`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

  beforeAll(async () => {
    fs = new MemoryFileSystem({ ...tree(), '/work/themes/comunidad.zip': { kind: 'file', content: '', bytes: ZIP } });
    const options = { host: '127.0.0.1', port: 0, data: 'data/sources', profile: 'data/dist/profile.json', version: '9.9.9', apiOnly: true, allowedHosts: [], token: TOKEN } as const;
    local = await startServer({ ...options, context: appContext(fs, { now: () => NOW, fetcher }), allowRemote: false });
    remote = await startServer({ ...options, context: appContext(fs, { now: () => NOW, fetcher }), allowRemote: true });
  });
  afterAll(async () => {
    await local.close();
    await remote.close();
  });

  it('instala desde un archivo del espacio de trabajo: dryRun (200, nada escrito), instalación (201) y verify (200); errores 422, 404 y 400', async () => {
    const dry = await call(local, '/themes/install', { source: 'themes/comunidad.zip', dryRun: true });
    expect(dry.status).toBe(200);
    expect((await dry.json()) as object).toMatchObject({ written: false, plan: { name: 'comunidad', directory: '/work/themes/comunidad', kind: 'archive' } });
    expect(fs.file('/work/themes/comunidad/theme.toml')).toBeUndefined();
    const installed = await call(local, '/themes/install', { source: 'themes/comunidad.zip', name: 'comunidad' });
    expect(installed.status).toBe(201);
    expect((await installed.json()) as object).toMatchObject({ written: true, plan: { name: 'comunidad', files: [{ path: 'template.typ' }, { path: 'theme.toml' }] } });
    expect(fs.file('/work/themes/comunidad/.origin.json')?.content).toContain('"tool": "chameleon-cv 9.9.9"');
    const verified = await call(local, '/themes/comunidad/verify');
    expect(verified.status).toBe(200);
    expect((await verified.json()) as object).toMatchObject({ name: 'comunidad', directory: '/work/themes/comunidad', report: { state: 'intact', origin: { installedAt: '2026-08-30T10:00:00.000Z' } } });
    expect((await call(local, '/themes/install', { source: 'themes/comunidad.zip' })).status).toBe(409);
    expect((await call(local, '/themes/install', { source: 'themes/nada.zip' })).status).toBe(404);
    expect((await call(local, '/themes/install', { source: 'http://cdn.example/t.zip' })).status).toBe(422);
    expect((await call(local, '/themes/install', { fuente: 'x' })).status).toBe(400);
    expect((await call(local, '/themes/classic/verify')).status).toBe(422);
    expect((await call(local, '/themes/nada/verify')).status).toBe(404);
  });

  it('desde una URL: 403 sin --allow-remote; con él, 409 consent-required con estimateId, host y límite, y la repetición con el id descarga e instala', async () => {
    const forbidden = await call(local, '/themes/install', { source: 'https://cdn.example/descargas/comunidad.zip' });
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()) as object).toMatchObject({ error: { code: 'remote-disabled' } });
    expect(calls).toEqual([]);
    const pending = await call(remote, '/themes/install', { source: 'https://cdn.example/descargas/comunidad.zip', name: 'remota' });
    expect(pending.status).toBe(409);
    const body = (await pending.json()) as { error: { code: string; estimateId: string; source: string; host: string; limitBytes: number } };
    expect(body.error).toMatchObject({ code: 'consent-required', source: 'https://cdn.example/descargas/comunidad.zip', host: 'cdn.example', limitBytes: 8 * 1024 * 1024 });
    expect(calls).toEqual([]);
    const wrongId = await call(remote, '/themes/install', { source: 'https://cdn.example/descargas/comunidad.zip', name: 'remota', consent: { estimateId: 'otro' } });
    expect(wrongId.status).toBe(409);
    const installed = await call(remote, '/themes/install', { source: 'https://cdn.example/descargas/comunidad.zip', name: 'remota', consent: { estimateId: body.error.estimateId } });
    expect(installed.status).toBe(201);
    expect((await installed.json()) as object).toMatchObject({ written: true, plan: { name: 'remota', kind: 'url', source: 'https://cdn.example/comunidad.zip' } });
    expect(calls).toEqual(['https://cdn.example/descargas/comunidad.zip']);
    expect(fs.file('/work/themes/remota/.origin.json')?.content).toContain('"source": "https://cdn.example/comunidad.zip"');
  });
});
