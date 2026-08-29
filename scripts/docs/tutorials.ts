/**
 * Ejecutor de tutoriales (T-7.1, docs/docs-portal.md §4.3): la documentación se prueba a sí misma (C13).
 * Cada página con cabecera `verify:` declara los ficheros que sus órdenes producen; los bloques
 * ```bash tutorial``` se extraen en orden y se ejecutan con `sh -e` en un espacio de trabajo temporal,
 * con entorno mínimo y `cv` resuelto al binario compilado (dist/index.js) o al ejecutable de --binary.
 * Los bloques marcados `needs-typst` solo corren si hay un Typst utilizable, los `needs-llm` solo con
 * CHAMELEON_DOCS_LLM=1 y los `needs-docker` solo con CHAMELEON_DOCS_DOCKER=1 y un demonio de Docker: en otro
 * caso se OMITEN de forma visible, nunca en silencio. La cabecera admite además `files:` (ficheros del
 * repositorio que se copian al espacio de trabajo, p. ej. compose.yml) y `cleanup:` (órdenes finales).
 *
 *   npm run docs:tutorials [-- --binary build/sea/cv] [--keep] [--only <texto-del-fichero>]
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, globSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';

const ROOT = resolve(__dirname, '..', '..');
const SRC = join(ROOT, 'website', 'src');
const CLI = join(ROOT, 'dist', 'index.js');
const TYPST_VERSION = '0.15.1';

type Requirement = 'typst' | 'llm' | 'docker';

interface Block {
  readonly line: number;
  readonly requires: Requirement | undefined;
  readonly script: string;
}

interface Tutorial {
  readonly file: string;
  readonly title: string;
  readonly verify: readonly string[];
  readonly files: readonly string[];
  readonly cleanup: readonly string[];
  readonly blocks: readonly Block[];
}

interface Outcome {
  readonly file: string;
  readonly run: number;
  readonly skipped: string[];
  readonly failures: string[];
}

export function parseTutorial(file: string, markdown: string): Tutorial | undefined {
  const front = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  const meta = front === null ? {} : (parseYaml(String(front[1])) as Record<string, unknown>);
  if (!Array.isArray(meta['verify'])) {
    return undefined;
  }
  const blocks: Block[] = [];
  const lines = markdown.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const fence = /^```bash tutorial(?:\s+needs-(typst|llm|docker))?\s*$/.exec(lines[index] ?? '');
    if (fence === null) {
      continue;
    }
    const start = index + 1;
    let end = start;
    while (end < lines.length && lines[end] !== '```') {
      end += 1;
    }
    blocks.push({ line: start, requires: fence[1] as Requirement | undefined, script: lines.slice(start, end).join('\n') });
    index = end;
  }
  const list = (key: string): string[] => (Array.isArray(meta[key]) ? meta[key].map(String) : []);
  return { file, title: typeof meta['title'] === 'string' ? meta['title'] : file, verify: meta['verify'].map(String), files: list('files'), cleanup: list('cleanup'), blocks };
}

function typstPath(): string | undefined {
  const explicit = process.env['CHAMELEON_TYPST'];
  if (explicit !== undefined && existsSync(explicit)) {
    return explicit;
  }
  const cached = join(homedir(), '.cache', 'chameleon-cv', 'typst', TYPST_VERSION, 'typst');
  return existsSync(cached) ? cached : undefined;
}

function tutorials(): Tutorial[] {
  const files = [join('guide', 'quickstart.md'), ...readdirSync(join(SRC, 'tutorials')).filter((name) => name.endsWith('.md')).sort().map((name) => join('tutorials', name))];
  const found: Tutorial[] = [];
  for (const file of files) {
    const parsed = parseTutorial(file, readFileSync(join(SRC, file), 'utf8'));
    if (parsed !== undefined) {
      found.push(parsed);
    }
  }
  return found.sort((a, b) => (a.file.startsWith('guide') ? -1 : b.file.startsWith('guide') ? 1 : a.title.localeCompare(b.title, 'es', { numeric: true })));
}

function run(tutorial: Tutorial, binary: string | undefined, keep: boolean): Outcome {
  const temporary = mkdtempSync(join(tmpdir(), 'cv-docs-tutorial-'));
  const workspace = join(temporary, 'work');
  const home = join(temporary, 'home');
  const bin = join(temporary, 'bin');
  for (const directory of [workspace, home, bin]) {
    mkdirSync(directory, { recursive: true });
  }
  const shim = join(bin, 'cv');
  writeFileSync(shim, binary === undefined ? `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n` : `#!/bin/sh\nexec "${resolve(binary)}" "$@"\n`);
  chmodSync(shim, 0o755);
  for (const file of tutorial.files) {
    mkdirSync(dirname(join(workspace, file)), { recursive: true });
    copyFileSync(join(ROOT, file), join(workspace, file));
  }
  const typst = typstPath();
  const llm = process.env['CHAMELEON_DOCS_LLM'] === '1';
  const docker = process.env['CHAMELEON_DOCS_DOCKER'] === '1' && spawnSync('docker', ['version'], { stdio: 'ignore' }).status === 0;
  const env: NodeJS.ProcessEnv = {
    PATH: `${bin}:/usr/local/bin:/usr/bin:/bin`,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_CACHE_HOME: join(home, '.cache'),
    TZ: 'UTC',
    LANG: 'C.UTF-8',
    ...(typst === undefined ? {} : { CHAMELEON_TYPST: typst }),
    ...(process.env['DOCKER_HOST'] === undefined ? {} : { DOCKER_HOST: process.env['DOCKER_HOST'] }),
    ...(llm
      ? Object.fromEntries(['CHAMELEON_LLM_PROVIDER', 'CHAMELEON_LLM_BASE_URL', 'CHAMELEON_LLM_MODEL'].filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]))
      : { CHAMELEON_LLM_BASE_URL: 'http://127.0.0.1:9' }),
  };
  const outcome = { file: tutorial.file, run: 0, skipped: [] as string[], failures: [] as string[] };
  try {
    for (const block of tutorial.blocks) {
      if (block.requires === 'typst' && typst === undefined) {
        outcome.skipped.push(`línea ${block.line}: requiere Typst (cv typst install o CHAMELEON_TYPST)`);
        continue;
      }
      if (block.requires === 'llm' && !llm) {
        outcome.skipped.push(`línea ${block.line}: requiere un modelo local (CHAMELEON_DOCS_LLM=1 con Ollama o llama-server en marcha)`);
        continue;
      }
      if (block.requires === 'docker' && !docker) {
        outcome.skipped.push(`línea ${block.line}: requiere Docker (CHAMELEON_DOCS_DOCKER=1 con el demonio de Docker y la imagen chameleon-cv:local)`);
        continue;
      }
      const result = spawnSync('sh', ['-e', '-c', block.script], { cwd: workspace, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      outcome.run += 1;
      if (result.status !== 0) {
        outcome.failures.push(`línea ${block.line}: el bloque terminó con ${result.status ?? result.signal}\n${block.script}\n--- salida ---\n${result.stdout}${result.stderr}`.trimEnd());
        break;
      }
    }
    if (outcome.failures.length === 0) {
      for (const pattern of tutorial.verify) {
        if (globSync(pattern, { cwd: workspace }).length === 0) {
          // Si se omitieron bloques, el fichero puede depender de ellos: omisión visible, no fallo.
          if (outcome.skipped.length > 0) {
            outcome.skipped.push(`verify ${pattern}: no comprobable porque se omitieron bloques`);
          } else {
            outcome.failures.push(`verify: no existe ${pattern} en el espacio de trabajo`);
          }
        }
      }
    }
  } finally {
    for (const command of tutorial.cleanup) {
      const result = spawnSync('sh', ['-c', command], { cwd: workspace, env, encoding: 'utf8' });
      if (result.status !== 0) {
        process.stdout.write(`  (limpieza «${command}» terminó con ${result.status ?? result.signal})\n`);
      }
    }
    if (keep) {
      process.stdout.write(`  (espacio de trabajo conservado en ${workspace})\n`);
    } else {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
  return outcome;
}

function main(): void {
  const args = process.argv.slice(2);
  const binaryIndex = args.indexOf('--binary');
  const binary = binaryIndex === -1 ? undefined : args[binaryIndex + 1];
  const keep = args.includes('--keep');
  const onlyIndex = args.indexOf('--only');
  const only = onlyIndex === -1 ? undefined : args[onlyIndex + 1];
  if (binary === undefined && !existsSync(CLI)) {
    process.stderr.write(`No existe ${CLI}: compila antes con «npm run build»\n`);
    process.exit(2);
  }
  const started = Date.now();
  const outcomes = tutorials().filter((tutorial) => only === undefined || tutorial.file.includes(only)).map((tutorial) => {
    process.stdout.write(`▸ ${tutorial.title} (${tutorial.file}, ${tutorial.blocks.length} bloques)\n`);
    const outcome = run(tutorial, binary, keep);
    for (const skipped of outcome.skipped) {
      process.stdout.write(`  ○ omitido: ${skipped}\n`);
    }
    for (const failure of outcome.failures) {
      process.stdout.write(`  ✗ ${failure.split('\n').join('\n    ')}\n`);
    }
    process.stdout.write(`  ${outcome.failures.length === 0 ? '✓' : '✗'} ${outcome.run} bloques ejecutados · ${outcome.skipped.length} omitidos · ${tutorial.verify.length} comprobaciones\n`);
    return outcome;
  });
  const failed = outcomes.filter((outcome) => outcome.failures.length > 0).length;
  const skipped = outcomes.reduce((sum, outcome) => sum + outcome.skipped.length, 0);
  process.stdout.write(`\n${outcomes.length} tutoriales · ${outcomes.length - failed} en verde · ${failed} con fallos · ${skipped} bloques omitidos · ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) {
  main();
}
