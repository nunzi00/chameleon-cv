/**
 * Sincronización de los ficheros que el portal publica desde su ubicación original (T-7.1,
 * docs/docs-portal.md §4.4): las notas de diseño docs/*.md, CHANGELOG.md, CONTRIBUTING.md, ROADMAP.md y
 * LICENSE se copian a website/src/ (no versionado) reescribiendo los enlaces relativos: páginas del
 * portal para lo que el portal publica y el repositorio en GitHub para el resto de ficheros.
 *
 *   npm run docs:generate
 */
import { existsSync, globSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const SRC = join(ROOT, 'website', 'src');
/** Única fuente de verdad del repositorio: package.json (repository.url). */
const REPO = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { repository: { url: string } }).repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
const REPO_SLUG = REPO.replace('https://github.com/', '');

/** Ficheros que el portal publica como páginas propias (ruta del repositorio → ruta del sitio). */
const PAGES: Readonly<Record<string, string>> = {
  'README.md': '/',
  'CHANGELOG.md': '/changelog',
  'CONTRIBUTING.md': '/developers/contributing',
  'ROADMAP.md': '/developers/roadmap',
  'LICENSE': '/license',
};

export function siteLink(repoPath: string): string | undefined {
  const page = PAGES[repoPath];
  if (page !== undefined) {
    return page;
  }
  const note = /^docs\/([^/]+)\.md$/.exec(repoPath);
  return note === null ? undefined : `/design/${String(note[1])}`;
}

/** Reescribe los enlaces relativos de un Markdown que vive en `sourceDir` (absoluto) para publicarlo en el portal. */
export function rewriteLinks(markdown: string, sourceDir: string, warn: (message: string) => void): string {
  let fenced = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      return fenced ? line : rewriteLine(line, sourceDir, warn);
    })
    .join('\n');
}

/** Reescribe los enlaces de una línea de prosa; los que están dentro de código en línea se dejan tal cual. */
function rewriteLine(line: string, sourceDir: string, warn: (message: string) => void): string {
  return line.replace(/(\[[^\]]*\]\()([^)\s]+)(\))/g, (whole, open: string, target: string, close: string, offset: number) => {
    const insideCode = (line.slice(0, offset).match(/`/g) ?? []).length % 2 === 1;
    if (insideCode || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('/')) {
      return whole;
    }
    const [pathPart = '', anchor] = target.split('#', 2);
    const suffix = anchor === undefined ? '' : `#${anchor}`;
    const candidates = [resolve(sourceDir, pathPart), resolve(ROOT, pathPart)];
    const found = candidates.find((candidate) => existsSync(candidate));
    if (found === undefined) {
      warn(`enlace sin destino: ${target}`);
      return whole;
    }
    const repoPath = relative(ROOT, found).split('\\').join('/');
    const page = siteLink(repoPath);
    if (page !== undefined) {
      return `${open}${page}${suffix}${close}`;
    }
    const kind = statSync(found).isDirectory() ? 'tree' : 'blob';
    return `${open}${REPO}/${kind}/main/${repoPath}${suffix}${close}`;
  });
}

function title(markdown: string): string {
  const heading = /^# (.+)$/m.exec(markdown);
  return heading === null ? 'Sin título' : String(heading[1]).trim();
}

function status(markdown: string): string {
  const row = /^\| \*\*Estado\*\* \| (.+) \|$/m.exec(markdown);
  return row === null ? '' : String(row[1]).replace(/\*\*/g, '').trim();
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function main(): void {
  const warnings: string[] = [];
  const warn = (message: string): void => {
    warnings.push(message);
  };
  // Notas de diseño
  const design = join(SRC, 'design');
  rmSync(design, { recursive: true, force: true });
  const notes = readdirSync(join(ROOT, 'docs')).filter((name) => name.endsWith('.md')).sort();
  const entries: Array<{ name: string; title: string; status: string }> = [];
  for (const name of notes) {
    const source = readFileSync(join(ROOT, 'docs', name), 'utf8');
    write(join(design, name), rewriteLinks(source, join(ROOT, 'docs'), (message) => warn(`docs/${name}: ${message}`)));
    entries.push({ name: name.replace(/\.md$/, ''), title: title(source), status: status(source) });
  }
  const index = [
    '---',
    'title: Notas de diseño',
    '---',
    '# Notas de diseño',
    '',
    'Las notas técnicas del proyecto, publicadas tal cual desde `docs/` del repositorio: cada una recoge una propuesta, su aprobación por el Director de Ingeniería y el estado de su implementación. Son la memoria de las decisiones; la guía de usuario es la puerta de entrada.',
    '',
    '| Nota | Estado |',
    '|---|---|',
    ...entries.map((entry) => `| [${entry.title}](./${entry.name}) | ${entry.status.replace(/\|/g, '\\|')} |`),
    '',
  ];
  write(join(design, 'index.md'), index.join('\n'));
  write(join(ROOT, 'website', '.vitepress', 'design-sidebar.json'), `${JSON.stringify([{ text: 'Notas de diseño', items: [{ text: 'Índice', link: '/design/' }, ...entries.map((entry) => ({ text: entry.title, link: `/design/${entry.name}` }))] }], null, 2)}\n`);
  // Ficheros de la raíz
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  write(join(SRC, 'changelog.md'), rewriteLinks(changelog, ROOT, (message) => warn(`CHANGELOG.md: ${message}`)));
  const roadmap = readFileSync(join(ROOT, 'ROADMAP.md'), 'utf8');
  write(join(SRC, 'developers', 'roadmap.md'), rewriteLinks(roadmap, ROOT, (message) => warn(`ROADMAP.md: ${message}`)));
  const contributing = readFileSync(join(ROOT, 'CONTRIBUTING.md'), 'utf8');
  write(join(SRC, 'developers', 'contributing.md'), rewriteLinks(contributing, ROOT, (message) => warn(`CONTRIBUTING.md: ${message}`)));
  const license = readFileSync(join(ROOT, 'LICENSE'), 'utf8').replace(/^MIT License\n\n/, '');
  write(join(SRC, 'license.md'), ['---', 'title: Licencia', '---', '# Licencia', '', 'Chameleon CV es software libre bajo la licencia MIT. Las fuentes Source Sans 3 se distribuyen bajo la SIL Open Font License 1.1 ([`templates/fonts/LICENSE-SourceSans3.md`](' + REPO + '/blob/main/templates/fonts/LICENSE-SourceSans3.md)). El ejecutable autónomo incorpora Node.js y paquetes npm de terceros: sus licencias y avisos van en el `THIRD-PARTY-NOTICES.md` de cada archivo de release. Typst se descarga aparte, solo a petición, desde su release oficial (Apache-2.0).', '', '## MIT License', '', license.trim(), ''].join('\n'));
  // Coherencia del nombre del repositorio: todo enlace a github.com/<propietario>/<…cham…> debe ser el de package.json.
  const scanned = [join(ROOT, 'README.md'), join(ROOT, 'CHANGELOG.md'), join(ROOT, 'CONTRIBUTING.md'), ...notes.map((name) => join(ROOT, 'docs', name)), ...globSync('**/*.md', { cwd: SRC }).map((name) => join(SRC, name)), ...globSync('.github/**/*.yml', { cwd: ROOT }).map((name) => join(ROOT, name))];
  for (const file of scanned) {
    for (const match of readFileSync(file, 'utf8').matchAll(/github\.com\/([\w.-]+\/[\w.-]*cham[\w.-]*)/gi)) {
      const slug = String(match[1]).replace(/\.git$/, '');
      if (slug !== REPO_SLUG) {
        warn(`${relative(ROOT, file)}: enlace a github.com/${slug}, pero package.json dice ${REPO_SLUG}`);
      }
    }
  }
  process.stdout.write(`Sincronizados: ${notes.length} notas de diseño, CHANGELOG, ROADMAP, CONTRIBUTING y LICENSE${warnings.length === 0 ? '' : `\n  avisos:\n  - ${warnings.join('\n  - ')}`}\n`);
  if (warnings.length > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
