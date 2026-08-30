/**
 * Punto de entrada del spike (T-8.4): `npm run spike:pdf-import -- corpus | measure [--candidate p1] | all`.
 * Escribe las tablas en build/spike/pdf-import/results-<candidato>.md y las imprime; no toca src/ ni el producto.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { CORPUS_ROOT, ROOT, generateCorpus } from './corpus';
import { measure, report, type Candidate } from './measure';

async function main(): Promise<void> {
  const [command = 'all', ...rest] = process.argv.slice(2);
  const candidateIndex = rest.indexOf('--candidate');
  const candidate = (candidateIndex === -1 ? 'p1' : rest[candidateIndex + 1]) as Candidate;
  if (command === 'corpus' || command === 'all') {
    const written = await generateCorpus();
    for (const file of written) {
      console.log(`corpus ${file.group}/${file.name}: ${relative(ROOT, file.path)} (${Math.round(file.bytes / 1024)} KB)`);
    }
  }
  if (command === 'measure' || command === 'all') {
    const measurement = await measure(candidate);
    const text = report(measurement);
    mkdirSync(join(CORPUS_ROOT, '..'), { recursive: true });
    const target = join(CORPUS_ROOT, '..', `results-${candidate}.md`);
    writeFileSync(target, text);
    console.log(text);
    console.log(`(escrito en ${relative(ROOT, target)})`);
  }
  if (!['corpus', 'measure', 'all'].includes(command)) {
    throw new Error(`Orden desconocida «${command}»: corpus | measure [--candidate p1] | all`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
