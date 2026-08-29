/**
 * Puente levadizo hacia los proveedores remotos (T-4.5, canon C3 y C11): antes de la primera petición se
 * muestra qué sale, a dónde y cuánto puede costar, y se pide confirmación explícita. `--yes` la da por
 * adelantado; sin terminal interactiva y sin `--yes`, la orden se aborta. Los locales solo deben responder
 * y servir el modelo configurado.
 */
import { checkLocalProvider } from '../../app/copilot';
import { formatCostWarning, type CostEstimate, type LlmProvider } from '../../llm';
import type { CliContext } from '../context';
import { EXIT_FAILURE, EXIT_OK } from '../output';

export const REMOTE_CANCELLED = 'Operación cancelada: no se ha enviado nada al proveedor remoto';

/** Devuelve `true` si se puede enviar; imprime el aviso y el motivo de la cancelación. */
export async function consentToRemote(context: CliContext, provider: LlmProvider, estimate: CostEstimate, yes: boolean): Promise<boolean> {
  if (provider.kind !== 'remote') {
    return true;
  }
  context.stderr(`${formatCostWarning(`${provider.id} (${provider.baseUrl}; modelo ${provider.model})`, estimate)}\n`);
  if (yes) {
    context.stderr('Confirmado con --yes\n');
    return true;
  }
  if (context.confirm === undefined) {
    context.stderr(`${REMOTE_CANCELLED}: sin terminal interactiva, confirma con --yes\n`);
    return false;
  }
  const accepted = await context.confirm('¿Continuar y enviar al proveedor remoto? [s/N] ');
  if (!accepted) {
    context.stderr(`${REMOTE_CANCELLED}\n`);
  }
  return accepted;
}

/**
 * Antes de enviar: un local debe responder y servir el modelo (mensaje por comando: `improve` enumera los
 * modelos servidos); un remoto exige el consentimiento de coste. Devuelve el código de salida (0 = adelante).
 */
export async function ensureProviderReady(context: CliContext, provider: LlmProvider, estimate: () => Promise<CostEstimate>, yes: boolean, listModels: boolean): Promise<number> {
  const health = await checkLocalProvider(provider);
  if (!health.ok) {
    if (health.reason === 'unreachable') {
      context.stderr(`${health.message}\nComprueba el proveedor con «cv llm status»\n`);
    } else {
      context.stderr(
        listModels
          ? `El modelo «${provider.model}» no está disponible en ${provider.baseUrl} (${health.models.length === 0 ? 'no sirve ningún modelo' : `sirve: ${health.models.join(', ')}`}); comprueba «cv llm status»\n`
          : `El modelo «${provider.model}» no está disponible en ${provider.baseUrl}; comprueba «cv llm status»\n`,
      );
    }
    return EXIT_FAILURE;
  }
  if (provider.kind === 'remote' && !(await consentToRemote(context, provider, await estimate(), yes))) {
    return EXIT_FAILURE;
  }
  return EXIT_OK;
}
