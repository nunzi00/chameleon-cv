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

/** Filtra el árbol por texto (nombre o ruta, sin distinguir mayúsculas); una carpeta se conserva si conserva algún hijo. */
export function filterTree(nodes: readonly TreeNode[], query: string): readonly TreeNode[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return nodes;
  }
  const result: TreeNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'file') {
      if (node.path.toLowerCase().includes(needle)) {
        result.push(node);
      }
      continue;
    }
    const children = filterTree(node.children, needle);
    if (children.length > 0) {
      result.push({ ...node, children });
    }
  }
  return result;
}

export function countFiles(nodes: readonly TreeNode[]): number {
  return nodes.reduce((total, node) => total + (node.kind === 'file' ? 1 : countFiles(node.children)), 0);
}

/** Incidencias por fichero (ruta relativa) a partir de la lista de validación. */
export function issueCounts(issues: readonly { readonly file: string }[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    counts.set(issue.file, (counts.get(issue.file) ?? 0) + 1);
  }
  return counts;
}

/** `sha256:9c02…41ae`: los cuatro primeros y los cuatro últimos caracteres de la huella. */
export function shortSha(sha256: string): string {
  return sha256.length <= 12 ? `sha256:${sha256}` : `sha256:${sha256.slice(0, 4)}…${sha256.slice(-4)}`;
}

/** Fin de línea del contenido, para el pie del editor. */
export function lineEnding(content: string): 'LF' | 'CRLF' {
  return content.includes('\r\n') ? 'CRLF' : 'LF';
}
