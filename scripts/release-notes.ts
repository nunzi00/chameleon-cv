/**
 * Notas de la release de una versión, extraídas de CHANGELOG.md (T-6.6): las imprime por stdout.
 *
 *   npm run release:notes -- 1.0.0 > RELEASE-NOTES.md
 *
 * Código 2 si la versión no tiene sección con fecha y contenido: el flujo de release lo ejecuta en
 * `verify` para detenerse antes de empaquetar y en `package` para adjuntar las notas al artefacto.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { releaseNotes } from '../src/release/changelog';

const requested = process.argv[2];
if (requested === undefined || requested === '') {
  process.stderr.write('Uso: npm run release:notes -- <versión>   (p. ej. 1.0.0 o v1.0.0)\n');
  process.exit(2);
}
const result = releaseNotes(readFileSync(join(resolve(__dirname, '..'), 'CHANGELOG.md'), 'utf8'), requested.replace(/^v/, ''));
if (!result.ok) {
  process.stderr.write(`✗ ${result.message}\n`);
  process.exit(2);
}
process.stdout.write(`${result.notes}\n`);
