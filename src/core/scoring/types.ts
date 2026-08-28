import type { JobRequirements } from '../keywords';
import type { MasterProfile } from '../schema';
import type { ItemDecision, Selection } from '../selection';

export interface ScoredDecision extends ItemDecision {
  readonly score: number;
  /** Términos de la oferta que aportan puntuación al ítem (evidencia). */
  readonly matchedTerms: readonly string[];
}

export interface MatchReport {
  readonly requirements: JobRequirements;
  readonly decisions: readonly ScoredDecision[];
  /** Término → ids de los ítems incluidos que lo evidencian (vacío = pedido y no demostrado). */
  readonly coverage: Readonly<Record<string, readonly string[]>>;
}

export interface ScoredSelection {
  readonly selection: Selection;
  /** `selection.profile` con logros y skills reordenados por puntuación. */
  readonly profile: MasterProfile;
  readonly report: MatchReport;
}

export interface ScoringOptions {
  /** Decimales de las puntuaciones (por defecto 2). */
  readonly decimals?: number;
}
