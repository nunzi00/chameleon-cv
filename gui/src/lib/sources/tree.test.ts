import { describe, expect, it } from 'vitest';

import { buildTree } from './tree';

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
