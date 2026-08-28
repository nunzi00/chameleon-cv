/**
 * `cv llm status [--provider <id>] [--model <m>]` (T-4.2/T-4.5): proveedor local que usaría el
 * co-piloto y si responde; procedencia de las claves remotas (nunca su valor) y lista blanca.
 * Solo con `--provider <remoto>` explícito se comprueba ese proveedor en la red.
 */
import { formatLlmStatus } from '../../llm';
import type { CliContext } from '../context';
import { EXIT_FAILURE, EXIT_OK } from '../output';

export interface LlmStatusCommandOptions {
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
}

export async function runLlmStatus(context: CliContext, options: LlmStatusCommandOptions = {}): Promise<number> {
  const status = await context.llmStatus({ provider: options.provider, model: options.model });
  context.stdout(formatLlmStatus(status));
  const remoteUsable = status.remote === undefined ? true : !('error' in status.remote) && status.remote.health.ok && status.remote.health.modelAvailable;
  return (status.usable || status.remote !== undefined) && remoteUsable ? EXIT_OK : EXIT_FAILURE;
}
