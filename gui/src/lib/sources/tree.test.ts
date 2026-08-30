import { describe, expect, it } from 'vitest';

import { buildTree, countFiles, filterTree, issueCounts, lineEnding, shortSha } from './tree';

describe('buildTree', () => {
  it('anida por directorios, con directorios primero y todo ordenado en español; ignora rutas vacías', () => {
    const tree = buildTree([
      { path: 'skills.csv', bytes: 10, sha256: 's' },
      { path: 'experience/zeta.md', bytes: 20, sha256: 'z' },
      { path: 'experience/acme.md', bytes: 30, sha256: 'a' },
      { path: 'profile.md', bytes: 40, sha256: 'p' },
      { path: 'projects/sub/deep.md', bytes: 50, sha256: 'd' },
      { path: '', bytes: 0, sha256: '' },
    ]);
    expect(tree.map((node) => `${node.kind}:${node.name}`)).toEqual(['directory:experience', 'directory:projects', 'file:profile.md', 'file:skills.csv']);
    const experience = tree[0];
    expect(experience?.kind === 'directory' && experience.children.map((child) => child.path)).toEqual(['experience/acme.md', 'experience/zeta.md']);
    const projects = tree[1];
    expect(projects?.kind === 'directory' && projects.children[0]).toEqual({ kind: 'directory', name: 'sub', path: 'projects/sub', children: [{ kind: 'file', name: 'deep.md', path: 'projects/sub/deep.md', bytes: 50, sha256: 'd' }] });
  });
});

describe('filtro, recuentos e incidencias del árbol (T-8.6 S2)', () => {
  const nodes = buildTree([
    { path: 'profile.md', bytes: 1, sha256: 'a' },
    { path: 'experience/acme.md', bytes: 1, sha256: 'b' },
    { path: 'experience/globex.md', bytes: 1, sha256: 'c' },
    { path: 'projects/cv.md', bytes: 1, sha256: 'd' },
  ]);

  it('filterTree conserva las carpetas con algún hijo que coincide y devuelve el árbol intacto sin consulta', () => {
    expect(filterTree(nodes, '')).toBe(nodes);
    const globex = filterTree(nodes, 'GLOBEX');
    expect(globex.map((node) => node.path)).toEqual(['experience']);
    expect(globex[0]?.kind === 'directory' && globex[0].children.map((child) => child.name)).toEqual(['globex.md']);
    expect(filterTree(nodes, 'profile').map((node) => node.path)).toEqual(['profile.md']);
    expect(filterTree(nodes, 'nada')).toEqual([]);
  });

  it('countFiles, issueCounts, shortSha y lineEnding', () => {
    expect(countFiles(nodes)).toBe(4);
    expect(countFiles(filterTree(nodes, 'experience'))).toBe(2);
    const counts = issueCounts([{ file: 'experience/globex.md' }, { file: 'experience/globex.md' }, { file: 'skills.csv' }]);
    expect(counts.get('experience/globex.md')).toBe(2);
    expect(counts.get('skills.csv')).toBe(1);
    expect(counts.get('profile.md')).toBeUndefined();
    expect(shortSha('9c02abcdef0123456789abcdef41ae')).toBe('sha256:9c02…41ae');
    expect(shortSha('abc')).toBe('sha256:abc');
    expect(lineEnding('a\nb')).toBe('LF');
    expect(lineEnding('a\r\nb')).toBe('CRLF');
  });
});
