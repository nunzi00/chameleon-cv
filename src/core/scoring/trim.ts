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
  /** Selección explícita de skills (ids o nombres): solo estas, antes del límite por cantidad (`--skills`). */
  readonly skillsInclude?: readonly string[] | undefined;
  /** Selección explícita de proyectos (ids o nombres): solo estos, antes del límite por cantidad (`--projects`). */
  readonly projectsInclude?: readonly string[] | undefined;
  /** Ids que los límites por cantidad no recortan (T-8.9: las evidencias que demuestran la oferta); cuentan para el límite. */
  readonly keep?: readonly string[] | undefined;
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
  /** Nombres o ids de la selección explícita que no existen en el perfil (aviso, no error). */
  readonly unknown: { readonly skills: readonly string[]; readonly projects: readonly string[] };
}

/** Clave de comparación de nombres e ids: minúsculas, sin acentos ni espacios sobrantes. */
export function selectionKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Selección explícita: conserva los ítems cuyo id o nombre está en la lista (en el orden del documento) y devuelve los
 * demás como recortados; los nombres que no casan con nada se devuelven aparte. La lista manda sobre los anclados.
 */
export function keepListed<T extends Trimmable & { readonly name: string }>(items: readonly T[], include: readonly string[], scoreOf: ScoreLookup): KeepResult<T> & { readonly unknown: readonly string[] } {
  const wanted = new Set(include.map(selectionKey));
  const matched = new Set<string>();
  const kept: T[] = [];
  const removed: Array<{ readonly item: T; readonly score: number }> = [];
  for (const item of items) {
    const keys = [selectionKey(item.id), selectionKey(item.name)];
    const hit = keys.find((key) => wanted.has(key));
    if (hit === undefined) {
      removed.push({ item, score: scoreOf(item.id) });
    } else {
      keys.forEach((key) => matched.add(key));
      kept.push(item);
    }
  }
  return { kept, removed, unknown: include.filter((value) => !matched.has(selectionKey(value))) };
}

/** Preset `--compact`: la vía rápida a un CV de una página. */
export const COMPACT_LIMITS: Required<Omit<SectionLimits, 'skillsInclude' | 'projectsInclude' | 'keep'>> = {
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

const NO_KEEP: ReadonlySet<string> = new Set();

/**
 * Conserva los `limit` mejores por `(anclado desc, puntuación desc, índice asc)` manteniendo el
 * orden de entrada de los supervivientes; los anclados (tag #pin o id en `keep`) sobreviven siempre.
 * `undefined` = sin límite; `0` = ninguno (salvo anclados).
 */
export function keepTop<T extends Trimmable>(items: readonly T[], limit: number | undefined, scoreOf: ScoreLookup, protectedIds: ReadonlySet<string> = NO_KEEP): KeepResult<T> {
  if (limit === undefined) {
    return { kept: [...items], removed: [] };
  }
  const ranked = items
    .map((item, index) => ({ item, index, score: scoreOf(item.id), pinned: isPinned(item.tags ?? []) || protectedIds.has(item.id) }))
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
  const protectedIds: ReadonlySet<string> = new Set(limits.keep ?? []);

  const trimContainer = <T extends { readonly id: string; readonly achievements: readonly Achievement[] }>(
    section: 'experience' | 'projects',
    container: T,
  ): T => {
    const result = keepTop(container.achievements, limits.achievementsPerContainer, scoreOf, protectedIds);
    removed.push(...result.removed.map(({ item, score }) => ({ section, id: item.id, parentId: container.id, score })));
    return { ...container, achievements: result.kept };
  };
  const trimFlat = <T extends Trimmable>(section: RemovableSection, items: readonly T[], limit: number | undefined): T[] => {
    const result = keepTop(items, limit, scoreOf, protectedIds);
    removed.push(...result.removed.map(({ item, score }) => ({ section, id: item.id, score })));
    return result.kept;
  };

  const listed = <T extends Trimmable & { readonly name: string }>(section: 'skills' | 'projects', items: readonly T[], include: readonly string[] | undefined): { readonly kept: readonly T[]; readonly unknown: readonly string[] } => {
    if (include === undefined) {
      return { kept: items, unknown: [] };
    }
    const result = keepListed(items, include, scoreOf);
    removed.push(...result.removed.map(({ item, score }) => ({ section, id: item.id, score })));
    return { kept: result.kept, unknown: result.unknown };
  };

  const experience = profile.experience.map((container) => trimContainer('experience', container));
  const listedProjects = listed('projects', profile.projects, limits.projectsInclude);
  const projects = trimFlat('projects', listedProjects.kept, limits.projects).map((container) => trimContainer('projects', container));
  const listedSkills = listed('skills', profile.skills, limits.skillsInclude);
  const skills = trimFlat('skills', listedSkills.kept, limits.skills);
  const certifications = trimFlat('certifications', profile.certifications, limits.certifications);
  const achievements = trimFlat('achievements', profile.achievements, limits.achievements);

  return { profile: { ...profile, experience, projects, skills, certifications, achievements }, removed, unknown: { skills: listedSkills.unknown, projects: listedProjects.unknown } };
}
