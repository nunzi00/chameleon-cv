/** Los dos rechazos de un trabajo con proveedor remoto (docs/api-headless.md §6, canon C11): 403 sin --allow-remote y 409 con la estimación de coste. */
import { ApiError } from '../api/client';

export type LaunchProblem =
  | { readonly kind: 'remote-disabled'; readonly message: string }
  | { readonly kind: 'consent-required'; readonly message: string; readonly estimateId: string; readonly warning: string; readonly estimate: readonly string[]; readonly dataNote: string };

function estimateLines(value: unknown): readonly string[] {
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  const labels: Readonly<Record<string, string>> = { requests: 'peticiones', inputTokens: 'tokens de entrada (aprox.)', maxOutputTokens: 'tokens de salida (máximo)', outputTokens: 'tokens de salida (máximo)' };
  return Object.entries(value)
    .filter(([, amount]) => typeof amount === 'number')
    .map(([key, amount]) => `${labels[key] ?? key}: ${String(amount)}`);
}

export function launchProblem(error: unknown): LaunchProblem | undefined {
  if (!(error instanceof ApiError)) {
    return undefined;
  }
  if (error.code === 'remote-disabled') {
    return { kind: 'remote-disabled', message: error.message };
  }
  if (error.code === 'consent-required' && typeof error.details['estimateId'] === 'string') {
    return {
      kind: 'consent-required',
      message: error.message,
      estimateId: error.details['estimateId'],
      warning: typeof error.details['warning'] === 'string' ? error.details['warning'] : '',
      estimate: estimateLines(error.details['estimate']),
      dataNote: typeof error.details['dataNote'] === 'string' ? error.details['dataNote'] : '',
    };
  }
  return undefined;
}
