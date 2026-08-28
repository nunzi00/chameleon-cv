/**
 * Conciencia de coste (T-4.5, canon C11): antes de enviar nada a un proveedor remoto se estima el
 * tamaño de lo que sale. Sin tokenizador del proveedor: heurística de ~4 caracteres por token
 * (±25 % según idioma), suficiente para que el usuario decida con conocimiento de causa.
 */
import type { LlmMessage } from './provider';

export const CHARACTERS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil([...text].length / CHARACTERS_PER_TOKEN);
}

export interface CostEstimate {
  readonly requests: number;
  readonly inputTokens: number;
  readonly maxOutputTokens: number;
}

/** Estimación de un lote: entrada por petición (sistema + usuario) y salida máxima por petición. */
export function estimateBatch(messagesPerRequest: ReadonlyArray<readonly LlmMessage[]>, maxTokensPerRequest: number): CostEstimate {
  const inputTokens = messagesPerRequest.reduce((sum, messages) => sum + messages.reduce((partial, message) => partial + estimateTokens(message.content), 0), 0);
  return { requests: messagesPerRequest.length, inputTokens, maxOutputTokens: maxTokensPerRequest * messagesPerRequest.length };
}

export function formatCostWarning(providerLabel: string, estimate: CostEstimate): string {
  return [
    `Aviso de coste: ${estimate.requests} ${estimate.requests === 1 ? 'petición' : 'peticiones'} a ${providerLabel} con ≈${estimate.inputTokens} tokens de entrada (estimación: ${CHARACTERS_PER_TOKEN} caracteres ≈ 1 token) y hasta ${estimate.maxOutputTokens} de salida.`,
    'La operación puede incurrir en costes según tu tarifa con el proveedor.',
  ].join('\n');
}
