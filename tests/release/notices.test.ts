import { describe, expect, it } from 'vitest';

import { collectPackageNotices, findNodeLicense, nodeLicenseCandidates, packageRootsFromInputs, renderNotices, type PackageNotice } from '../../src/release/notices';
import { MemoryFileSystem } from '../helpers/memory-file-system';

describe('packageRootsFromInputs', () => {
  it('extrae los directorios de paquete (con ámbito y anidados), únicos y ordenados; ignora el código propio', () => {
    expect(packageRootsFromInputs([
      'node_modules/zod/index.js',
      'node_modules/zod/lib/x.js',
      'node_modules/@noble/hashes/sha256.js',
      'node_modules/linebreak/node_modules/base64-js/index.js',
      'node_modules\\pdfkit\\js\\pdfkit.js',
      'dist/index.js',
      'src/pdf/worker.mts',
    ])).toEqual(['node_modules/@noble/hashes', 'node_modules/linebreak/node_modules/base64-js', 'node_modules/pdfkit', 'node_modules/zod']);
  });
});

describe('collectPackageNotices', () => {
  it('lee nombre, versión, identificador y ficheros de licencia de cada paquete; ordena por nombre y después por ruta', async () => {
    const fs = new MemoryFileSystem({
      '/p/node_modules/zod/package.json': '{"name":"zod","version":"4.0.0","license":"MIT"}',
      '/p/node_modules/zod/LICENSE': 'MIT License\n\nCopyright (c) Colin\n',
      '/p/node_modules/zod/index.js': '',
      '/p/node_modules/apache-thing/package.json': '{"name":"apache-thing","version":"1.2.3","license":{"type":"Apache-2.0"}}',
      '/p/node_modules/apache-thing/LICENSE.txt': 'Apache\n',
      '/p/node_modules/apache-thing/NOTICE': 'Notice\n',
      '/p/node_modules/apache-thing/licenses.d': { kind: 'directory' },
      '/p/node_modules/format/package.json': '{"name":"format","version":"0.2.2","licenses":[{"type":"MIT","url":"x"},{"url":"y"}]}',
      '/p/node_modules/format/format.js': '',
      '/p/node_modules/base64-js/package.json': '{"name":"base64-js","version":"1.5.1","license":""}',
      '/p/node_modules/base64-js/LICENCE.md': 'Licencia\n',
      '/p/node_modules/linebreak/node_modules/base64-js/package.json': '{"name":"base64-js","version":"0.0.8","license":{}}',
      '/p/node_modules/linebreak/node_modules/base64-js/COPYING': 'Copia\n',
      '/p/node_modules/anon/package.json': '{}',
    });
    const roots = ['node_modules/zod', 'node_modules/apache-thing', 'node_modules/format', 'node_modules/base64-js', 'node_modules/linebreak/node_modules/base64-js', 'node_modules/anon'];
    expect(await collectPackageNotices('/p', roots, fs)).toEqual([
      { name: 'apache-thing', version: '1.2.3', license: 'Apache-2.0', root: 'node_modules/apache-thing', files: ['LICENSE.txt', 'NOTICE'], text: 'Apache\n\nNotice' },
      { name: 'base64-js', version: '1.5.1', license: 'no declarada', root: 'node_modules/base64-js', files: ['LICENCE.md'], text: 'Licencia' },
      { name: 'base64-js', version: '0.0.8', license: 'no declarada', root: 'node_modules/linebreak/node_modules/base64-js', files: ['COPYING'], text: 'Copia' },
      { name: 'format', version: '0.2.2', license: 'MIT', root: 'node_modules/format', files: [], text: undefined },
      { name: 'node_modules/anon', version: 'sin versión', license: 'no declarada', root: 'node_modules/anon', files: [], text: undefined },
      { name: 'zod', version: '4.0.0', license: 'MIT', root: 'node_modules/zod', files: ['LICENSE'], text: 'MIT License\n\nCopyright (c) Colin' },
    ]);
  });
});

describe('licencia de Node.js', () => {
  it('busca junto al ejecutable (distribución oficial), en las rutas de las distribuciones Linux y, antes que nada, donde diga CHAMELEON_NODE_LICENSE', () => {
    expect(nodeLicenseCandidates('/opt/node/bin/node', {})).toEqual(['/opt/node/LICENSE', '/usr/share/licenses/nodejs/LICENSE', '/usr/share/doc/nodejs/copyright']);
    expect(nodeLicenseCandidates('/usr/bin/node', { CHAMELEON_NODE_LICENSE: '/tmp/LICENSE' })[0]).toBe('/tmp/LICENSE');
    expect(nodeLicenseCandidates('/usr/bin/node', { CHAMELEON_NODE_LICENSE: '' })).toHaveLength(3);
  });

  it('devuelve el primer candidato legible, o undefined', async () => {
    const fs = new MemoryFileSystem({ '/usr/share/licenses/nodejs/LICENSE': '  Node.js is licensed…\n' });
    expect(await findNodeLicense(['/usr/LICENSE', '/usr/share/licenses/nodejs/LICENSE'], fs)).toEqual({ path: '/usr/share/licenses/nodejs/LICENSE', text: 'Node.js is licensed…' });
    expect(await findNodeLicense(['/nada'], fs)).toBeUndefined();
  });
});

describe('renderNotices', () => {
  const fonts = [{ name: 'Source Sans 3', license: 'SIL Open Font License 1.1', file: 'LICENSE-SourceSans3.md' }];
  const withText: PackageNotice = { name: 'a', version: '1.0.0', license: 'MIT', root: 'node_modules/a', files: ['LICENSE'], text: 'Texto A' };
  const withoutText: PackageNotice = { name: 'b', version: '2.0.0', license: 'ISC', root: 'node_modules/b', files: [], text: undefined };

  it('produce un Markdown determinista con el resumen, Node.js, cada paquete (o el aviso de que no incluye texto) y las fuentes', () => {
    const input = { product: { name: 'Chameleon CV', version: '1.0.0', license: 'MIT' }, node: { version: 'v26.7.0', text: 'Node text' }, packages: [withText, withoutText], fonts };
    const expected = `# Avisos de licencias de terceros

Chameleon CV 1.0.0 se distribuye bajo la licencia MIT (fichero \`LICENSE\`). El ejecutable incorpora software de terceros que conserva su propia licencia y sus avisos:

- **Node.js v26.7.0**, el runtime embebido en el ejecutable (§1).
- **2 paquetes npm** unidos al código de la aplicación (§2), por orden alfabético: de cada uno, el identificador de licencia que declara su \`package.json\` y el texto de licencia incluido en el paquete (1 sin texto en el paquete: se indica solo su identificador).
- **Source Sans 3** (fuente tipográfica): SIL Open Font License 1.1, fichero \`LICENSE-SourceSans3.md\`.

Typst no forma parte de este archivo: \`cv typst install\` lo descarga, solo cuando el usuario lo pide, desde su release oficial (licencia Apache-2.0) y lo verifica por SHA-256.

## 1. Node.js v26.7.0

Node text

## 2. Paquetes npm

### a 1.0.0 — MIT

Texto A

### b 2.0.0 — ISC

El paquete npm no incluye el texto de su licencia; identificador declarado en \`package.json\`: ISC.
`;
    expect(renderNotices(input)).toBe(expected);
    expect(renderNotices(input)).toBe(renderNotices({ ...input, packages: [withText, withoutText] }));
  });

  it('omite la coletilla de paquetes sin texto cuando todos lo incluyen', () => {
    const output = renderNotices({ product: { name: 'X', version: '0.1.0', license: 'MIT' }, node: { version: 'v26.7.0', text: 'N' }, packages: [withText], fonts: [] });
    expect(output).toContain('- **1 paquetes npm** unidos al código de la aplicación (§2), por orden alfabético: de cada uno, el identificador de licencia que declara su `package.json` y el texto de licencia incluido en el paquete.\n\nTypst');
    expect(output).not.toContain('sin texto en el paquete');
  });
});
