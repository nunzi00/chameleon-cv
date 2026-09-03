/**
 * La **organización** de un CV, aplicada al `StructuredView` (T-9.26). Es la mitad de un tema que no depende de
 * Typst: qué sección va antes, dónde viven los logros y cuánto se cuenta de cada puesto. El `template.typ` de
 * cada tema sigue mandando en el PDF; esto es lo que puede reproducir **cualquier** salida —el ODT editable,
 * hoy— a partir del `[layout]` declarado en `theme.toml`.
 *
 * Lo que NO intenta: columnas laterales, tablas a dos columnas ni paneles sombreados. Un documento que se edita
 * a mano se pelea con eso, y fingir que lo reproduce sería peor que decir qué parte hereda.
 */
import { LAYOUT_SECTIONS, type LayoutSection, type ThemeConfig } from '../../themes/schema';
import type { StructuredAchievement, StructuredExperience, StructuredView } from './view';

export { LAYOUT_SECTIONS, type LayoutSection };

export interface CvLayout {
  /** Todas las secciones, sin repetir: las declaradas primero y el resto detrás en su orden natural. */
  readonly sections: readonly LayoutSection[];
  readonly achievements: 'per-entry' | 'consolidated';
  readonly experience: 'detailed' | 'compact';
}

export const DEFAULT_LAYOUT: CvLayout = { sections: LAYOUT_SECTIONS, achievements: 'per-entry', experience: 'detailed' };

/** Completa lo que el tema no dice: las secciones que falten van detrás, y lo no declarado es lo de siempre. */
export function resolveLayout(layout: ThemeConfig['layout']): CvLayout {
  const declared = layout?.sections ?? [];
  return {
    sections: [...declared, ...LAYOUT_SECTIONS.filter((section) => !declared.includes(section))],
    achievements: layout?.achievements ?? DEFAULT_LAYOUT.achievements,
    experience: layout?.experience ?? DEFAULT_LAYOUT.experience,
  };
}

/** Un puesto sin su prosa: lo que queda cuando la organización pide una línea por empleo. */
function compact(item: StructuredExperience): StructuredExperience {
  return { ...item, summary: [], achievements: [], technologies: '' };
}

/**
 * Los logros de una entrada, anotados con de dónde salen. Sin el origen, un bloque de logros consolidados es
 * una lista de méritos sin contexto: quien lee no sabe en qué empresa pasó ninguno.
 */
function withSource(achievements: readonly StructuredAchievement[], source: string): StructuredAchievement[] {
  return achievements.map((achievement) => ({ ...achievement, source }));
}

/**
 * El `StructuredView` reorganizado. Solo toca lo que el layout pide: con la organización por defecto devuelve
 * exactamente lo que recibió, así que el PDF de Typst y el Markdown no cambian ni un byte.
 */
export function applyLayout(view: StructuredView, layout: CvLayout): StructuredView {
  const consolidated = layout.achievements === 'consolidated';
  const experience = view.experience.map((item) => (layout.experience === 'compact' || consolidated ? compact(item) : item));
  const projects = consolidated ? view.projects.map((item) => ({ ...item, achievements: [] })) : view.projects;
  if (!consolidated) {
    return { ...view, experience };
  }
  return {
    ...view,
    experience,
    projects,
    achievements: [
      ...view.experience.flatMap((item) => withSource(item.achievements, item.company)),
      ...view.projects.flatMap((item) => withSource(item.achievements, item.name)),
      ...view.achievements,
    ],
  };
}
