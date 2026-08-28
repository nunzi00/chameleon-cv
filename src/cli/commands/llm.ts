/**
 * `cv llm status` (T-4.2, `docs/llm-integration.md` §4.1): proveedor y modelo locales que usaría
 * el co-piloto, si responden, y qué claves remotas hay definidas (solo nombres). No envía datos.
 */
import { formatLlmStatus } from '../../llm';
import type { CliContext } from '../context';
import { EXIT_FAILURE, EXIT_OK } from '../output';

export async function runLlmStatus(context: CliContext): Promise<number> {
  const status = await context.llmStatus({});
  context.stdout(formatLlmStatus(status));
  return status.usable ? EXIT_OK : EXIT_FAILURE;
}
