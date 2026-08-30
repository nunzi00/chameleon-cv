/**
 * Instalación y verificación de temas (T-8.3, docs/theme-gallery.md §4.2, §4.3 y §5): orígenes (URL con doble de
 * descarga, archivo y directorio locales), política y validación, nombre resultante, huellas y `.origin.json`,
 * escritura atómica, `--replace` con copia, `--dry-run`, `verify` en sus tres estados y el origen en el inventario.
 */
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { THEME_DOWNLOAD_LIMITS, classifyInstallSource, installTheme, themeInventory, verifyThemes, type InstallThemeRequest } from '../../src/app/themes';
import type { FileSystem } from '../../src/parsers';
import { ARCHIVE_LIMITS, BUILTIN_THEMES_DIRECTORY, ORIGIN_FILE, canonicalDigest, parseOrigin, sha256Hex } from '../../src/themes';
import type { FetchedResponse, Fetcher } from '../../src/typst';
import { themeToml } from '../fixtures/theme';
import { appContext } from '../helpers/app-context';
import { buildTarGz, buildZip } from '../helpers/archives';
import { MemoryFileSystem, type MemoryEntry } from '../helpers/memory-file-system';

const TYP = '#let cv(d, theme) = d.fullName\n';
const NOW = new Date('2026-08-30T10:00:00.000Z');
const TOML = themeToml('comunidad');

const ZIP = buildZip([
  { path: 'comunidad/' },
  { path: 'comunidad/theme.toml', data: TOML },
  { path: 'comunidad/template.typ', data: TYP },
  { path: 'comunidad/fonts/' },
  { path: 'comunidad/fonts/libre-1.ttf', data: new Uint8Array([1, 2, 3]) },
]);
const TARGZ = buildTarGz([{ path: 'comunidad/theme.toml', data: TOML }, { path: 'comunidad/template.typ', data: TYP }], { deterministic: false });

function binary(bytes: Uint8Array): MemoryEntry {
  return { kind: 'file', content: '', bytes };
}

function setup(tree: Record<string, string | MemoryEntry> = {}, overrides: Parameters<typeof appContext>[1] = {}) {
  const fs = new MemoryFileSystem({ '/work/themes/comunidad.zip': binary(ZIP), '/work/themes/comunidad-v2.tar.gz': binary(TARGZ), ...tree });
  return { fs, context: appContext(fs, { now: () => NOW, ...overrides }) };
}

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

function respond(bytes: Uint8Array, overrides: Partial<FetchedResponse> = {}): Fetcher {
  return () => Promise.resolve({ ok: true, status: 200, url: 'https://cdn.example/comunidad.zip', body: once(bytes), contentLength: bytes.length, ...overrides });
}

async function installed(request: InstallThemeRequest, tree: Record<string, string | MemoryEntry> = {}, overrides: Parameters<typeof appContext>[1] = {}) {
  const { fs, context } = setup(tree, overrides);
  const result = await installTheme(context, request, { toolVersion: '1.5.0', tempSuffix: 'tmp' });
  return { fs, context, result };
}

describe('classifyInstallSource', () => {
  it('distingue URL https, ruta local y orígenes rechazados', () => {
    expect(classifyInstallSource('/work', 'https://cdn.example/t.zip')).toMatchObject({ ok: true, source: { kind: 'url', url: expect.objectContaining({ host: 'cdn.example' }) } });
    expect(classifyInstallSource('/work', 'themes/t.zip')).toEqual({ ok: true, source: { kind: 'local', path: '/work/themes/t.zip' } });
    expect(classifyInstallSource('/work', '/abs/t.zip')).toEqual({ ok: true, source: { kind: 'local', path: '/abs/t.zip' } });
    expect(classifyInstallSource('/work', 'http://cdn.example/t.zip')).toMatchObject({ ok: false, error: { exitCode: 1, message: 'Origen no admitido «http://cdn.example/t.zip»: solo URL https:// o rutas locales (nada de http://)' } });
    expect(classifyInstallSource('/work', 'FTP://x/t.zip')).toMatchObject({ ok: false, error: { message: expect.stringContaining('nada de ftp://') } });
    expect(classifyInstallSource('/work', 'https://')).toMatchObject({ ok: false, error: { message: 'URL inválida «https://»' } });
  });

  it('installTheme devuelve el mismo error sin tocar nada', async () => {
    const { fs, context } = setup();
    expect(await installTheme(context, { source: 'http://cdn.example/t.zip' })).toMatchObject({ ok: false, error: { exitCode: 1, message: expect.stringContaining('Origen no admitido') } });
    expect(fs.log).toEqual([]);
  });
});

describe('installTheme desde un archivo local', () => {
  it('lee el zip, valida, fija origen y huellas y escribe de forma atómica: temporal, ficheros 0644, renombrado y nada a medias', async () => {
    const { fs, result } = await installed({ source: 'themes/comunidad.zip' });
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    const { plan, written, backup } = result.installed;
    expect(written).toBe(true);
    expect(backup).toBeUndefined();
    expect(plan).toMatchObject({
      name: 'comunidad',
      directory: '/work/themes/comunidad',
      kind: 'archive',
      source: '/work/themes/comunidad.zip',
      archiveSha256: sha256Hex(ZIP),
      totalBytes: 3 + TYP.length + TOML.length,
      replaces: undefined,
      shadowed: false,
    });
    expect(plan.files.map((file) => [file.path, file.bytes])).toEqual([
      ['fonts/libre-1.ttf', 3],
      ['template.typ', TYP.length],
      ['theme.toml', TOML.length],
    ]);
    expect(plan.config.theme.name).toBe('comunidad');
    expect(fs.file('/work/themes/comunidad/theme.toml')).toMatchObject({ mode: 0o644 });
    expect(fs.file('/work/themes/comunidad/template.typ')?.content).toBe(TYP);
    expect([...(fs.file('/work/themes/comunidad/fonts/libre-1.ttf')?.bytes ?? [])]).toEqual([1, 2, 3]);
    const origin = parseOrigin(fs.file(`/work/themes/comunidad/${ORIGIN_FILE}`)?.content ?? '');
    expect(origin).toEqual({
      ok: true,
      origin: {
        source: '/work/themes/comunidad.zip',
        kind: 'archive',
        archiveSha256: sha256Hex(ZIP),
        files: { 'fonts/libre-1.ttf': sha256Hex(new Uint8Array([1, 2, 3])), 'template.typ': sha256Hex(Buffer.from(TYP)), 'theme.toml': sha256Hex(Buffer.from(TOML)) },
        installedAt: '2026-08-30T10:00:00.000Z',
        tool: 'chameleon-cv 1.5.0',
      },
    });
    expect(fs.log).toContain('mkdir /work/themes/.install-comunidad-tmp');
    expect(fs.log).toContain('rename /work/themes/.install-comunidad-tmp');
    expect(fs.file('/work/themes/.install-comunidad-tmp/theme.toml')).toBeUndefined();
  });

  it('--dry-run hace todo menos escribir; un tar.gz vale igual y sin fuentes no crea fonts/', async () => {
    const dry = await installed({ source: 'themes/comunidad.zip', dryRun: true });
    expect(dry.result).toMatchObject({ ok: true, installed: { written: false, backup: undefined, plan: { name: 'comunidad', archiveSha256: sha256Hex(ZIP) } } });
    expect(dry.fs.file('/work/themes/comunidad/theme.toml')).toBeUndefined();
    expect(dry.fs.log.some((line) => line.startsWith('mkdir'))).toBe(false);
    const tar = await installed({ source: 'themes/comunidad-v2.tar.gz' });
    expect(tar.result).toMatchObject({ ok: true, installed: { written: true, plan: { kind: 'archive', archiveSha256: sha256Hex(TARGZ), files: [{ path: 'template.typ' }, { path: 'theme.toml' }] } } });
    expect(tar.fs.log).not.toContain('mkdir /work/themes/.install-comunidad-tmp/fonts');
  });

  it('el nombre sale de --as (reescribiendo theme.toml), de theme.name o del directorio raíz; sin ninguno, pide --as', async () => {
    const renamed = await installed({ source: 'themes/comunidad.zip', as: 'otra' });
    expect(renamed.result).toMatchObject({ ok: true, installed: { plan: { name: 'otra', directory: '/work/themes/otra', config: { theme: { name: 'otra' } } } } });
    expect(renamed.fs.file('/work/themes/otra/theme.toml')?.content).toContain('name = "otra"');
    const anonymous = TOML.replace('name = "comunidad"\n', '');
    const flat = buildZip([{ path: 'theme.toml', data: anonymous }, { path: 'template.typ', data: TYP }]);
    const nameless = await installed({ source: 'themes/flat.zip' }, { '/work/themes/flat.zip': binary(flat) });
    expect(nameless.result).toMatchObject({ ok: false, error: { exitCode: 1, message: 'No se puede determinar el nombre del tema: theme.toml no lleva name y el archivo no tiene directorio raíz; indícalo con --as <nombre>' } });
    const byAs = await installed({ source: 'themes/flat.zip', as: 'plano' }, { '/work/themes/flat.zip': binary(flat) });
    expect(byAs.result).toMatchObject({ ok: true, installed: { plan: { name: 'plano' } } });
    const rooted = buildZip([{ path: 'raiz/theme.toml', data: anonymous }, { path: 'raiz/template.typ', data: TYP }]);
    const byRoot = await installed({ source: 'themes/rooted.zip' }, { '/work/themes/rooted.zip': binary(rooted) });
    expect(byRoot.result).toMatchObject({ ok: true, installed: { plan: { name: 'raiz' } } });
    expect(await installed({ source: 'themes/comunidad.zip', as: 'Mal' })).toMatchObject({ result: { ok: false, error: { message: 'Nombre de tema inválido «Mal»: minúsculas, dígitos y guiones (p. ej. «mio»)' } } });
    const compact = buildZip([{ path: 'theme.toml', data: TOML.replace('name = "comunidad"', 'name="comunidad"') }, { path: 'template.typ', data: TYP }]);
    const stubborn = await installed({ source: 'themes/compact.zip', as: 'otra' }, { '/work/themes/compact.zip': binary(compact) });
    expect(stubborn.result).toMatchObject({ ok: false, error: { message: 'theme.toml declara name = "comunidad" y no se ha podido reescribir como «otra»; edítalo o instala sin --as' } });
  });

  it('exige theme.toml válido y template.typ, y explica los archivos que no son temas', async () => {
    const noToml = buildZip([{ path: 'comunidad/template.typ', data: TYP }]);
    expect((await installed({ source: 'themes/x.zip' }, { '/work/themes/x.zip': binary(noToml) })).result).toMatchObject({ ok: false, error: { message: 'El origen «/work/themes/x.zip» no contiene theme.toml' } });
    const noTemplate = buildZip([{ path: 'comunidad/theme.toml', data: TOML }]);
    expect((await installed({ source: 'themes/x.zip' }, { '/work/themes/x.zip': binary(noTemplate) })).result).toMatchObject({ ok: false, error: { message: 'El origen «/work/themes/x.zip» no contiene template.typ' } });
    const bad = buildZip([{ path: 'comunidad/theme.toml', data: TOML.replace('accent = "#444444"', 'accent = "verde"') }, { path: 'comunidad/template.typ', data: TYP }]);
    expect((await installed({ source: 'themes/x.zip' }, { '/work/themes/x.zip': binary(bad) })).result).toMatchObject({
      ok: false,
      error: { message: 'theme.toml del origen «/work/themes/x.zip» inválido', lines: ['theme.toml del origen «/work/themes/x.zip» inválido:', '  - colors.accent: Color inválido: usa #rrggbb (p. ej. "#1f4e79")'] },
    });
    const escape = buildZip([{ path: '../fuera', data: 'x' }]);
    expect((await installed({ source: 'themes/x.zip' }, { '/work/themes/x.zip': binary(escape) })).result).toMatchObject({
      ok: false,
      error: { message: 'El archivo «/work/themes/x.zip» no es un tema instalable: La entrada «../fuera» sale del tema («..»): no se admite' },
    });
  });

  it('nunca sobrescribe: sin --replace es un conflicto; con --replace aparta el anterior a una copia .bak con marca de tiempo', async () => {
    const existing = { '/work/themes/comunidad/theme.toml': themeToml('comunidad'), '/work/themes/comunidad/template.typ': '#let cv(d, theme) = [viejo]' };
    const conflict = await installed({ source: 'themes/comunidad.zip' }, existing);
    expect(conflict.result).toMatchObject({
      ok: false,
      error: { code: 'conflict', exitCode: 1, message: 'Ya existe /work/themes/comunidad: usa --replace para apartarlo a /work/themes/comunidad.<marca>.bak/ o --as <otro-nombre> (nunca se sobrescribe un tema)' },
    });
    const replaced = await installed({ source: 'themes/comunidad.zip', replace: true }, existing);
    if (!replaced.result.ok) {
      throw new Error(replaced.result.error.message);
    }
    const backup = replaced.result.installed.backup ?? '';
    expect(backup).toMatch(/^\/work\/themes\/comunidad\.\d{8}-\d{6}\.bak$/);
    expect(replaced.result.installed.plan.replaces).toBe('/work/themes/comunidad');
    expect(replaced.fs.file(`${backup}/template.typ`)?.content).toBe('#let cv(d, theme) = [viejo]');
    expect(replaced.fs.file('/work/themes/comunidad/template.typ')?.content).toBe(TYP);
    const dry = await installed({ source: 'themes/comunidad.zip', dryRun: true }, existing);
    expect(dry.result).toMatchObject({ ok: true, installed: { written: false, plan: { replaces: '/work/themes/comunidad' } } });
  });

  it('--sha256 contrasta la huella del archivo (en cualquier caja); una huella mal formada o distinta no instala nada', async () => {
    const ok = await installed({ source: 'themes/comunidad.zip', sha256: sha256Hex(ZIP).toUpperCase() });
    expect(ok.result).toMatchObject({ ok: true, installed: { written: true } });
    const wrong = await installed({ source: 'themes/comunidad.zip', sha256: '0'.repeat(64) });
    expect(wrong.result).toMatchObject({ ok: false, error: { exitCode: 1, message: `La huella del archivo no coincide: esperada ${'0'.repeat(64)}, obtenida ${sha256Hex(ZIP)}; no se ha instalado nada` } });
    expect(wrong.fs.file('/work/themes/comunidad/theme.toml')).toBeUndefined();
    const malformed = await installed({ source: 'themes/comunidad.zip', sha256: 'abc' });
    expect(malformed.result).toMatchObject({ ok: false, error: { message: 'Huella inválida «abc»: se espera un SHA-256 en hexadecimal (64 caracteres)' } });
  });

  it('avisa cuando el nombre oculta a un distribuido y, si la escritura falla, limpia el temporal y no deja nada', async () => {
    const shadow = await installed({ source: 'themes/comunidad.zip', as: 'default' });
    expect(shadow.result).toMatchObject({ ok: true, installed: { plan: { shadowed: true } } });
    const { fs, context } = setup();
    fs.failures.add('rename');
    const failed = await installTheme(context, { source: 'themes/comunidad.zip' }, { tempSuffix: 'tmp' });
    expect(failed).toMatchObject({ ok: false, error: { code: 'environment', message: 'No se pudo instalar el tema en /work/themes/comunidad: fallo simulado en rename' } });
    expect(fs.log).toContain('remove /work/themes/.install-comunidad-tmp');
    expect(fs.file('/work/themes/comunidad/theme.toml')).toBeUndefined();
    fs.failures.add('remove');
    const stuck = await installTheme(context, { source: 'themes/comunidad.zip' });
    expect(stuck).toMatchObject({ ok: false, error: { message: expect.stringContaining('fallo simulado en rename') } });
    // Sin reloj inyectado ni versión: fecha real y «dev».
    const plainFs = new MemoryFileSystem({ '/work/themes/comunidad.zip': binary(ZIP) });
    expect(await installTheme(appContext(plainFs), { source: 'themes/comunidad.zip' })).toMatchObject({ ok: true });
    const plainOrigin = parseOrigin(plainFs.file(`/work/themes/comunidad/${ORIGIN_FILE}`)?.content ?? '');
    expect(plainOrigin).toMatchObject({ ok: true, origin: { tool: 'chameleon-cv dev', installedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) } });
  });

  it('explica el origen local que no existe, que no es archivo ni directorio, que pesa demasiado o que no se puede leer', async () => {
    expect((await installed({ source: 'nada.zip' })).result).toMatchObject({ ok: false, error: { code: 'not-found', exitCode: 2, message: 'No existe «/work/nada.zip»' } });
    expect((await installed({ source: 'raro' }, { '/work/raro': { kind: 'other' } })).result).toMatchObject({ ok: false, error: { message: '«/work/raro» no es un archivo ni un directorio' } });
    const huge = { kind: 'file', content: '', bytes: new Uint8Array(THEME_DOWNLOAD_LIMITS.maxBytes + 1) } as const;
    expect((await installed({ source: 'grande.zip' }, { '/work/grande.zip': huge })).result).toMatchObject({
      ok: false,
      error: { message: `«/work/grande.zip» pesa ${THEME_DOWNLOAD_LIMITS.maxBytes + 1} bytes; el máximo admitido es ${THEME_DOWNLOAD_LIMITS.maxBytes}` },
    });
    const { fs } = setup();
    const failing: FileSystem = {
      readDirectory: (path) => fs.readDirectory(path),
      stat: (path) => fs.stat(path),
      realPath: (path) => fs.realPath(path),
      readTextFile: (path) => fs.readTextFile(path),
      readBinaryFile: () => Promise.reject(new Error('EIO')),
    };
    const unreadable = await installTheme(appContext(fs, { datasetFileSystem: failing }), { source: 'themes/comunidad.zip' });
    expect(unreadable).toMatchObject({ ok: false, error: { code: 'environment', message: 'No se pudo leer «/work/themes/comunidad.zip»: EIO' } });
  });
});

describe('installTheme desde un directorio local', () => {
  const SOURCE = {
    '/work/src/theme.toml': TOML,
    '/work/src/template.typ': TYP,
    '/work/src/README.md': '# Tema',
    '/work/src/fonts/libre-1.ttf': binary(new Uint8Array([1, 2, 3])),
    [`/work/src/${ORIGIN_FILE}`]: '{"no": "cuenta"}',
  };

  it('aplica la misma política, ignora .origin.json y usa la huella canónica del contenido', async () => {
    const { result } = await installed({ source: 'src' }, SOURCE);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    const files = result.installed.plan.files.map((file) => file.path);
    expect(files).toEqual(['README.md', 'fonts/libre-1.ttf', 'template.typ', 'theme.toml']);
    expect(result.installed.plan).toMatchObject({ kind: 'directory', source: '/work/src', name: 'comunidad' });
    expect(result.installed.plan.archiveSha256).toBe(
      canonicalDigest([
        { path: 'README.md', bytes: Buffer.from('# Tema') },
        { path: 'fonts/libre-1.ttf', bytes: new Uint8Array([1, 2, 3]) },
        { path: 'template.typ', bytes: Buffer.from(TYP) },
        { path: 'theme.toml', bytes: Buffer.from(TOML) },
      ]),
    );
    const nested = await installed({ source: 'ext' }, { '/work/ext/comunidad/theme.toml': TOML, '/work/ext/comunidad/template.typ': TYP, '/work/ext/comunidad/fonts/a-1.otf': 'x' });
    expect(nested.result).toMatchObject({ ok: true, installed: { plan: { name: 'comunidad', files: [{ path: 'fonts/a-1.otf' }, { path: 'template.typ' }, { path: 'theme.toml' }] } } });
  });

  it('rechaza directorios más profundos, enlaces, entradas raras y ficheros por encima del límite', async () => {
    const deep = await installed({ source: 'src' }, { ...SOURCE, '/work/src/fonts/sub/a-1.ttf': 'x', '/work/src/fonts/sub/deeper/b-1.ttf': 'x' });
    expect(deep.result).toMatchObject({ ok: false, error: { message: 'El directorio «/work/src» no es un tema instalable: El directorio «fonts/sub» no se admite: solo theme.toml, template.typ, README.md, LICENSE y fonts/<nombre>.ttf|otf (nombres en minúsculas, dígitos y guiones)' } });
    const link = await installed({ source: 'src' }, { ...SOURCE, '/work/src/LICENSE': { kind: 'symlink', target: 'README.md' } });
    expect(link.result).toMatchObject({ ok: false, error: { message: expect.stringContaining('La entrada «LICENSE» es un enlace') } });
    const odd = await installed({ source: 'src' }, { ...SOURCE, '/work/src/LICENSE': { kind: 'other' } });
    expect(odd.result).toMatchObject({ ok: false, error: { message: expect.stringContaining('La entrada «LICENSE» no es un fichero ni un directorio') } });
    const big = await installed({ source: 'src' }, { ...SOURCE, '/work/src/fonts/grande.ttf': binary(new Uint8Array(ARCHIVE_LIMITS.maxFontBytes + 1)) });
    expect(big.result).toMatchObject({ ok: false, error: { message: expect.stringContaining(`La entrada «fonts/grande.ttf» pesa ${ARCHIVE_LIMITS.maxFontBytes + 1} bytes; el máximo es ${ARCHIVE_LIMITS.maxFontBytes}`) } });
    const tooBigForRoot = await installed({ source: 'src' }, { ...SOURCE, '/work/src/README.md': binary(new Uint8Array(ARCHIVE_LIMITS.maxFileBytes + 1)) });
    expect(tooBigForRoot.result).toMatchObject({ ok: false, error: { message: expect.stringContaining(`La entrada «README.md» pesa ${ARCHIVE_LIMITS.maxFileBytes + 1} bytes; el máximo es ${ARCHIVE_LIMITS.maxFileBytes}`) } });
    const { fs } = setup(SOURCE);
    const failing: FileSystem = {
      readDirectory: (path) => (path === '/work/src/fonts' ? Promise.reject(new Error('EIO')) : fs.readDirectory(path)),
      stat: (path) => fs.stat(path),
      realPath: (path) => fs.realPath(path),
      readTextFile: (path) => fs.readTextFile(path),
      readBinaryFile: (path) => fs.readBinaryFile(path),
    };
    expect(await installTheme(appContext(fs, { datasetFileSystem: failing }), { source: 'src' })).toMatchObject({ ok: false, error: { message: 'El directorio «/work/src» no es un tema instalable: EIO' } });
  });
});

describe('installTheme desde una URL https', () => {
  it('descarga con el doble inyectado (el de las opciones prevalece sobre el del contexto), fija la URL final como origen y traduce los fallos', async () => {
    const calls: string[] = [];
    const fromContext: Fetcher = (url) => {
      calls.push(`contexto ${url}`);
      return respond(ZIP)(url);
    };
    const viaContext = await installed({ source: 'https://cdn.example/descargas/comunidad.zip' }, {}, { fetcher: fromContext });
    expect(viaContext.result).toMatchObject({ ok: true, installed: { plan: { kind: 'url', source: 'https://cdn.example/comunidad.zip', archiveSha256: sha256Hex(ZIP), name: 'comunidad' } } });
    expect(calls).toEqual(['contexto https://cdn.example/descargas/comunidad.zip']);
    const origin = parseOrigin(viaContext.fs.file(`/work/themes/comunidad/${ORIGIN_FILE}`)?.content ?? '');
    expect(origin).toMatchObject({ ok: true, origin: { kind: 'url', source: 'https://cdn.example/comunidad.zip' } });
    const { context } = setup({}, { fetcher: fromContext });
    const viaOptions = await installTheme(context, { source: 'https://cdn.example/x.zip', dryRun: true }, { fetcher: respond(ZIP) });
    expect(viaOptions).toMatchObject({ ok: true });
    expect(calls).toHaveLength(1);
    const insecure = await installTheme(context, { source: 'https://cdn.example/x.zip' }, { fetcher: respond(ZIP, { url: 'http://cdn.example/x.zip' }) });
    expect(insecure).toMatchObject({ ok: false, error: { code: 'environment', exitCode: 2, message: 'La descarga acabó en una URL no segura: «http://cdn.example/x.zip»' } });
    const offline = await installTheme(context, { source: 'https://cdn.example/x.zip' }, { fetcher: () => Promise.reject(new TypeError('fetch failed')) });
    expect(offline).toMatchObject({ ok: false, error: { message: 'No se pudo descargar «https://cdn.example/x.zip»: fetch failed' } });
    const tooBig = await installTheme(context, { source: 'https://cdn.example/x.zip' }, { fetcher: respond(ZIP, { contentLength: THEME_DOWNLOAD_LIMITS.maxBytes + 1 }) });
    expect(tooBig).toMatchObject({ ok: false, error: { message: `El fichero anuncia ${THEME_DOWNLOAD_LIMITS.maxBytes + 1} bytes; el máximo admitido es ${THEME_DOWNLOAD_LIMITS.maxBytes}` } });
    const notArchive = await installTheme(context, { source: 'https://cdn.example/x.zip' }, { fetcher: respond(Buffer.from('<html>')) });
    expect(notArchive).toMatchObject({ ok: false, error: { message: 'El archivo «https://cdn.example/comunidad.zip» no es un tema instalable: El fichero no es un archivo zip ni tar.gz (firma desconocida)' } });
  });
});

describe('verifyThemes y el origen en el inventario', () => {
  const MIO = { '/work/themes/mio/theme.toml': themeToml('mio'), '/work/themes/mio/template.typ': TYP };

  it('verifica uno o todos los temas del proyecto: intacto, sin origen y modificado; los distribuidos y los inexistentes se explican', async () => {
    const { fs, context } = await installed({ source: 'themes/comunidad.zip' }, MIO);
    const all = await verifyThemes(context);
    expect(all).toMatchObject({ ok: true, failed: false, verifications: [{ name: 'comunidad', directory: '/work/themes/comunidad', report: { state: 'intact' } }, { name: 'mio', report: { state: 'none' } }] });
    await fs.writeFile('/work/themes/comunidad/template.typ', '#let cv(d, theme) = [cambiado]', 0o644);
    const one = await verifyThemes(context, 'comunidad');
    expect(one).toMatchObject({ ok: true, failed: true, verifications: [{ name: 'comunidad', report: { state: 'modified', files: [{ path: 'fonts/libre-1.ttf', state: 'ok' }, { path: 'template.typ', state: 'modified' }, { path: 'theme.toml', state: 'ok' }] } }] });
    expect(await verifyThemes(context, 'Mal')).toMatchObject({ ok: false, error: { message: 'Nombre de tema inválido «Mal»: minúsculas, dígitos y guiones (p. ej. «mio»)' } });
    expect(await verifyThemes(context, 'classic')).toMatchObject({ ok: false, error: { exitCode: 1, message: '«classic» es un tema distribuido: no tiene origen que verificar (solo los de themes/ del proyecto)' } });
    expect(await verifyThemes(context, 'nada')).toMatchObject({ ok: false, error: { code: 'not-found', message: 'No existe el tema «nada» en /work/themes' } });
    const repo = appContext(fs, { cwd: join(BUILTIN_THEMES_DIRECTORY, '..') });
    expect(await verifyThemes(repo)).toEqual({ ok: true, verifications: [], failed: false });
    expect(await verifyThemes(repo, 'nada')).toMatchObject({ ok: false, error: { message: 'No existe el tema «nada» en este proyecto' } });
  });

  it('el inventario añade el origen de los temas instalados y, si se pide, su verificación; los distribuidos y los temas a mano no lo llevan', async () => {
    const { fs, context } = await installed({ source: 'themes/comunidad.zip' }, { ...MIO, '/work/themes/roto/theme.toml': themeToml('roto'), '/work/themes/roto/template.typ': TYP, [`/work/themes/roto/${ORIGIN_FILE}`]: '{' });
    const plain = await themeInventory(context);
    const byName = (name: string) => plain.entries.find((entry) => entry.name === name);
    expect(byName('comunidad')?.origin).toEqual({ source: '/work/themes/comunidad.zip', kind: 'archive', installedAt: '2026-08-30T10:00:00.000Z' });
    expect(byName('mio')).not.toHaveProperty('origin');
    expect(byName('roto')).not.toHaveProperty('origin');
    expect(byName('classic')).not.toHaveProperty('origin');
    const verified = await themeInventory(context, { verify: true });
    expect(verified.entries.find((entry) => entry.name === 'comunidad')?.origin?.verified).toBe('intact');
    await fs.writeFile('/work/themes/comunidad/theme.toml', themeToml('comunidad').replace('#444444', '#454545'), 0o644);
    const modified = await themeInventory(context, { verify: true });
    expect(modified.entries.find((entry) => entry.name === 'comunidad')?.origin?.verified).toBe('modified');
  });
});
