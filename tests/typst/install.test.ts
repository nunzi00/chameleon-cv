import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TYPST_VERSION, cachedBinaryPath } from '../../src/renderers/typst';
import { PLATFORM_KEYS, binaryName, findExtractedBinary, installTypst, loadManifest, type Fetcher, type InstallOptions, type ReleaseManifest } from '../../src/typst';

let root = '';
interface Fixture {
  readonly archive: string;
  readonly sha256: string;
  readonly size: number;
}
let fixtures!: { readonly good: Fixture; readonly old: Fixture; readonly broken: Fixture; readonly empty: Fixture };

async function makeArchive(name: string, version: string | undefined, withBinary = true): Promise<{ archive: string; sha256: string; size: number }> {
  const source = join(root, 'fixtures', name, 'typst-x86_64-unknown-linux-musl');
  await mkdir(source, { recursive: true });
  if (withBinary) {
    await writeFile(join(source, 'typst'), version === undefined ? '#!/bin/sh\nexit 3\n' : `#!/bin/sh\necho "typst ${version} (test)"\n`, { mode: 0o755 });
  }
  await writeFile(join(source, 'README.md'), '# typst\n');
  const archive = join(root, 'fixtures', `${name}.tar`);
  execFileSync('tar', ['-cf', archive, '-C', join(root, 'fixtures', name), 'typst-x86_64-unknown-linux-musl']);
  const bytes = await readFile(archive);
  return { archive, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'chameleon-install-'));
  fixtures = {
    good: await makeArchive('good', TYPST_VERSION),
    old: await makeArchive('old', '0.14.0'),
    broken: await makeArchive('broken', undefined),
    empty: await makeArchive('empty', TYPST_VERSION, false),
  };
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function manifestFor(fixture: { sha256: string; size: number }, file = 'typst-test.tar'): ReleaseManifest {
  const base = loadManifest();
  return {
    ...base,
    baseUrl: 'https://releases.example/',
    assets: Object.fromEntries(PLATFORM_KEYS.map((key) => [key, { file, sha256: fixture.sha256, size: fixture.size }])) as ReleaseManifest['assets'],
  };
}

function serve(archive: string): Fetcher {
  return async (url) => {
    const bytes = await readFile(archive);
    async function* body(): AsyncGenerator<Uint8Array> {
      yield bytes;
    }
    return { ok: true, status: 200, url, body: body(), contentLength: bytes.length };
  };
}

/** Caché de usuario aislada por test (XDG_CACHE_HOME dentro del directorio temporal). */
function options(name: string, fixture: { archive: string; sha256: string; size: number }, extra: Partial<InstallOptions> = {}): InstallOptions & { readonly cache: string } {
  const cache = join(root, 'caches', name);
  return { platform: 'linux', arch: 'x64', env: { XDG_CACHE_HOME: cache, PATH: process.env['PATH'] ?? '' }, home: '/home/ada', manifest: manifestFor(fixture), fetcher: serve(fixture.archive), ...extra, cache };
}

async function leftovers(cache: string): Promise<string[]> {
  const directory = join(cache, 'chameleon-cv', 'typst', TYPST_VERSION);
  return readdir(directory).then((entries) => entries.filter((entry) => entry.startsWith('.')), () => []);
}

describe('installTypst', () => {
  it('descarga, verifica, extrae, comprueba la versión e instala de forma atómica en la caché de usuario, contándolo', async () => {
    const lines: string[] = [];
    const install = options('fresh', fixtures.good);
    const result = await installTypst(install, (line) => lines.push(line));
    const target = cachedBinaryPath(install.env!, 'linux', '/home/ada');
    expect(target).toBe(join(install.cache, 'chameleon-cv', 'typst', TYPST_VERSION, 'typst'));
    expect(result).toEqual({ ok: true, path: target, version: TYPST_VERSION, alreadyInstalled: false });
    expect((await stat(target)).mode & 0o777).toBe(0o700);
    expect(lines).toEqual([
      `Typst ${TYPST_VERSION} para linux-x64: typst-test.tar (0,0 MB) desde https://releases.example/typst-test.tar`,
      'Descargando… (la única operación de red de cv; la has pedido tú)',
      `Descargado: 0,0 MB · SHA-256 verificado (${fixtures.good.sha256.slice(0, 16)}…)`,
      `Extraído y comprobado: typst ${TYPST_VERSION}`,
      `Instalado en ${target}`,
    ]);
    expect(await leftovers(install.cache)).toEqual([]);

    const again: string[] = [];
    expect(await installTypst(install, (line) => again.push(line))).toEqual({ ok: true, path: target, version: TYPST_VERSION, alreadyInstalled: true });
    expect(again).toEqual([`Typst ${TYPST_VERSION} ya está instalado en ${target} (usa --force para reinstalar)`]);

    const forced = await installTypst({ ...install, force: true });
    expect(forced).toEqual({ ok: true, path: target, version: TYPST_VERSION, alreadyInstalled: false });
    expect(await leftovers(install.cache)).toEqual([]);
  });

  it('sin plataforma ni arquitectura explícitas usa las del proceso (esta máquina tiene binario oficial)', async () => {
    const install = options('host', fixtures.good);
    const { platform: _platform, arch: _arch, ...hostOptions } = install;
    expect(await installTypst(hostOptions)).toMatchObject({ ok: true, alreadyInstalled: false });
  });

  it('un binario en caché con otra versión se reinstala sin --force', async () => {
    const install = options('stale', fixtures.good);
    const target = cachedBinaryPath(install.env!, 'linux', '/home/ada');
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, '#!/bin/sh\necho "typst 0.14.0 (old)"\n', { mode: 0o700 });
    expect(await installTypst(install)).toEqual({ ok: true, path: target, version: TYPST_VERSION, alreadyInstalled: false });
    expect(await readFile(target, 'utf8')).toContain(TYPST_VERSION);
  });

  it('sin binario oficial para la plataforma lo dice y no toca nada', async () => {
    const install = options('unsupported', fixtures.good, { platform: 'freebsd', arch: 'x64' });
    expect(await installTypst(install)).toMatchObject({ ok: false, code: 'unsupported-platform', message: expect.stringContaining('freebsd-x64') });
    expect(await leftovers(install.cache)).toEqual([]);
  });

  it('un SHA-256 distinto del manifiesto aborta sin dejar rastro; los fallos de red también', async () => {
    const tampered = options('tampered', fixtures.good, { manifest: manifestFor({ sha256: 'a'.repeat(64), size: fixtures.good.size }) });
    expect(await installTypst(tampered)).toMatchObject({ ok: false, code: 'integrity', message: expect.stringContaining('SHA-256 incorrecto') });
    expect(await leftovers(tampered.cache)).toEqual([]);

    const offline = options('offline', fixtures.good, { fetcher: () => Promise.reject(new TypeError('fetch failed')) });
    expect(await installTypst(offline)).toMatchObject({ ok: false, code: 'download-failed', message: expect.stringContaining('fetch failed') });
    expect(await leftovers(offline.cache)).toEqual([]);
  });

  it('un archivo que no se puede extraer, sin binario, con otra versión o que no responde no se instala', async () => {
    const garbage = join(root, 'fixtures', 'garbage.bin');
    await writeFile(garbage, 'no soy un tar');
    const bytes = await readFile(garbage);
    const corrupt = options('corrupt', { archive: garbage, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length });
    expect(await installTypst(corrupt)).toMatchObject({ ok: false, code: 'extract-failed', message: expect.stringMatching(/^«tar» terminó con código/) });
    expect(await leftovers(corrupt.cache)).toEqual([]);

    const empty = options('empty', fixtures.empty);
    expect(await installTypst(empty)).toEqual({ ok: false, code: 'extract-failed', message: 'El archivo typst-test.tar no contiene «typst»' });

    const old = options('old', fixtures.old);
    expect(await installTypst(old)).toEqual({ ok: false, code: 'verify-failed', message: `El binario extraído es typst 0.14.0, no ${TYPST_VERSION}` });
    expect(await leftovers(old.cache)).toEqual([]);

    const broken = options('broken', fixtures.broken);
    expect(await installTypst(broken)).toMatchObject({ ok: false, code: 'verify-failed', message: expect.stringContaining('no responde a --version') });

    const notar = options('notar', fixtures.good, { env: { XDG_CACHE_HOME: join(root, 'caches', 'notar'), PATH: '' } });
    expect(await installTypst(notar)).toMatchObject({ ok: false, code: 'extract-failed', message: expect.stringContaining('No se encontró «tar»') });
    expect(await leftovers(notar.cache)).toEqual([]);
  });

  it('los errores de disco se explican como tales', async () => {
    const file = join(root, 'not-a-dir');
    await writeFile(file, 'x');
    const blocked = options('blocked', fixtures.good, { env: { XDG_CACHE_HOME: file, PATH: process.env['PATH'] ?? '' } });
    expect(await installTypst(blocked)).toMatchObject({ ok: false, code: 'io', message: expect.stringContaining('No se pudo crear') });

    const install = options('rename-fails', fixtures.good);
    const target = cachedBinaryPath(install.env!, 'linux', '/home/ada');
    await mkdir(target, { recursive: true }); // el destino es un directorio: rename falla
    expect(await installTypst(install, () => undefined)).toMatchObject({ ok: false, code: 'io', message: expect.stringContaining('No se pudo instalar el binario') });
    expect(await leftovers(install.cache)).toEqual([]);

    const readOnly = options('read-only', fixtures.good);
    const directory = join(cachedBinaryPath(readOnly.env!, 'linux', '/home/ada'), '..');
    await mkdir(directory, { recursive: true });
    await chmod(directory, 0o500); // no se puede crear el temporal de descarga
    try {
      expect(await installTypst(readOnly)).toMatchObject({ ok: false, code: 'io', message: expect.stringContaining('No se pudo guardar la descarga') });
    } finally {
      await chmod(directory, 0o700);
    }
  });

  it('findExtractedBinary y binaryName', async () => {
    const tree = join(root, 'tree');
    await mkdir(join(tree, 'a', 'b'), { recursive: true });
    await writeFile(join(tree, 'a', 'b', 'typst'), '');
    await writeFile(join(tree, 'a', 'typst.exe'), '');
    expect(await findExtractedBinary(tree, 'typst')).toBe(join(tree, 'a', 'b', 'typst'));
    expect(await findExtractedBinary(tree, 'typst.exe')).toBe(join(tree, 'a', 'typst.exe'));
    expect(await findExtractedBinary(tree, 'nope')).toBeUndefined();
    expect(binaryName('win32')).toBe('typst.exe');
    expect(binaryName('darwin')).toBe('typst');
  });
});
