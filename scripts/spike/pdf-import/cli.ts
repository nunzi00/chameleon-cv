/**
 * Punto de entrada del spike (T-8.4):
 *   npm run spike:pdf-import -- corpus
 *   npm run spike:pdf-import -- measure [--candidate p1|p2|p3] [--only a|b|c|<grupo>/<nombre…>] [--limit n]
 *   npm run spike:pdf-import -- compare        (mide p1 y p3, y p2 si hay servidor local, y escribe la tabla comparativa)
 *   npm run spike:pdf-import -- rescore      (P2: vuelve a verificar y puntuar las respuestas guardadas del modelo, sin llamarlo)
 *   npm run spike:pdf-import -- all
 * Escribe las tablas en build/spike/pdf-import/results-<candidato>.md; no toca src/ ni el producto.
 */
import './patient-fetch-install';

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { CORPUS_ROOT, ROOT, generateCorpus } from './corpus';
import { CANDIDATES, compareTable, localProvider, measure, report, rescore, type Candidate, type Measurement } from './measure';

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function run(candidate: Candidate, args: readonly string[]): Promise<Measurement> {
  const limit = option(args, '--limit');
  const measurement = await measure(candidate, undefined, { only: option(args, '--only'), limit: limit === undefined ? undefined : Number(limit), log: (line) => console.error(line) });
  mkdirSync(join(CORPUS_ROOT, '..'), { recursive: true });
  const target = join(CORPUS_ROOT, '..', `results-${candidate}.md`);
  writeFileSync(target, report(measurement));
  console.log(report(measurement));
  console.log(`(escrito en ${relative(ROOT, target)})`);
  return measurement;
}

async function main(): Promise<void> {
  const [command = 'all', ...rest] = process.argv.slice(2);
  if (command === 'corpus' || command === 'all') {
    for (const file of await generateCorpus()) {
      console.log(`corpus ${file.group}/${file.name}: ${relative(ROOT, file.path)} (${Math.round(file.bytes / 1024)} KB)`);
    }
  }
  if (command === 'measure' || command === 'all') {
    if (!existsSync(CORPUS_ROOT)) {
      throw new Error('No hay corpus: ejecuta primero «npm run spike:pdf-import -- corpus»');
    }
    await run((option(rest, '--candidate') ?? 'p1') as Candidate, rest);
  }
  if (command === 'compare') {
    const measurements: Measurement[] = [];
    for (const candidate of CANDIDATES) {
      if (candidate === 'p2') {
        try {
          await localProvider();
        } catch (error) {
          console.error(`p2 omitido: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
      }
      measurements.push(await run(candidate, rest));
    }
    const table = compareTable(measurements);
    writeFileSync(join(CORPUS_ROOT, '..', 'compare.md'), `${table}\n`);
    console.log(table);
  }
  if (command === 'rescore') {
    const measurement = rescore();
    const target = join(CORPUS_ROOT, '..', 'results-p2-rescored.md');
    writeFileSync(target, report(measurement));
    console.log(report(measurement));
    console.log(`(escrito en ${relative(ROOT, target)})`);
  }
  if (!['corpus', 'measure', 'compare', 'rescore', 'all'].includes(command)) {
    throw new Error(`Orden desconocida «${command}»: corpus | measure [--candidate p1|p2|p3] [--only a|b|c|<grupo>/<nombre…>] [--limit n] | compare | rescore | all`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
