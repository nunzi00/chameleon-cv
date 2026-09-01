/**
 * La comparación de varias ofertas (T-9.13) en la pantalla: las mismas columnas y el mismo vocabulario que la
 * tabla de `cv analyze-offer --rank`, sobre la respuesta de la API. No se calcula aquí ninguna métrica —todas
 * vienen del análisis determinista— y el orden es el que trae el servidor: imprescindibles cubiertos primero.
 */
import type { RankResponse } from '../api/types';

export interface RankRow {
  readonly name: string;
  /** «3/5 (60 %)», o «—» si la oferta no declara ni un requisito reconocible. */
  readonly fit: string;
  readonly required: string;
  readonly specialty: string;
  readonly gaps: string;
}

export interface RankView {
  readonly rows: readonly RankRow[];
  /** Lo que no se pudo analizar, ya con el nombre que le puso quien pidió la comparación. */
  readonly failed: readonly string[];
  /** Los avisos del análisis, cada uno con la oferta que lo provocó: con varias, «la oferta» no basta. */
  readonly warnings: readonly string[];
}

/** `sources` nombra cada oferta como la escribió el usuario: el servidor solo devuelve su posición. */
export function rankView(response: RankResponse, sources: readonly string[]): RankView {
  return {
    rows: response.ranked.map((offer) => ({
      name: offer.name,
      fit: offer.ratio === undefined ? '—' : `${offer.demonstrated}/${offer.recognized} (${Math.round(offer.ratio * 100)} %)`,
      required: `${offer.requiredDemonstrated}/${offer.requiredTotal}`,
      specialty: offer.suggestedSpecialty ?? '—',
      gaps: offer.gaps.join(', ') || '—',
    })),
    failed: response.failed.map((failure) => `${sources[failure.offer] ?? 'oferta'}: ${failure.message}`),
    warnings: response.warnings.map((entry) => `${sources[entry.offer] ?? 'oferta'}: ${entry.warning.kind}`),
  };
}
