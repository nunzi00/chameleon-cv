/**
 * Puente levadizo hacia los proveedores remotos (T-4.5, canon C3 y C11): antes de la primera
 * petición se muestra qué sale, a dónde y cuánto puede costar, y se pide confirmación explícita.
 * `--yes` la da por adelantado; sin terminal interactiva y sin `--yes`, la orden se aborta.
 */
import { formatCostWarning, type CostEstimate, type LlmProvider } from '../../llm';
import type { CliContext } from '../context';

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
