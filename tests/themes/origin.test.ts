/**
 * Origen y huellas de un tema instalado (T-8.3, docs/theme-gallery.md §4.2 paso 5 y §4.3): `.origin.json` y `verify`
 * en sus tres estados, con ficheros modificados, ausentes o añadidos.
 */
import { describe, expect, it } from 'vitest';

import { ORIGIN_FILE, canonicalDigest, fileDigests, listThemeFiles, parseOrigin, serializeOrigin, sha256Hex, verifyThemeDirectory, type ThemeOrigin } from '../../src/themes';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const A = { path: 'theme.toml', bytes: Buffer.from('[theme]\n') };
const B = { path: 'fonts/x-1.ttf', bytes: Buffer.from([1, 2, 3]) };

const ORIGIN: ThemeOrigin = {
  source: 'https://ejemplo.org/comunidad.zip',
  kind: 'url',
  archiveSha256: 'a'.repeat(64),
  files: { 'fonts/x-1.ttf': sha256Hex(B.bytes), 'theme.toml': sha256Hex(A.bytes) },
  installedAt: '2026-08-30T10:00:00.000Z',
  tool: 'chameleon-cv 1.5.0',
};

describe('huellas y .origin.json', () => {
  it('calcula huellas por fichero en orden, una huella canónica independiente del orden y serializa con claves fijas', () => {
    expect(sha256Hex(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(Object.keys(fileDigests([A, B]))).toEqual(['fonts/x-1.ttf', 'theme.toml']);
    expect(canonicalDigest([A, B])).toBe(canonicalDigest([B, A]));
    expect(canonicalDigest([A])).not.toBe(canonicalDigest([A, B]));
    const text = serializeOrigin({ tool: ORIGIN.tool, installedAt: ORIGIN.installedAt, files: ORIGIN.files, archiveSha256: ORIGIN.archiveSha256, kind: ORIGIN.kind, source: ORIGIN.source });
    expect(text.startsWith('{\n  "source": "https://ejemplo.org/comunidad.zip",\n  "kind": "url",\n  "archiveSha256"')).toBe(true);
    expect(text.endsWith('}\n')).toBe(true);
    expect(parseOrigin(text)).toEqual({ ok: true, origin: ORIGIN });
  });

  it('explica el JSON inválido y los campos que no cumplen el esquema', () => {
    expect(parseOrigin('{')).toMatchObject({ ok: false, message: expect.stringMatching(/^\.origin\.json no es JSON válido: /) });
    expect(parseOrigin(JSON.stringify({ ...ORIGIN, archiveSha256: 'xyz' }))).toEqual({ ok: false, message: '.origin.json inválido: archiveSha256: huella SHA-256 inválida' });
    expect(parseOrigin(JSON.stringify({ ...ORIGIN, extra: 1 }))).toMatchObject({ ok: false, message: expect.stringContaining('extra') });
    expect(parseOrigin(JSON.stringify({ ...ORIGIN, installedAt: 'ayer' }))).toMatchObject({ ok: false, message: expect.stringContaining('installedAt') });
    expect(parseOrigin('[]')).toMatchObject({ ok: false, message: expect.stringContaining('<raíz>') });
  });
});

describe('verifyThemeDirectory', () => {
  const tree = (origin: string | undefined, extra: Record<string, string> = {}) =>
    new MemoryFileSystem({
      '/work/themes/comunidad/theme.toml': '[theme]\n',
      '/work/themes/comunidad/fonts/x-1.ttf': { kind: 'file', content: '', bytes: new Uint8Array([1, 2, 3]) },
      '/work/themes/comunidad/fonts/enlace': { kind: 'symlink', target: 'x-1.ttf' },
      '/work/themes/comunidad/raro': { kind: 'other' },
      ...(origin === undefined ? {} : { [`/work/themes/comunidad/${ORIGIN_FILE}`]: origin }),
      ...extra,
    });

  it('sin .origin.json no hay origen; con huellas iguales está intacto; el listado ignora enlaces y entradas raras', async () => {
    expect(await verifyThemeDirectory(tree(undefined), '/work/themes/comunidad')).toEqual({ state: 'none', origin: undefined, files: [], problem: undefined });
    const intact = await verifyThemeDirectory(tree(serializeOrigin(ORIGIN)), '/work/themes/comunidad');
    expect(intact).toEqual({
      state: 'intact',
      origin: ORIGIN,
      files: [
        { path: 'fonts/x-1.ttf', state: 'ok' },
        { path: 'theme.toml', state: 'ok' },
      ],
      problem: undefined,
    });
    expect(await listThemeFiles(tree(serializeOrigin(ORIGIN)), '/work/themes/comunidad')).toEqual(['fonts/x-1.ttf', 'theme.toml']);
  });

  it('detecta ficheros modificados, ausentes y añadidos, y un .origin.json ilegible cuenta como modificado', async () => {
    const changed = tree(serializeOrigin(ORIGIN), { '/work/themes/comunidad/theme.toml': '[theme]\nname = "x"\n', '/work/themes/comunidad/template.typ': '#let cv(d, theme) = []' });
    const report = await verifyThemeDirectory(changed, '/work/themes/comunidad');
    expect(report.state).toBe('modified');
    expect(report.files).toEqual([
      { path: 'fonts/x-1.ttf', state: 'ok' },
      { path: 'template.typ', state: 'added' },
      { path: 'theme.toml', state: 'modified' },
    ]);
    const missing = new MemoryFileSystem({ '/work/themes/comunidad/theme.toml': '[theme]\n', [`/work/themes/comunidad/${ORIGIN_FILE}`]: serializeOrigin(ORIGIN) });
    expect((await verifyThemeDirectory(missing, '/work/themes/comunidad')).files).toEqual([
      { path: 'fonts/x-1.ttf', state: 'missing' },
      { path: 'theme.toml', state: 'ok' },
    ]);
    expect(await verifyThemeDirectory(tree('{'), '/work/themes/comunidad')).toMatchObject({ state: 'modified', origin: undefined, files: [], problem: expect.stringMatching(/no es JSON válido/) });
  });
});
