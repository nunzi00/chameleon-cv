/**
 * Ejecutor del banco de pruebas de aceptación (T-5.5.1: modo `--update`, que genera los artefactos
 * esperados; T-5.5.2 añade la comparación). Ejecuta el **binario compilado** (`dist/index.js`) en
 * una copia temporal del banco, con un entorno mínimo y determinista (PATH vacío, HOME y XDG
 * dentro de la copia, TZ=UTC), y captura la salida estándar, la de error y el código de cada
 * paso, normalizando las rutas volátiles (`<WS>`, `<REPO>`, `<TYPST>`).
 */
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

import { locateTypst } from '../../src/renderers/typst';
import { SCENARIOS, type Scenario, type Step } from './cases';

export const REPO_ROOT = resolve(__dirname, '..', '..');
export const CLI_PATH = join(REPO_ROOT, 'dist', 'index.js');
export const BENCH_WORKSPACE = join(__dirname, 'bench', 'workspace');
export const EXPECTED_DIRECTORY = join(__dirname, 'bench', 'expected');

export interface RunnerOptions {
  readonly update: boolean;
  /** Solo los escenarios cuyo id coincida. */
  readonly only?: readonly string[] | undefined;
}

export type Replacement = readonly [from: string, to: string];

/** Sustituye las rutas volátiles por marcadores estables, las más largas primero. */
export function normalize(text: string, replacements: readonly Replacement[]): string {
  let result = text;
  for (const [from, to] of [...replacements].sort((a, b) => b[0].length - a[0].length)) {
    result = result.split(from).join(to);
  }
  return result;
}

export function stepPrefix(index: number, step: Step): string {
  return `${String(index + 1).padStart(2, '0')}-${step.id}`;
}

async function copyOutput(workspace: string, target: string, path: string): Promise<void> {
  const source = join(workspace, path);
  const destination = join(target, 'files', path);
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export interface ScenarioResult {
  readonly id: string;
  readonly status: 'ok' | 'skipped' | 'failed';
  readonly steps: number;
  readonly message?: string | undefined;
}

export async function runScenario(scenario: Scenario, options: RunnerOptions, typst: string | undefined): Promise<ScenarioResult> {
  if (scenario.requires === 'typst' && typst === undefined) {
    return { id: scenario.id, status: 'skipped', steps: 0, message: 'sin binario de Typst (cv typst install o CHAMELEON_TYPST)' };
  }
  const root = await mkdtemp(join(tmpdir(), 'cv-acceptance-'));
  try {
    const workspace = join(root, 'ws');
    const home = join(root, 'home');
    const bin = join(root, 'bin');
    await mkdir(bin, { recursive: true });
    await mkdir(home, { recursive: true });
    if (scenario.workspace === 'bench') {
      await cp(BENCH_WORKSPACE, workspace, { recursive: true });
    } else {
      await mkdir(workspace, { recursive: true });
    }
    const env: Record<string, string> = {
      PATH: bin,
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_CACHE_HOME: join(home, '.cache'),
      TZ: 'UTC',
      LANG: 'C.UTF-8',
      ...(scenario.requires === 'typst' && typst !== undefined ? { CHAMELEON_TYPST: typst } : {}),
    };
    const replacements: Replacement[] = [[workspace, '<WS>'], [root, '<TMP>'], [REPO_ROOT, '<REPO>'], ...(typst === undefined ? [] : [[typst, '<TYPST>'] as Replacement])];
    const target = join(EXPECTED_DIRECTORY, scenario.id);
    if (options.update) {
      await rm(target, { recursive: true, force: true });
      await mkdir(target, { recursive: true });
    }
    for (const [index, step] of scenario.steps.entries()) {
      const prefix = stepPrefix(index, step);
      const result = spawnSync(process.execPath, [CLI_PATH, ...step.args], {
        cwd: workspace,
        env: { ...env, ...step.env },
        input: step.stdin ?? '',
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      const status = result.status ?? -1;
      if (status !== step.exitCode) {
        return { id: scenario.id, status: 'failed', steps: index, message: `${prefix}: código ${status}, se esperaba ${step.exitCode}\n${result.stderr}${result.stdout}`.trimEnd() };
      }
      for (const output of step.outputs ?? []) {
        if (!(await exists(join(workspace, output.path)))) {
          return { id: scenario.id, status: 'failed', steps: index, message: `${prefix}: no se produjo ${output.path}` };
        }
      }
      if (options.update) {
        await writeFile(join(target, `${prefix}.exit.txt`), `${status}\n`);
        await writeFile(join(target, `${prefix}.stdout.txt`), normalize(result.stdout, replacements));
        await writeFile(join(target, `${prefix}.stderr.txt`), normalize(result.stderr, replacements));
        for (const output of step.outputs ?? []) {
          await copyOutput(workspace, target, output.path);
        }
      }
    }
    return { id: scenario.id, status: 'ok', steps: scenario.steps.length };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function typstBinary(): Promise<string | undefined> {
  const located = await locateTypst({ env: process.env });
  return located?.path;
}

export async function runAll(options: RunnerOptions): Promise<ScenarioResult[]> {
  if (!(await exists(CLI_PATH))) {
    throw new Error(`No existe ${CLI_PATH}: compila antes con «npm run build»`);
  }
  const typst = await typstBinary();
  const results: ScenarioResult[] = [];
  for (const scenario of SCENARIOS) {
    if (options.only !== undefined && !options.only.includes(scenario.id)) {
      continue;
    }
    const started = Date.now();
    const result = await runScenario(scenario, options, typst);
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const label = result.status === 'ok' ? `${result.steps} pasos` : result.status === 'skipped' ? `omitido: ${result.message ?? ''}` : `FALLO en el paso ${result.steps + 1}`;
    console.log(`${result.status === 'failed' ? '✗' : result.status === 'skipped' ? '·' : '✓'} ${scenario.id}: ${label} (${elapsed} s)`);
    if (result.status === 'failed') {
      console.log(`  ${(result.message ?? '').split('\n').join('\n  ')}`);
    }
    results.push(result);
  }
  return results;
}

/** Inventario legible de los artefactos esperados de un escenario (para el README y para T-5.5.2). */
export async function listExpected(scenarioId: string): Promise<string[]> {
  const directory = join(EXPECTED_DIRECTORY, scenarioId);
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => relative(directory, join(entry.parentPath, entry.name))).sort((a, b) => a.localeCompare(b, 'en'));
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const update = args.includes('--update');
  const only = args.filter((arg) => !arg.startsWith('--'));
  runAll({ update, only: only.length === 0 ? undefined : only })
    .then((results) => {
      const failed = results.filter((result) => result.status === 'failed').length;
      const skipped = results.filter((result) => result.status === 'skipped').length;
      console.log(`${results.length - failed - skipped} escenarios ${update ? 'generados' : 'ejecutados'} · ${skipped} omitidos · ${failed} fallidos`);
      process.exitCode = failed === 0 ? 0 : 1;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
