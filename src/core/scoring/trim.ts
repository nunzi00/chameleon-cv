/**
 * Recorte «N mejores» (T-2.3, `docs/trimming-cli.md` §3): vive en el núcleo, no en la plantilla.
 * Un solo ranking —anclados (`#pin`, T-2.9) primero, puntuación descendente y, a igual
 * puntuación, orden de documento—; los supervivientes conservan el orden con el que llegaron.
 * Sin oferta todos puntúan 0 y el ranking es el orden de documento. Un ítem anclado nunca se
 * recorta: consume plaza del límite y, si hay más anclados que plazas, sobreviven todos ellos.
 */
import { isPinned, type Achievement, type MasterProfile } from '../schema';
import type { MatchReport } from './types';

export interface SectionLimits {
  /** Logros por experiencia y por proyecto (`--top-n`). */
  readonly achievementsPerContainer?: number | undefined;
  /** Logros transversales (`--top-n`). */
  readonly achievements?: number | undefined;
  readonly skills?: number | undefined;
  readonly projects?: number | undefined;
  readonly certifications?: number | undefined;
}

export type RemovableSection = 'experience' | 'projects' | 'achievements' | 'skills' | 'certifications';

export interface RemovedItem {
  readonly section: RemovableSection;
  readonly id: string;
  /** Solo en logros anidados: id de la experiencia o proyecto que los contenía. */
  readonly parentId?: string;
  readonly score: number;
}

export interface TrimResult {
  /** Mismo contrato que la entrada; solo desaparecen ítems. */
  readonly profile: MasterProfile;
  /** Lo recortado, en el orden en que se recortó (por sección y de mayor a menor puntuación). */
  readonly removed: readonly RemovedItem[];
}

/** Preset `--compact`: la vía rápida a un CV de una página. */
export const COMPACT_LIMITS: Required<SectionLimits> = {
  achievementsPerContainer: 4,
  achievements: 4,
  skills: 12,
  projects: 4,
  certifications: 5,
};

export type ScoreLookup = (id: string) => number;

/** Sin oferta: todos puntúan 0 y manda el orden de documento. */
export const NO_SCORES: ScoreLookup = () => 0;

/** Puntuaciones de un informe de adecuación; un id desconocido puntúa 0. */
export function scoresFromReport(report: MatchReport): ScoreLookup {
  const scores = new Map(report.decisions.map((decision) => [decision.id, decision.score]));
  return (id) => scores.get(id) ?? 0;
}

export interface KeepResult<T> {
  readonly kept: T[];
  readonly removed: ReadonlyArray<{ readonly item: T; readonly score: number }>;
}

interface Trimmable {
  readonly id: string;
  /** Sin tags = sin anclaje posible. */
  readonly tags?: readonly string[] | undefined;
}

/**
 * Conserva los `limit` mejores por `(anclado desc, puntuación desc, índice asc)` manteniendo el
 * orden de entrada de los supervivientes; los anclados sobreviven siempre. `undefined` = sin
 * límite; `0` = ninguno (salvo anclados).
 */
export function keepTop<T extends Trimmable>(items: readonly T[], limit: number | undefined, scoreOf: ScoreLookup): KeepResult<T> {
  if (limit === undefined) {
    return { kept: [...items], removed: [] };
  }
  const ranked = items
    .map((item, index) => ({ item, index, score: scoreOf(item.id), pinned: isPinned(item.tags ?? []) }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.score - a.score || a.index - b.index);
  const pinnedCount = ranked.filter((entry) => entry.pinned).length;
  const keep = Math.max(limit, pinnedCount, 0);
  const survivors = new Set(ranked.slice(0, keep).map((entry) => entry.index));
  return {
    kept: items.filter((_, index) => survivors.has(index)),
    removed: ranked.slice(keep).map(({ item, score }) => ({ item, score })),
  };
}

export function applyLimits(profile: MasterProfile, limits: SectionLimits, scoreOf: ScoreLookup): TrimResult {
  const removed: RemovedItem[] = [];

  const trimContainer = <T extends { readonly id: string; readonly achievements: readonly Achievement[] }>(
    section: 'experience' | 'projects',
    container: T,
  ): T => {
    const result = keepTop(container.achievements, limits.achievementsPerContainer, scoreOf);
    removed.push(...result.removed.map(({ item, score }) => ({ section, id: item.id, parentId: container.id, score })));
    return { ...container, achievements: result.kept };
  };
  const trimFlat = <T extends Trimmable>(section: RemovableSection, items: readonly T[], limit: number | undefined): T[] => {
    const result = keepTop(items, limit, scoreOf);
    removed.push(...result.removed.map(({ item, score }) => ({ section, id: item.id, score })));
    return result.kept;
  };

  const experience = profile.experience.map((container) => trimContainer('experience', container));
  const projects = trimFlat('projects', profile.projects, limits.projects).map((container) => trimContainer('projects', container));
  const skills = trimFlat('skills', profile.skills, limits.skills);
  const certifications = trimFlat('certifications', profile.certifications, limits.certifications);
  const achievements = trimFlat('achievements', profile.achievements, limits.achievements);

  return { profile: { ...profile, experience, projects, skills, certifications, achievements }, removed };
}
