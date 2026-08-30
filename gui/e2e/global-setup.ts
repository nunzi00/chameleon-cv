import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startLlmStub } from './llm-stub';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
export const STATE_FILE = join(HERE, '.state.json');

export interface ServerState {
  readonly url: string;
  readonly token: string;
  readonly workspace: string;
  /** El doble del proveedor de IA que cv serve usa como proveedor local. */
  readonly llm: string;
}

/** `cv` bajo prueba: el ejecutable de CV_BINARY o dist/index.js con el Node actual. */
function cvCommand(): readonly string[] {
  const binary = process.env['CV_BINARY'];
  // Relativo a la raíz del repositorio (npm --prefix gui ejecuta en gui/): CV_BINARY=build/sea/cv funciona desde la raíz.
  return binary === undefined || binary === '' ? [process.execPath, join(ROOT, 'dist', 'index.js')] : [resolve(ROOT, binary)];
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const llm = await startLlmStub();
  const temporary = mkdtempSync(join(tmpdir(), 'cv-gui-e2e-'));
  const workspace = join(temporary, 'work');
  const home = join(temporary, 'home');
  mkdirSync(workspace);
  mkdirSync(home);
  // El co-piloto local se configura en cv.toml (T-8.2): así la pantalla Ajustes edita lo que el servidor usa.
  writeFileSync(join(workspace, 'cv.toml'), `[llm]\nprovider = "openai-compatible"\nbase_url = "${llm.url}"\nmodel = "${llm.model}"\n`, { mode: 0o600 });

  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_CACHE_HOME: join(home, '.cache'),
    TZ: 'UTC',
    LANG: 'C.UTF-8',
    // El co-piloto habla con el doble local (compatible con OpenAI), en el loopback.
    ...(process.env['CHAMELEON_TYPST'] === undefined ? {} : { CHAMELEON_TYPST: process.env['CHAMELEON_TYPST'] }),
  };
  const [command = '', ...leading] = cvCommand();
  for (const args of [['init'], ['build']]) {
    const result = spawnSync(command, [...leading, ...args], { cwd: workspace, env, encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`cv ${args.join(' ')} falló: ${result.stderr}${result.stdout}`);
    }
  }
  mkdirSync(join(workspace, 'ofertas'));
  cpSync(join(ROOT, 'tests', 'acceptance', 'bench', 'workspace', 'offers', 'nexo-senior-backend.txt'), join(workspace, 'ofertas', 'nexo.txt'));
  // Un tema de la comunidad del banco (T-8.3) para «Instalar tema…» sin red.
  mkdirSync(join(workspace, 'themes'), { recursive: true });
  cpSync(join(ROOT, 'tests', 'acceptance', 'bench', 'workspace', 'themes', 'comunidad.zip'), join(workspace, 'themes', 'comunidad.zip'));

  const child = spawn(command, [...leading, 'serve', '--port', '0'], { cwd: workspace, env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  const started = await new Promise<ServerState>((resolvePromise, reject) => {
    const deadline = setTimeout(() => reject(new Error(`cv serve no arrancó en 20 s\n${stderr}`)), 20_000);
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      const match = /Interfaz: (http:\/\/127\.0\.0\.1:\d+\/)#token=(\S+)/.exec(stderr);
      if (match !== null) {
        clearTimeout(deadline);
        resolvePromise({ url: String(match[1]), token: String(match[2]), workspace, llm: llm.url });
      }
    });
    child.once('exit', (code) => {
      clearTimeout(deadline);
      reject(new Error(`cv serve terminó con ${code}\n${stderr}`));
    });
  });
  writeFileSync(STATE_FILE, JSON.stringify(started));
  return async () => {
    child.kill();
    await llm.close();
    rmSync(STATE_FILE, { force: true });
    rmSync(temporary, { recursive: true, force: true });
  };
}
