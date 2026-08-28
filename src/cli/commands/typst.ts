/**
 * `cv typst install | status` (T-3.3, `docs/typst-integration.md` §2.3): gestión explícita del
 * binario oficial de Typst. `install` es la única orden de `cv` que toca la red, y lo dice.
 */
import { formatTypstStatus } from '../../typst';
import type { CliContext } from '../context';
import { EXIT_FAILURE, EXIT_OK } from '../output';

export interface TypstInstallOptions {
  readonly force: boolean;
}

export async function runTypstInstall(context: CliContext, options: TypstInstallOptions): Promise<number> {
  const result = await context.typstInstall({ force: options.force }, (line) => {
    context.stdout(`${line}\n`);
  });
  if (result.ok) {
    return EXIT_OK;
  }
  context.stderr(`${result.message}\n`);
  return EXIT_FAILURE;
}

export async function runTypstStatus(context: CliContext): Promise<number> {
  const status = await context.typstStatus({});
  context.stdout(formatTypstStatus(status));
  return status.usable ? EXIT_OK : EXIT_FAILURE;
}
