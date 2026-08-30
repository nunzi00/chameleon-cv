/**
 * Empaquetado del ejecutable autónomo (T-6.2 S4 y T-6.6, `docs/packaging-and-release.md` §5): compilación
 * limpia, bundles de la CLI y del worker (esbuild), manifiesto de assets con SHA-256, `sea-config`,
 * `node --build-sea` sobre el Node oficial del proceso, prueba de humo del binario producido, avisos de
 * licencias de terceros (lo que de verdad contiene el bundle, más Node.js y las fuentes) y archivo
 * reproducible con la licencia, el registro de cambios y esos avisos. Plataforma = la de esta máquina (referencia: linux-x64).
 *
 *   npm run package            # build/release/chameleon-cv-<versión>-<os>-<arch>.tar.gz (+ SHA-256)
 *   npm run package -- --no-smoke   # sin prueba de humo (solo para depurar el empaquetado)
 */
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { build, type Plugin } from 'esbuild';

import { NodeFileSystem } from '../src/parsers';
import { collectPackageNotices, findNodeLicense, nodeLicenseCandidates, packageRootsFromInputs, renderNotices } from '../src/release/notices';

const ROOT = resolve(__dirname, '..');
const BUILD = join(ROOT, 'build', 'sea');
const RELEASE = join(ROOT, 'build', 'release');
const PLATFORM = `${process.platform}-${process.arch}`;
const EXECUTABLE = process.platform === 'win32' ? 'cv.exe' : 'cv';

/** Prefijos de assets que viajan en el binario (claves = rutas del repositorio). */
const ASSET_ROOTS = ['themes', 'templates/fonts', 'templates/dataset', 'prompts', 'gui/dist'] as const;
const ASSET_FILES = ['package.json', 'templates/cv.md.hbs'] as const;

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

function fail(message: string): never {
  process.stderr.write(`\n✗ ${message}\n`);
  process.exit(1);
}

function run(file: string, args: readonly string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {}): SpawnSyncReturns<string> {
  return spawnSync(file, args, { cwd: options.cwd ?? ROOT, env: options.env ?? process.env, input: options.input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function listFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * pdfkit carga sus fuentes estándar (Courier, Helvetica…) con un `require` indirecto que esbuild no puede seguir y que en el
 * ejecutable fallaría (no hay node_modules): se reescriben como `require` estáticos y esbuild los resuelve por el mapa
 * `imports` de pdfkit (`#standard-fonts/*` → `js/standard-fonts/*.cjs`), embebiendo los datos en el bundle.
 */
const pdfkitStandardFonts: Plugin = {
  name: 'pdfkit-standard-fonts',
  setup(build) {
    build.onLoad({ filter: /pdfkit[\\/]js[\\/]pdfkit\.js$/ }, (args) => ({
      contents: readFileSync(args.path, 'utf8').replace(/require\$1\('#standard-fonts\//g, "require('#standard-fonts/"),
      loader: 'js',
      resolveDir: dirname(args.path),
    }));
  },
};

function step(title: string): void {
  log(`\n▸ ${title}`);
}

/** `cv serve` desde el binario: la interfaz web viaja dentro (GET / con el HTML de la SPA) y la API responde con el token. */
async function smokeServe(executable: string, cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  const child = spawn(executable, ['serve', '--port', '0'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  const started = await new Promise<{ url: string; token: string } | undefined>((resolve) => {
    const deadline = setTimeout(() => resolve(undefined), 15000);
    const check = (): void => {
      const match = /Interfaz: (http:\/\/127\.0\.0\.1:\d+\/)#token=(\S+)/.exec(stderr);
      if (match !== null) {
        clearTimeout(deadline);
        resolve({ url: String(match[1]), token: String(match[2]) });
      }
    };
    child.stderr.on('data', check);
    child.on('exit', () => {
      clearTimeout(deadline);
      resolve(undefined);
    });
  });
  if (started === undefined) {
    child.kill();
    fail(`humo: «cv serve» no anunció la interfaz en 15 s\n${stderr}`);
  }
  try {
    const page = await fetch(started.url);
    const html = await page.text();
    if (page.status !== 200 || !html.includes('<script type="module"')) {
      fail(`humo: GET / devolvió ${page.status} sin la interfaz web`);
    }
    const status = await fetch(`${started.url}api/v1/status`, { headers: { Authorization: `Bearer ${started.token}` } });
    if (status.status !== 200) {
      fail(`humo: GET /api/v1/status devolvió ${status.status}`);
    }
    await fetch(`${started.url}api/v1/shutdown`, { method: 'POST', headers: { Authorization: `Bearer ${started.token}`, 'Content-Type': 'application/json' }, body: '{}' });
    log('  ✓ cv serve: la interfaz web viaja en el binario y la API responde con el token');
  } finally {
    child.kill();
  }
}

async function main(): Promise<void> {
  const started = Date.now();
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 26) {
    fail(`Se requiere Node ≥ 26 para «node --build-sea» (este proceso: ${process.version}); Node 24 exigiría --experimental-sea-config + postject`);
  }
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string; license: string };
  const version = manifest.version;
  const smoke = !process.argv.includes('--no-smoke');
  log(`Empaquetado de Chameleon CV ${version} para ${PLATFORM} con Node ${process.version} (${process.execPath})`);

  step('1/8 Compilación limpia (tsc)');
  rmSync(join(ROOT, 'dist'), { recursive: true, force: true });
  const tsc = run(process.execPath, [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json']);
  if (tsc.status !== 0) {
    fail(`tsc falló:\n${tsc.stdout}${tsc.stderr}`);
  }
  rmSync(BUILD, { recursive: true, force: true });
  mkdirSync(BUILD, { recursive: true });

  step('2/8 Bundles (esbuild): CLI y worker de PDF');
  const common = { bundle: true, platform: 'node' as const, format: 'cjs' as const, target: 'node26', external: ['@napi-rs/canvas', 'canvas'], logLevel: 'warning' as const, legalComments: 'none' as const, plugins: [pdfkitStandardFonts], absWorkingDir: ROOT, metafile: true as const };
  const cli = await build({ ...common, entryPoints: [join(ROOT, 'dist', 'index.js')], outfile: join(BUILD, 'cv.cjs') });
  const worker = await build({ ...common, entryPoints: [join(ROOT, 'src', 'pdf', 'worker.mts')], outfile: join(BUILD, 'worker.js') });
  log(`  cv.cjs ${megabytes(statSync(join(BUILD, 'cv.cjs')).size)} · worker.js ${megabytes(statSync(join(BUILD, 'worker.js')).size)}`);

  step('3/8 Interfaz web (gui/dist: la SPA que cv serve sirve desde el ejecutable)');
  if (!existsSync(join(ROOT, 'gui', 'node_modules'))) {
    fail('faltan las dependencias de la interfaz web: ejecuta «npm ci --prefix gui»');
  }
  const gui = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--prefix', 'gui', 'run', 'build'], { cwd: ROOT });
  if (gui.status !== 0) {
    fail(`la construcción de la interfaz web falló:\n${gui.stderr}${gui.stdout}`);
  }
  const guiFiles = listFiles(join(ROOT, 'gui', 'dist'));
  log(`  gui/dist: ${guiFiles.length} ficheros, ${megabytes(guiFiles.reduce((sum, file) => sum + statSync(join(ROOT, 'gui', 'dist', file)).size, 0))}`);

  step('4/8 Manifiesto de assets (SHA-256) y sea-config');
  const assets: Record<string, string> = {};
  const files: Record<string, { sha256: string; bytes: number }> = {};
  const add = (key: string, path: string): void => {
    const bytes = readFileSync(path);
    assets[key] = path;
    files[key] = { sha256: sha256(bytes), bytes: bytes.byteLength };
  };
  for (const prefix of ASSET_ROOTS) {
    for (const file of listFiles(join(ROOT, prefix))) {
      add(`${prefix}/${file}`, join(ROOT, prefix, file));
    }
  }
  for (const file of ASSET_FILES) {
    add(file, join(ROOT, file));
  }
  add('worker.js', join(BUILD, 'worker.js'));
  const manifestPath = join(BUILD, 'assets-manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify({ version, files }, null, 2)}\n`);
  assets['assets-manifest.json'] = manifestPath;
  const total = Object.values(files).reduce((sum, file) => sum + file.bytes, 0);
  log(`  ${Object.keys(files).length} assets, ${megabytes(total)} (manifiesto incluido)`);
  const config = { main: 'cv.cjs', output: EXECUTABLE, disableExperimentalSEAWarning: true, useCodeCache: true, assets };
  writeFileSync(join(BUILD, 'sea-config.json'), `${JSON.stringify(config, null, 2)}\n`);

  step('5/8 Ejecutable (node --build-sea)');
  const sea = run(process.execPath, ['--build-sea=sea-config.json'], { cwd: BUILD });
  if (sea.status !== 0) {
    fail(`node --build-sea falló:\n${sea.stdout}${sea.stderr}`);
  }
  const executable = join(BUILD, EXECUTABLE);
  chmodSync(executable, 0o755);
  if (process.platform === 'darwin') {
    const sign = run('codesign', ['--sign', '-', executable]);
    if (sign.status !== 0) {
      fail(`codesign falló:\n${sign.stderr}`);
    }
  }
  log(`  ${executable} ${megabytes(statSync(executable).size)}`);

  if (smoke) {
    step('6/8 Prueba de humo del binario (espacio temporal, entorno mínimo)');
    const temporary = mkdtempSync(join(tmpdir(), 'cv-package-smoke-'));
    try {
      const workspace = join(temporary, 'ws');
      const home = join(temporary, 'home');
      const bin = join(temporary, 'bin');
      mkdirSync(workspace);
      mkdirSync(home);
      mkdirSync(bin);
      const env: NodeJS.ProcessEnv = { PATH: bin, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), TZ: 'UTC', LANG: 'C.UTF-8', ...(process.env['CHAMELEON_TYPST'] === undefined ? {} : { CHAMELEON_TYPST: process.env['CHAMELEON_TYPST'] }) };
      // El banco de pruebas como proyecto: tiene código en línea (fuente estándar Courier de pdfkit), ofertas en PDF y temas propios.
      const bench = join(ROOT, 'tests', 'acceptance', 'bench', 'workspace');
      cpSync(join(bench, 'data', 'sources'), join(workspace, 'data', 'sources'), { recursive: true });
      cpSync(join(bench, 'offers', 'pdf', 'nexo-senior-backend.pdf'), join(workspace, 'oferta.pdf'));
      mkdirSync(join(workspace, 'themes'));
      cpSync(join(bench, 'themes', 'comunidad.zip'), join(workspace, 'themes', 'comunidad.zip'));
      const empty = join(temporary, 'vacio');
      mkdirSync(empty);
      const cases: Array<{ readonly args: readonly string[]; readonly cwd?: string; readonly expectStdout?: string; readonly expectFile?: string }> = [
        { args: ['--version'], expectStdout: `${version}\n` },
        { args: ['init'], cwd: empty, expectFile: 'data/sources/profile.md' },
        { args: ['build'], expectFile: 'data/dist/profile.json' },
        { args: ['generate-cv', '-s', 'backend', '-o', 'output/cv.md'], expectFile: 'output/cv.md' },
        { args: ['generate-cv', '-s', 'backend', '--format', 'pdf', '-o', 'output/cv.pdf'], expectFile: 'output/cv.pdf' },
        { args: ['analyze-offer', 'oferta.pdf', '-s', 'backend'] },
        { args: ['theme', 'list'] },
        // T-8.3: el instalador lee la versión de los assets; desde fuera del repositorio no hay package.json en disco (defecto de la 1.6.0).
        { args: ['theme', 'install', 'themes/comunidad.zip', '--dry-run'] },
        { args: ['theme', 'install', 'themes/comunidad.zip'], expectFile: 'themes/comunidad/.origin.json' },
        { args: ['theme', 'verify', 'comunidad'] },
        { args: ['improve', '--show-prompt'] },
        ...(env['CHAMELEON_TYPST'] === undefined ? [] : [{ args: ['generate-cv', '-s', 'backend', '--format', 'pdf', '--engine', 'typst', '--theme', 'classic', '-o', 'output/typst.pdf'], expectFile: 'output/typst.pdf' }]),
      ];
      for (const item of cases) {
        const result = run(executable, item.args, { cwd: item.cwd ?? workspace, env });
        const label = `cv ${item.args.join(' ')}`;
        if (result.status !== 0) {
          fail(`humo: «${label}» terminó con ${result.status}\n${result.stderr}${result.stdout}`);
        }
        if (item.expectStdout !== undefined && result.stdout !== item.expectStdout) {
          fail(`humo: «${label}» imprimió ${JSON.stringify(result.stdout)} y se esperaba ${JSON.stringify(item.expectStdout)}`);
        }
        if (item.expectFile !== undefined && !existsSync(join(item.cwd ?? workspace, item.expectFile))) {
          fail(`humo: «${label}» no produjo ${item.expectFile}`);
        }
        log(`  ✓ ${label}`);
      }
      log(`  (Typst ${env['CHAMELEON_TYPST'] === undefined ? 'no disponible: caso omitido' : 'probado'})`);
      await smokeServe(executable, workspace, env);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  } else {
    step('6/8 Prueba de humo omitida (--no-smoke)');
  }

  step('7/8 Avisos de licencias de terceros (THIRD-PARTY-NOTICES.md)');
  const fs = new NodeFileSystem();
  const packages = await collectPackageNotices(ROOT, packageRootsFromInputs([...Object.keys(cli.metafile.inputs), ...Object.keys(worker.metafile.inputs)]), fs);
  const node = await findNodeLicense(nodeLicenseCandidates(process.execPath, process.env), fs);
  if (node === undefined) {
    fail(`No se encuentra el texto de la licencia de Node.js ${process.version} (buscado junto a ${process.execPath} y en las rutas de las distribuciones Linux): indícalo con CHAMELEON_NODE_LICENSE=<ruta> o empaqueta con una distribución oficial de Node`);
  }
  const undeclared = packages.filter((item) => item.text === undefined && item.license === 'no declarada');
  if (undeclared.length > 0) {
    fail(`Paquetes sin licencia declarada ni texto de licencia: ${undeclared.map((item) => `${item.name}@${item.version}`).join(', ')}`);
  }
  const notices = renderNotices({ product: { name: 'Chameleon CV', version, license: manifest.license }, node: { version: process.version, text: node.text }, packages, fonts: [{ name: 'Source Sans 3', license: 'SIL Open Font License 1.1', file: 'LICENSE-SourceSans3.md' }] });
  writeFileSync(join(BUILD, 'THIRD-PARTY-NOTICES.md'), notices);
  log(`  ${packages.length} paquetes npm (${packages.filter((item) => item.text === undefined).length} sin texto en el paquete) · Node.js ${process.version} (${node.path})`);

  step('8/8 Archivo reproducible');
  mkdirSync(RELEASE, { recursive: true });
  const name = `chameleon-cv-${version}-${PLATFORM}`;
  const stage = join(RELEASE, 'stage', name);
  rmSync(join(RELEASE, 'stage'), { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  cpSync(executable, join(stage, EXECUTABLE));
  chmodSync(join(stage, EXECUTABLE), 0o755);
  cpSync(join(ROOT, 'README.md'), join(stage, 'README.md'));
  cpSync(join(ROOT, 'templates', 'fonts', 'LICENSE-SourceSans3.md'), join(stage, 'LICENSE-SourceSans3.md'));
  cpSync(join(ROOT, 'LICENSE'), join(stage, 'LICENSE'));
  cpSync(join(ROOT, 'CHANGELOG.md'), join(stage, 'CHANGELOG.md'));
  cpSync(join(BUILD, 'THIRD-PARTY-NOTICES.md'), join(stage, 'THIRD-PARTY-NOTICES.md'));
  const archive = join(RELEASE, `${name}.tar.gz`);
  rmSync(archive, { force: true });
  // GNU tar con orden y fechas fijas + gzip sin nombre ni fecha: el mismo contenido produce el mismo archivo.
  const tar = spawnSync('sh', ['-c', `tar --sort=name --mtime='2000-01-01 00:00Z' --owner=0 --group=0 --numeric-owner -cf - -C "${join(RELEASE, 'stage')}" "${name}" | gzip -n -9 > "${archive}"`], { encoding: 'utf8' });
  if (tar.status !== 0) {
    fail(`tar falló:\n${tar.stderr}`);
  }
  rmSync(join(RELEASE, 'stage'), { recursive: true, force: true });
  const digest = sha256(readFileSync(archive));
  writeFileSync(`${archive}.sha256`, `${digest}  ${name}.tar.gz\n`);
  log(`  ${archive} ${megabytes(statSync(archive).size)}\n  sha256 ${digest}`);
  log(`\nListo en ${((Date.now() - started) / 1000).toFixed(1)} s.`);
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
