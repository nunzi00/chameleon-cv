/**
 * Arnés de aceptación determinista (T-5.5.1 generación, T-5.5.2 comparación): ejecuta el **binario
 * compilado** (`dist/index.js`) sobre una copia temporal del banco de pruebas, con un entorno
 * mínimo y determinista (PATH vacío, HOME y XDG dentro de la copia, TZ=UTC), y exige que cada
 * paso reproduzca **exactamente** los artefactos esperados: código de salida, stdout y stderr
 * (con las rutas volátiles normalizadas: `<WS>`, `<TMP>`, `<REPO>`, `<TYPST>`) y los ficheros
 * producidos (byte a byte; los PDF, además, con el diff de su texto si difieren).
 *
 *   npm run test:acceptance:deterministic              # comparar (código 1 si algo difiere)
 *   npm run test:acceptance:deterministic -- --update  # regenerar los artefactos esperados (revisa el diff)
 *   … -- core typst          # solo esos escenarios · --require-typst: la omisión de Typst es un fallo
 *   … -- --keep              # conserva la copia temporal de cada escenario para inspeccionarla
 */
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

import { locateTypst } from '../../src/renderers/typst';
import { generateOfferPdfs, generateReviews } from './bench/generate';
import { SCENARIOS, type Scenario, type Step, type StepOutput } from './cases';
import { compareBytes, comparePdf, compareText, type Mismatch } from './compare';

export const REPO_ROOT = resolve(__dirname, '..', '..');
export const CLI_PATH = join(REPO_ROOT, 'dist', 'index.js');
export const BENCH_WORKSPACE = join(__dirname, 'bench', 'workspace');
export const EXPECTED_DIRECTORY = join(__dirname, 'bench', 'expected');

export interface RunnerOptions {
  /** Regenerar los artefactos esperados en lugar de compararlos. */
  readonly update: boolean;
  /** Solo los escenarios cuyo id coincida. */
  readonly only?: readonly string[] | undefined;
  /** Sin binario de Typst, el escenario `typst` es un fallo en lugar de una omisión. */
  readonly requireTypst?: boolean | undefined;
  /** Conservar la copia temporal (se imprime su ruta). */
  readonly keep?: boolean | undefined;
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

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** Compara un fichero producido con el esperado según su clase. */
async function compareFile(what: string, kind: StepOutput['kind'], expectedPath: string, actualPath: string): Promise<Mismatch | undefined> {
  if (!(await exists(expectedPath))) {
    return { what, detail: 'no hay artefacto esperado (regenera con --update y revisa el diff)' };
  }
  if (!(await exists(actualPath))) {
    return { what, detail: 'no se produjo el fichero' };
  }
  if (kind === 'pdf') {
    return comparePdf(what, await readFile(expectedPath), await readFile(actualPath));
  }
  const [expected, actual] = await Promise.all([readFile(expectedPath), readFile(actualPath)]);
  return kind === 'text' || kind === 'json' ? compareText(what, expected.toString('utf8'), actual.toString('utf8')) : compareBytes(what, expected, actual);
}

async function compareTree(what: string, expectedRoot: string, actualRoot: string): Promise<Mismatch[]> {
  if (!(await exists(expectedRoot))) {
    return [{ what, detail: 'no hay árbol esperado (regenera con --update)' }];
  }
  const expectedFiles = await listFiles(expectedRoot);
  const actualFiles = (await exists(actualRoot)) ? await listFiles(actualRoot) : [];
  const mismatches: Mismatch[] = [];
  for (const file of expectedFiles.filter((candidate) => !actualFiles.includes(candidate))) {
    mismatches.push({ what: `${what}/${file}`, detail: 'falta en lo producido' });
  }
  for (const file of actualFiles.filter((candidate) => !expectedFiles.includes(candidate))) {
    mismatches.push({ what: `${what}/${file}`, detail: 'fichero inesperado' });
  }
  for (const file of expectedFiles.filter((candidate) => actualFiles.includes(candidate))) {
    const mismatch = await compareFile(`${what}/${file}`, file.endsWith('.pdf') ? 'pdf' : 'text', join(expectedRoot, file), join(actualRoot, file));
    if (mismatch !== undefined) {
      mismatches.push(mismatch);
    }
  }
  return mismatches;
}

export interface StepResult {
  readonly prefix: string;
  readonly mismatches: readonly Mismatch[];
}

export interface ScenarioResult {
  readonly id: string;
  readonly status: 'ok' | 'skipped' | 'failed';
  /** Pasos ejecutados. */
  readonly steps: number;
  readonly failures: readonly StepResult[];
  readonly message?: string | undefined;
  readonly elapsedMs: number;
}

interface Context {
  readonly workspace: string;
  readonly env: Readonly<Record<string, string>>;
  readonly replacements: readonly Replacement[];
  readonly target: string;
}

async function runStep(context: Context, index: number, step: Step, options: RunnerOptions): Promise<StepResult> {
  const prefix = stepPrefix(index, step);
  const result = spawnSync(process.execPath, [CLI_PATH, ...step.args], {
    cwd: context.workspace,
    env: { ...context.env, ...step.env },
    input: step.stdin ?? '',
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const status = result.status ?? -1;
  const stdout = normalize(result.stdout, context.replacements);
  const stderr = normalize(result.stderr, context.replacements);
  const mismatches: Mismatch[] = [];
  if (status !== step.exitCode) {
    mismatches.push({ what: 'código de salida', detail: `${status} obtenido, ${step.exitCode} esperado\n${(stderr + stdout).trimEnd()}` });
    return { prefix, mismatches };
  }
  if (options.update) {
    await writeFile(join(context.target, `${prefix}.exit.txt`), `${status}\n`);
    await writeFile(join(context.target, `${prefix}.stdout.txt`), stdout);
    await writeFile(join(context.target, `${prefix}.stderr.txt`), stderr);
    for (const output of step.outputs ?? []) {
      const source = join(context.workspace, output.path);
      if (!(await exists(source))) {
        mismatches.push({ what: output.path, detail: 'no se produjo el fichero' });
        continue;
      }
      const destination = join(context.target, 'files', output.path);
      await mkdir(dirname(destination), { recursive: true });
      await cp(source, destination, { recursive: true });
    }
    return { prefix, mismatches };
  }
  const expectedExit = await readText(join(context.target, `${prefix}.exit.txt`));
  if (expectedExit === undefined) {
    return { prefix, mismatches: [{ what: 'artefactos esperados', detail: `no existen para ${prefix} (regenera con --update y revisa el diff)` }] };
  }
  if (expectedExit.trim() !== String(step.exitCode)) {
    mismatches.push({ what: 'código de salida registrado', detail: `${prefix}.exit.txt dice ${expectedExit.trim()} y el catálogo ${step.exitCode}: regenera con --update o corrige el catálogo` });
  }
  for (const [stream, actual] of [
    ['stdout', stdout],
    ['stderr', stderr],
  ] as const) {
    const mismatch = compareText(stream, (await readText(join(context.target, `${prefix}.${stream}.txt`))) ?? '', actual);
    if (mismatch !== undefined) {
      mismatches.push(mismatch);
    }
  }
  for (const output of step.outputs ?? []) {
    const expectedPath = join(context.target, 'files', output.path);
    const actualPath = join(context.workspace, output.path);
    if (output.kind === 'tree') {
      mismatches.push(...(await compareTree(output.path, expectedPath, actualPath)));
    } else {
      const mismatch = await compareFile(output.path, output.kind, expectedPath, actualPath);
      if (mismatch !== undefined) {
        mismatches.push(mismatch);
      }
    }
  }
  return { prefix, mismatches };
}

export async function runScenario(scenario: Scenario, options: RunnerOptions, typst: string | undefined): Promise<ScenarioResult> {
  const started = Date.now();
  if (scenario.requires === 'typst' && typst === undefined) {
    const message = 'sin binario de Typst (cv typst install o CHAMELEON_TYPST)';
    return options.requireTypst === true
      ? { id: scenario.id, status: 'failed', steps: 0, failures: [{ prefix: '(precondición)', mismatches: [{ what: 'Typst', detail: `${message}; exigido con --require-typst` }] }], elapsedMs: 0 }
      : { id: scenario.id, status: 'skipped', steps: 0, failures: [], message, elapsedMs: 0 };
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
    const context: Context = { workspace, env, replacements, target };
    const failures: StepResult[] = [];
    let executed = 0;
    for (const [index, step] of scenario.steps.entries()) {
      executed += 1;
      const result = await runStep(context, index, step, options);
      if (result.mismatches.length > 0) {
        failures.push(result);
        if (result.mismatches.some((mismatch) => mismatch.what === 'código de salida')) {
          break; // el estado del espacio de trabajo ya no es el previsto: los pasos siguientes no significan nada
        }
      }
    }
    if (options.keep === true) {
      console.log(`  copia conservada en ${root}`);
    }
    return { id: scenario.id, status: failures.length === 0 ? 'ok' : 'failed', steps: executed, failures, elapsedMs: Date.now() - started };
  } finally {
    if (options.keep !== true) {
      await rm(root, { recursive: true, force: true });
    }
  }
}

export async function typstBinary(): Promise<string | undefined> {
  const located = await locateTypst({ env: process.env });
  return located?.path;
}

/** `dist/` debe existir y no ser más antiguo que ningún fuente: el arnés prueba el código actual. */
export async function checkDist(): Promise<string | undefined> {
  if (!(await exists(CLI_PATH))) {
    return `No existe ${CLI_PATH}: compila antes con «npm run build»`;
  }
  const built = (await stat(CLI_PATH)).mtimeMs;
  const sources = join(REPO_ROOT, 'src');
  for (const file of await listFiles(sources)) {
    if ((await stat(join(sources, file))).mtimeMs > built) {
      return `dist/ es más antiguo que src/${file}: compila antes con «npm run build»`;
    }
  }
  return undefined;
}

/** Los ficheros derivados versionados (PDF de ofertas, revisiones) deben ser exactamente los que producen sus generadores. */
export async function checkBenchConsistency(): Promise<ScenarioResult> {
  const started = Date.now();
  const root = await mkdtemp(join(tmpdir(), 'cv-acceptance-bench-'));
  try {
    const copy = join(root, 'ws');
    await cp(BENCH_WORKSPACE, copy, { recursive: true });
    const produced = [...(await generateOfferPdfs(copy)), ...(await generateReviews(copy))];
    const mismatches: Mismatch[] = [];
    for (const path of produced) {
      const file = relative(copy, path);
      const committed = join(BENCH_WORKSPACE, file);
      const mismatch = file.endsWith('.pdf') ? await comparePdf(file, await readFile(committed), await readFile(path)) : compareText(file, await readFile(committed, 'utf8'), await readFile(path, 'utf8'));
      if (mismatch !== undefined) {
        mismatches.push(mismatch);
      }
    }
    return { id: 'bench-generators', status: mismatches.length === 0 ? 'ok' : 'failed', steps: produced.length, failures: mismatches.length === 0 ? [] : [{ prefix: 'generate.ts', mismatches }], elapsedMs: Date.now() - started };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function report(result: ScenarioResult, update: boolean): void {
  const seconds = `${(result.elapsedMs / 1000).toFixed(1)} s`;
  if (result.status === 'skipped') {
    console.log(`· ${result.id}: OMITIDO — ${result.message ?? ''}`);
    return;
  }
  if (result.status === 'ok') {
    console.log(`✓ ${result.id}: ${result.steps} pasos ${update ? 'regenerados' : 'idénticos a lo esperado'} (${seconds})`);
    return;
  }
  console.log(`✗ ${result.id}: ${result.failures.length} de ${result.steps} pasos con diferencias (${seconds})`);
  for (const failure of result.failures) {
    for (const mismatch of failure.mismatches) {
      console.log(`  ${failure.prefix} · ${mismatch.what}:`);
      console.log(`    ${mismatch.detail.split('\n').join('\n    ')}`);
    }
  }
}

export async function runAll(options: RunnerOptions): Promise<ScenarioResult[]> {
  const distProblem = await checkDist();
  if (distProblem !== undefined) {
    throw new Error(distProblem);
  }
  const typst = await typstBinary();
  console.log(`Arnés de aceptación determinista · ${options.update ? 'REGENERANDO artefactos esperados' : 'comparando con los artefactos esperados'} · Typst: ${typst ?? 'no disponible'}`);
  const results: ScenarioResult[] = [];
  if (options.only === undefined || options.only.includes('bench-generators')) {
    const consistency = await checkBenchConsistency();
    report(consistency, false);
    results.push(consistency);
  }
  for (const scenario of SCENARIOS) {
    if (options.only !== undefined && !options.only.includes(scenario.id)) {
      continue;
    }
    const result = await runScenario(scenario, options, typst);
    report(result, options.update);
    results.push(result);
  }
  return results;
}

export function summarize(results: readonly ScenarioResult[]): { readonly line: string; readonly exitCode: number } {
  const failed = results.filter((result) => result.status === 'failed');
  const skipped = results.filter((result) => result.status === 'skipped');
  const steps = results.reduce((sum, result) => sum + result.steps, 0);
  const differing = failed.reduce((sum, result) => sum + result.failures.length, 0);
  const elapsed = (results.reduce((sum, result) => sum + result.elapsedMs, 0) / 1000).toFixed(1);
  return {
    line: `${results.length} escenarios · ${steps} pasos · ${differing} con diferencias · ${skipped.length} omitidos · ${elapsed} s${failed.length === 0 ? '' : ` → FALLO en ${failed.map((result) => result.id).join(', ')}`}`,
    exitCode: failed.length === 0 ? 0 : 1,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const options: RunnerOptions = {
    update: args.includes('--update'),
    requireTypst: args.includes('--require-typst'),
    keep: args.includes('--keep'),
    only: args.some((arg) => !arg.startsWith('--')) ? args.filter((arg) => !arg.startsWith('--')) : undefined,
  };
  runAll(options)
    .then((results) => {
      const summary = summarize(results);
      console.log(summary.line);
      process.exitCode = summary.exitCode;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
