import { describe, expect, it } from 'vitest';

import { MemorySourceTree } from '../../../src/parsers/dataset/memory-file-system';

describe('MemorySourceTree', () => {
  const tree = new MemorySourceTree('/plan', { 'profile.md': '---\nfullName: Ada\n---\n', 'experience/acme.md': 'x', 'a/b/c.md': 'deep' });

  it('lista directorios (ficheros y subdirectorios), sin duplicados', async () => {
    expect(await tree.readDirectory('/plan')).toEqual([
      { name: 'profile.md', kind: 'file' },
      { name: 'experience', kind: 'directory' },
      { name: 'a', kind: 'directory' },
    ]);
    expect(await tree.readDirectory('/plan/experience')).toEqual([{ name: 'acme.md', kind: 'file' }]);
    expect(await tree.readDirectory('/plan/a')).toEqual([{ name: 'b', kind: 'directory' }]);
    await expect(tree.readDirectory('/plan/nope')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(tree.readDirectory('/plan/profile.md')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('stat, realPath y lectura', async () => {
    expect(await tree.stat('/plan/profile.md')).toEqual({ kind: 'file', size: 22, mtimeMs: 0 });
    expect(await tree.stat('/plan/a/b')).toEqual({ kind: 'directory', size: 0, mtimeMs: 0 });
    await expect(tree.stat('/plan/zzz')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await tree.realPath('/plan/./experience/../experience/acme.md')).toBe('/plan/experience/acme.md');
    expect(await tree.realPath('/plan')).toBe('/plan');
    await expect(tree.realPath('/plan/zzz')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await tree.readTextFile('/plan/a/b/c.md')).toBe('deep');
    expect(Buffer.from(await tree.readBinaryFile('/plan/experience/acme.md')).toString()).toBe('x');
    await expect(tree.readTextFile('/plan/experience')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('admite un Map y una raíz en /', async () => {
    const fromMap = new MemorySourceTree('/', new Map([['x/y.md', 'y']]));
    expect(await fromMap.readDirectory('/')).toEqual([{ name: 'x', kind: 'directory' }]);
    expect(await fromMap.readTextFile('/x/y.md')).toBe('y');
  });
});
