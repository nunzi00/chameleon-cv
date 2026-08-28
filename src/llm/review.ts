/**
 * Fichero de revisión (T-4.3, canon C1 y C9): la única salida del co-piloto. Markdown legible y
 * a la vez parseable: una sección por logro, propuestas aceptadas como casillas `- [ ]` (que
 * T-4.7 podrá aplicar ítem a ítem) y rechazadas tachadas con su motivo. Registra procedencia
 * (proveedor, modelo, prompt) para que cada sugerencia sea trazable.
 */
import { describeVerdict, type Verdict } from '../core/llm/verify';
import type { LlmUsage } from './provider';

export interface ReviewProposal {
  readonly text: string;
  readonly rationale: string;
  readonly verdict: Verdict;
}

export interface ReviewItem {
  readonly id: string;
  /** Dónde vive el logro: «Senior Backend Engineer · ACME Corp», «Proyecto Chameleon CLI» o «Logros transversales». */
  readonly location: string;
  readonly original: string;
  readonly impact?: string | undefined;
  readonly proposals: readonly ReviewProposal[];
  /** Fallo al obtener propuestas para este ítem (el lote continúa). */
  readonly error?: string | undefined;
  readonly fromCache: boolean;
  readonly elapsedMs: number;
  readonly usage: LlmUsage;
}

export interface ReviewHeader {
  readonly generatedAt: string;
  readonly specialty?: string | undefined;
  readonly offer?: string | undefined;
  readonly provider: { readonly id: string; readonly baseUrl: string; readonly model: string };
  readonly promptVersion: string;
  readonly temperature: number;
  readonly seed: number;
}

export interface ReviewStats {
  readonly items: number;
  readonly proposals: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly failed: number;
  readonly fromCache: number;
}

export function reviewStats(items: readonly ReviewItem[]): ReviewStats {
  const proposals = items.flatMap((item) => item.proposals);
  return {
    items: items.length,
    proposals: proposals.length,
    accepted: proposals.filter((proposal) => proposal.verdict.accepted).length,
    rejected: proposals.filter((proposal) => !proposal.verdict.accepted).length,
    failed: items.filter((item) => item.error !== undefined).length,
    fromCache: items.filter((item) => item.fromCache).length,
  };
}

export function formatReview(header: ReviewHeader, items: readonly ReviewItem[]): string {
  const stats = reviewStats(items);
  const lines: string[] = [
    '# Revisión de logros (cv improve)',
    '',
    `- generado: ${header.generatedAt}`,
    `- especialidad: ${header.specialty ?? 'ninguna (perfil completo)'} · oferta: ${header.offer ?? 'ninguna'}`,
    `- proveedor: ${header.provider.id} (${header.provider.baseUrl}) · modelo: ${header.provider.model} · prompt: ${header.promptVersion} · temperatura ${header.temperature} · semilla ${header.seed}`,
    `- logros: ${stats.items} · propuestas: ${stats.proposals} · aceptadas: ${stats.accepted} · rechazadas: ${stats.rejected} · fallidos: ${stats.failed} · desde caché: ${stats.fromCache}`,
    '',
    'La IA sugiere; tú decides. Nada se ha modificado en `data/sources/`. Marca con `[x]` las propuestas que quieras adoptar y cópialas a tus fuentes (o aplícalas con `cv improve apply` cuando exista). Las propuestas tachadas incumplen el canon C2 (integridad semántica): el motivo está al lado.',
    '',
  ];
  for (const item of items) {
    lines.push(`## ${item.id} · ${item.location}`, '');
    lines.push(`Original: ${item.original}`);
    if (item.impact !== undefined) {
      lines.push(`Impacto: ${item.impact}`);
    }
    lines.push('');
    if (item.error !== undefined) {
      lines.push(`- ✗ sin propuestas: ${item.error}`, '');
      continue;
    }
    item.proposals.forEach((proposal, index) => {
      const number = index + 1;
      if (proposal.verdict.accepted) {
        lines.push(`- [ ] Propuesta ${number}: ${proposal.text}`);
      } else {
        lines.push(`- ~~Propuesta ${number}: ${proposal.text}~~`);
      }
      lines.push(`  - motivo: ${proposal.rationale}`);
      lines.push(`  - verificación: ${describeVerdict(proposal.verdict)}`);
    });
    const origin = item.fromCache ? 'desde caché' : `${item.elapsedMs} ms`;
    const tokens = item.usage.promptTokens === undefined && item.usage.completionTokens === undefined ? '' : ` · tokens ${item.usage.promptTokens ?? '?'} + ${item.usage.completionTokens ?? '?'}`;
    lines.push(`  - procedencia: ${origin}${tokens}`, '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
