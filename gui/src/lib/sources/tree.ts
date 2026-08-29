/** El árbol del explorador a partir de la lista plana de /sources: directorios primero, todo ordenado. */
export interface TreeFile {
  readonly kind: 'file';
  readonly name: string;
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface TreeDirectory {
  readonly kind: 'directory';
  readonly name: string;
  readonly path: string;
  readonly children: readonly TreeNode[];
}

export type TreeNode = TreeFile | TreeDirectory;

interface Entry {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface Folder {
  readonly files: TreeFile[];
  readonly folders: Map<string, Folder>;
}

function place(folder: Folder, segments: readonly string[], entry: Entry, prefix: string): void {
  const [head, ...rest] = segments;
  if (head === undefined) {
    return;
  }
  if (rest.length === 0) {
    folder.files.push({ kind: 'file', name: head, path: entry.path, bytes: entry.bytes, sha256: entry.sha256 });
    return;
  }
  let child = folder.folders.get(head);
  if (child === undefined) {
    child = { files: [], folders: new Map() };
    folder.folders.set(head, child);
  }
  place(child, rest, entry, `${prefix}${head}/`);
}

function nodesOf(folder: Folder, prefix: string): readonly TreeNode[] {
  const compare = (a: string, b: string): number => a.localeCompare(b, 'es');
  const directories: TreeDirectory[] = [...folder.folders.entries()].sort(([a], [b]) => compare(a, b)).map(([name, child]) => ({ kind: 'directory', name, path: `${prefix}${name}`, children: nodesOf(child, `${prefix}${name}/`) }));
  const files = [...folder.files].sort((a, b) => compare(a.name, b.name));
  return [...directories, ...files];
}

export function buildTree(entries: readonly Entry[]): readonly TreeNode[] {
  const root: Folder = { files: [], folders: new Map() };
  for (const entry of entries) {
    place(root, entry.path.split('/').filter((segment) => segment !== ''), entry, '');
  }
  return nodesOf(root, '');
}
