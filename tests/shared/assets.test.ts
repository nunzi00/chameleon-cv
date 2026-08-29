import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ASSET_MANIFEST_KEY, AssetError, DiskAssets, MemoryAssets, REPO_ROOT, SeaAssets, assertKey, assertPrefix, defaultAssets, materialize, parseManifest, sha256, type AssetManifest, type SeaApi } from '../../src/shared/assets';
import { cacheDirectory } from '../../src/shared/cache';

let root = '';
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'chameleon-assets-'));
  await mkdir(join(root, 'repo', 'themes', 'default'), { recursive: true });
  await mkdir(join(root, 'repo', 'prompts'), { recursive: true });
  await writeFile(join(root, 'repo', 'themes', 'default', 'theme.toml'), 'name = "default"\n');
  await writeFile(join(root, 'repo', 'themes', 'default', 'template.typ'), '#let cv(d, theme) = d\n');
  await writeFile(join(root, 'repo', 'prompts', 'improve.v1.md'), 'prompt ñ\n');
  await writeFile(join(root, 'repo', 'package.json'), '{"version":"1.2.3"}\n');
  await writeFile(join(root, 'repo', 'binario.bin'), new Uint8Array([0, 255, 1]));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function manifestFor(files: Record<string, string | Uint8Array>, version = '9.9.9'): AssetManifest {
  const entries = Object.entries(files).map(([key, content]) => {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    return [key, { sha256: sha256(bytes), bytes: bytes.byteLength }] as const;
  });
  return { version, files: Object.fromEntries(entries) };
}

/** Doble de node:sea: los assets del binario más el manifiesto (salvo que se pida omitirlo o falsearlo). */
function fakeSea(files: Record<string, string | Uint8Array>, options: { manifest?: string | undefined; isSea?: boolean } = {}): SeaApi {
  const all: Record<string, string | Uint8Array> = { ...files };
  if (options.manifest !== '') {
    all[ASSET_MANIFEST_KEY] = options.manifest ?? JSON.stringify(manifestFor(files));
  }
  return {
    isSea: () => options.isSea ?? true,
    getAssetKeys: () => Object.keys(all),
    getAsset: (key) => {
      const content = all[key];
      if (content === undefined) {
        throw new Error(`No asset found for key: ${key}`);
      }
      const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    },
  };
}

describe('claves de assets', () => {
  it('admite rutas relativas POSIX y rechaza todo lo demás', () => {
    expect(assertKey('themes/default/theme.toml')).toBe('themes/default/theme.toml');
    expect(assertPrefix('')).toBe('');
    for (const bad of ['', '/abs', 'a//b', 'a/./b', '../x', 'a\\b', 'a/']) {
      expect(() => assertKey(bad)).toThrow(AssetError);
    }
    expect(() => assertPrefix('..')).toThrow('Clave de asset inválida');
    expect(sha256(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('DiskAssets (desarrollo y dist/)', () => {
  it('lee texto y bytes, lista claves ordenadas bajo un prefijo y devuelve directorios reales', async () => {
    const assets = new DiskAssets(join(root, 'repo'));
    expect(assets.kind).toBe('disk');
    expect(await assets.text('prompts/improve.v1.md')).toBe('prompt ñ\n');
    expect(await assets.bytes('binario.bin')).toEqual(new Uint8Array([0, 255, 1]));
    expect(await assets.keys()).toEqual(['binario.bin', 'package.json', 'prompts/improve.v1.md', 'themes/default/template.typ', 'themes/default/theme.toml']);
    expect(await assets.keys('themes')).toEqual(['themes/default/template.typ', 'themes/default/theme.toml']);
    expect(await assets.directory('themes')).toBe(join(root, 'repo', 'themes'));
    expect(await assets.directory('')).toBe(join(root, 'repo'));
    await expect(assets.text('prompts/nope.md')).rejects.toMatchObject({ code: 'missing' });
    await expect(assets.keys('nope')).rejects.toMatchObject({ code: 'missing' });
    await expect(assets.directory('package.json')).rejects.toMatchObject({ code: 'missing', message: expect.stringContaining('No existe el directorio de assets «package.json»') });
    await expect(assets.directory('nope')).rejects.toMatchObject({ code: 'missing' });
    expect(new DiskAssets().root).toBe(REPO_ROOT);
  });
});

describe('MemoryAssets y materialización', () => {
  it('sirve de doble y materializa en un directorio propio (0700/0644), reparando lo alterado y lo ausente', async () => {
    const target = join(root, 'memory-cache');
    const assets = new MemoryAssets({ 'themes/a/theme.toml': 'a', 'themes/a/x/fonts.bin': new Uint8Array([7, 8]), 'prompts/p.md': 'p' }, target);
    expect(assets.kind).toBe('memory');
    expect(await assets.text('themes/a/theme.toml')).toBe('a');
    expect(await assets.keys('themes')).toEqual(['themes/a/theme.toml', 'themes/a/x/fonts.bin']);
    expect(await assets.keys()).toHaveLength(3);
    await expect(assets.bytes('nope')).rejects.toMatchObject({ code: 'missing' });
    const directory = await assets.directory('themes');
    expect(directory).toBe(join(target, 'themes'));
    expect(await readFile(join(directory, 'a', 'theme.toml'), 'utf8')).toBe('a');
    expect(new Uint8Array(await readFile(join(directory, 'a', 'x', 'fonts.bin')))).toEqual(new Uint8Array([7, 8]));
    expect((await stat(join(directory, 'a'))).mode & 0o777).toBe(0o700);
    expect((await stat(join(directory, 'a', 'theme.toml'))).mode & 0o777).toBe(0o644);
    // Alterado y borrado: se reparan; intacto: no se reescribe.
    await writeFile(join(directory, 'a', 'theme.toml'), 'manipulado');
    await rm(join(directory, 'a', 'x', 'fonts.bin'));
    const before = (await stat(join(target, 'prompts', 'p.md').replace('prompts/p.md', 'themes/a/theme.toml'))).mtimeMs;
    void before;
    expect(await assets.directory('themes')).toBe(directory);
    expect(await readFile(join(directory, 'a', 'theme.toml'), 'utf8')).toBe('a');
    expect(new Uint8Array(await readFile(join(directory, 'a', 'x', 'fonts.bin')))).toEqual(new Uint8Array([7, 8]));
    await expect(assets.directory('nope')).rejects.toMatchObject({ code: 'missing' });
    await expect(new MemoryAssets({ 'a.txt': 'a' }).directory('')).rejects.toMatchObject({ code: 'unwritable' });
    // Un destino no escribible (un fichero donde debería ir un directorio) es un error claro.
    const blocked = join(root, 'blocked');
    await writeFile(blocked, 'soy un fichero');
    await expect(new MemoryAssets({ 'x/y.txt': 'y' }, blocked).directory('x')).rejects.toMatchObject({ code: 'unwritable' });
    expect(() => new MemoryAssets({ '../mal': 'x' })).toThrow(AssetError);
  });

  it('materialize exige el manifiesto cuando se le pasa: assets ausentes en él o alterados en el binario son corrupción', async () => {
    const files = { 'fonts/a.ttf': 'AAA', 'fonts/b.ttf': 'BBB' };
    const store = new MemoryAssets(files);
    const manifest = manifestFor(files);
    const target = join(root, 'manifest-cache');
    expect(await materialize(store, 'fonts', target, (key) => manifest.files[key]?.sha256)).toBe(join(target, 'fonts'));
    await expect(materialize(store, 'fonts', target, () => undefined)).rejects.toMatchObject({ code: 'corrupt', message: expect.stringContaining('no figura en el manifiesto') });
    await expect(materialize(store, 'fonts', target, () => 'f'.repeat(64))).rejects.toMatchObject({ code: 'corrupt', message: expect.stringContaining('no coincide con el manifiesto') });
    await expect(materialize(new MemoryAssets({}), '', target)).rejects.toMatchObject({ code: 'missing' });
  });
});

describe('SeaAssets (ejecutable autónomo)', () => {
  const files = { 'themes/default/theme.toml': 'name = "default"\n', 'themes/default/template.typ': '#let cv(d, theme) = d\n', 'templates/fonts/F.ttf': new Uint8Array([1, 2, 3]), 'package.json': '{"version":"9.9.9"}' };

  it('lee del binario, lista las claves del manifiesto y materializa en <caché>/assets/<versión> comprobando hashes', async () => {
    const cacheRoot = join(root, 'sea-cache');
    const assets = new SeaAssets({ sea: fakeSea(files), cacheRoot });
    expect(assets.kind).toBe('sea');
    expect(await assets.text('package.json')).toBe('{"version":"9.9.9"}');
    expect(await assets.bytes('templates/fonts/F.ttf')).toEqual(new Uint8Array([1, 2, 3]));
    expect(await assets.keys('themes')).toEqual(['themes/default/template.typ', 'themes/default/theme.toml']);
    expect(await assets.keys()).toHaveLength(4);
    await expect(assets.text('nope.txt')).rejects.toMatchObject({ code: 'missing' });
    await expect(assets.text('../x')).rejects.toMatchObject({ code: 'invalid-key' });
    expect(await assets.cacheDirectory()).toBe(join(cacheRoot, 'assets', '9.9.9'));
    const themes = await assets.directory('themes');
    expect(themes).toBe(join(cacheRoot, 'assets', '9.9.9', 'themes'));
    expect(await readFile(join(themes, 'default', 'theme.toml'), 'utf8')).toBe('name = "default"\n');
    expect(await assets.directory('themes')).toBe(themes); // intacto: nada se reescribe
    expect(await assets.keys('package.json')).toEqual(['package.json']);
    const fonts = await assets.directory('templates/fonts');
    expect(new Uint8Array(await readFile(join(fonts, 'F.ttf')))).toEqual(new Uint8Array([1, 2, 3]));
    // Un asset manipulado dentro del «binario» no coincide con el manifiesto: corrupción, no se materializa.
    const tampered = new SeaAssets({ sea: fakeSea({ ...files, 'templates/fonts/F.ttf': new Uint8Array([9]) }, { manifest: JSON.stringify(manifestFor(files)) }), cacheRoot: join(root, 'sea-cache-2') });
    await expect(tampered.directory('templates/fonts')).rejects.toMatchObject({ code: 'corrupt' });
    // Caché no escribible.
    const blocked = join(root, 'sea-blocked');
    await writeFile(blocked, 'fichero');
    await expect(new SeaAssets({ sea: fakeSea(files), cacheRoot: blocked }).directory('themes')).rejects.toMatchObject({ code: 'unwritable' });
  });

  it('sin manifiesto, o con uno inválido, el ejecutable está corrupto; la caché por defecto es la de la plataforma', async () => {
    await expect(new SeaAssets({ sea: fakeSea(files, { manifest: '' }) }).keys()).rejects.toMatchObject({ code: 'corrupt', message: expect.stringContaining('no lleva el manifiesto') });
    await expect(new SeaAssets({ sea: fakeSea(files, { manifest: '{"version": 1}' }) }).keys()).rejects.toMatchObject({ code: 'corrupt', message: expect.stringContaining('Manifiesto de assets inválido') });
    await expect(new SeaAssets({ sea: fakeSea(files, { manifest: 'no json' }) }).keys()).rejects.toMatchObject({ code: 'corrupt', message: expect.stringContaining('ilegible') });
    expect(() => parseManifest('{"version":"1","files":{"a":{"sha256":"corto","bytes":1}}}')).toThrow(AssetError);
    // Sin doble inyectado usa node:sea de verdad: este proceso no es un SEA, así que no hay manifiesto.
    await expect(new SeaAssets({ cacheRoot: join(root, 'real') }).keys()).rejects.toMatchObject({ code: 'corrupt', message: expect.stringContaining('no lleva el manifiesto') });
    const platform = new SeaAssets({ sea: fakeSea(files), env: { XDG_CACHE_HOME: '/xdg' }, platform: 'linux', home: '/h' });
    expect(await platform.cacheDirectory()).toBe('/xdg/chameleon-cv/assets/9.9.9');
    expect(await new SeaAssets({ sea: fakeSea(files) }).cacheDirectory()).toBe(join(cacheDirectory(process.env, process.platform, require('node:os').homedir()), 'assets', '9.9.9'));
  });

  it('defaultAssets elige el binario cuando el proceso es un SEA y el repositorio en caso contrario', async () => {
    const disk = defaultAssets();
    expect(disk.kind).toBe('disk');
    expect(await disk.directory('themes')).toBe(join(REPO_ROOT, 'themes'));
    expect(await disk.text('package.json')).toContain('"name": "chameleon-cv"');
    expect(defaultAssets(fakeSea(files)).kind).toBe('sea');
    expect(defaultAssets(fakeSea(files, { isSea: false })).kind).toBe('disk');
  });
});
