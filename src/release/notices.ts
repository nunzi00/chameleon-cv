/**
 * Avisos de licencias de terceros para el ejecutable (T-6.6). El binario redistribuye Node.js y los
 * paquetes npm que esbuild une al código de la aplicación, y cada uno conserva su licencia y sus
 * avisos. El inventario sale del `metafile` de esbuild (lo que de verdad viaja en el bundle, no lo que
 * declara `package.json`); el texto de cada licencia, del propio paquete instalado; y el de Node.js,
 * de la distribución que `node --build-sea` embebe (la misma que ejecuta el empaquetado).
 */
import { dirname, join } from 'node:path';

import type { DirectoryEntry } from '../parsers/dataset/file-system';

/** Subconjunto de `FileSystem` que necesita el inventario (`NodeFileSystem` lo cumple; en pruebas, uno en memoria). */
export interface NoticeFileSystem {
  readDirectory(path: string): Promise<readonly DirectoryEntry[]>;
  readTextFile(path: string): Promise<string>;
}

export interface PackageNotice {
  readonly name: string;
  readonly version: string;
  /** Identificador declarado en `package.json` (`license`, o el `licenses` heredado), o «no declarada». */
  readonly license: string;
  /** Directorio del paquete relativo a la raíz del proyecto (`node_modules/…`, anidados incluidos). */
  readonly root: string;
  /** Ficheros de licencia y avisos encontrados en el paquete (LICENSE, LICENCE, COPYING, NOTICE…), ordenados. */
  readonly files: readonly string[];
  /** Texto de esos ficheros, concatenado; `undefined` si el paquete no incluye ninguno. */
  readonly text: string | undefined;
}

interface PackageManifest {
  readonly name?: string;
  readonly version?: string;
  readonly license?: string | { readonly type?: string };
  readonly licenses?: readonly { readonly type?: string }[];
}

export interface NodeLicense {
  readonly path: string;
  readonly text: string;
}

export interface NoticesInput {
  readonly product: { readonly name: string; readonly version: string; readonly license: string };
  readonly node: { readonly version: string; readonly text: string };
  readonly packages: readonly PackageNotice[];
  readonly fonts: readonly { readonly name: string; readonly license: string; readonly file: string }[];
}

const PACKAGE_ROOT = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//;
const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.|-|_|$)/i;

/** Directorios de paquete (`node_modules/x`, `node_modules/@ámbito/x`, anidados) presentes en las entradas del `metafile` de esbuild; únicos y ordenados. */
export function packageRootsFromInputs(inputs: Iterable<string>): string[] {
  const roots = new Set<string>();
  for (const input of inputs) {
    const match = PACKAGE_ROOT.exec(input.replace(/\\/g, '/'));
    if (match !== null) {
      roots.add(String(match[1]));
    }
  }
  return [...roots].sort();
}

function declaredLicense(manifest: PackageManifest): string {
  if (typeof manifest.license === 'string' && manifest.license !== '') {
    return manifest.license;
  }
  if (typeof manifest.license === 'object' && typeof manifest.license.type === 'string') {
    return manifest.license.type;
  }
  const legacy = (manifest.licenses ?? []).map((entry) => entry.type).filter((type): type is string => typeof type === 'string');
  return legacy.length === 0 ? 'no declarada' : legacy.join(' OR ');
}

/** Inventario de licencias de los paquetes dados, leído de `<raíz>/<paquete>/package.json` y de sus ficheros de licencia; por nombre y después por ruta. */
export async function collectPackageNotices(projectRoot: string, packageRoots: readonly string[], fs: NoticeFileSystem): Promise<PackageNotice[]> {
  const notices: PackageNotice[] = [];
  for (const root of packageRoots) {
    const directory = join(projectRoot, root);
    const manifest = JSON.parse(await fs.readTextFile(join(directory, 'package.json'))) as PackageManifest;
    const files = (await fs.readDirectory(directory))
      .filter((entry) => entry.kind === 'file' && LICENSE_FILE.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    const texts: string[] = [];
    for (const file of files) {
      texts.push((await fs.readTextFile(join(directory, file))).trim());
    }
    notices.push({ name: manifest.name ?? root, version: manifest.version ?? 'sin versión', license: declaredLicense(manifest), root, files, text: texts.length === 0 ? undefined : texts.join('\n\n') });
  }
  return notices.sort((a, b) => a.name.localeCompare(b.name, 'en') || a.root.localeCompare(b.root, 'en'));
}

/** Dónde buscar el texto de la licencia del Node que ejecuta el empaquetado (y que `--build-sea` embebe), por orden. */
export function nodeLicenseCandidates(execPath: string, env: Readonly<Record<string, string | undefined>>): string[] {
  const explicit = env['CHAMELEON_NODE_LICENSE'];
  return [
    ...(explicit === undefined || explicit === '' ? [] : [explicit]),
    join(dirname(dirname(execPath)), 'LICENSE'), // distribución oficial de nodejs.org (también setup-node, nvm, fnm, volta)
    '/usr/share/licenses/nodejs/LICENSE', // Arch Linux
    '/usr/share/doc/nodejs/copyright', // Debian y Ubuntu
  ];
}

/** El primer candidato legible; `undefined` si ninguno lo es. */
export async function findNodeLicense(candidates: readonly string[], fs: Pick<NoticeFileSystem, 'readTextFile'>): Promise<NodeLicense | undefined> {
  for (const path of candidates) {
    try {
      return { path, text: (await fs.readTextFile(path)).trim() };
    } catch {
      // siguiente candidato
    }
  }
  return undefined;
}

/** `THIRD-PARTY-NOTICES.md`: determinista para el mismo inventario (mismo orden, sin fechas). */
export function renderNotices(input: NoticesInput): string {
  const { product, node, packages, fonts } = input;
  const withoutText = packages.filter((item) => item.text === undefined).length;
  const lines: string[] = [
    '# Avisos de licencias de terceros',
    '',
    `${product.name} ${product.version} se distribuye bajo la licencia ${product.license} (fichero \`LICENSE\`). El ejecutable incorpora software de terceros que conserva su propia licencia y sus avisos:`,
    '',
    `- **Node.js ${node.version}**, el runtime embebido en el ejecutable (§1).`,
    `- **${packages.length} paquetes npm** unidos al código de la aplicación (§2), por orden alfabético: de cada uno, el identificador de licencia que declara su \`package.json\` y el texto de licencia incluido en el paquete${withoutText === 0 ? '' : ` (${withoutText} sin texto en el paquete: se indica solo su identificador)`}.`,
    ...fonts.map((font) => `- **${font.name}** (fuente tipográfica): ${font.license}, fichero \`${font.file}\`.`),
    '',
    'Typst no forma parte de este archivo: `cv typst install` lo descarga, solo cuando el usuario lo pide, desde su release oficial (licencia Apache-2.0) y lo verifica por SHA-256.',
    '',
    `## 1. Node.js ${node.version}`,
    '',
    node.text,
    '',
    '## 2. Paquetes npm',
    '',
  ];
  for (const item of packages) {
    lines.push(`### ${item.name} ${item.version} — ${item.license}`, '');
    lines.push(item.text === undefined ? `El paquete npm no incluye el texto de su licencia; identificador declarado en \`package.json\`: ${item.license}.` : item.text, '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
