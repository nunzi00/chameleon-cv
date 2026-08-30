/**
 * Límites de recorte (`docs/trimming-cli.md` §3.4, §4.1): enteros ≥ 0, con el preset `compact` como base
 * y los límites explícitos por encima.
 */
import { COMPACT_LIMITS, type SectionLimits } from '../core/scoring';

export interface LimitOptions {
  readonly topN?: number | undefined;
  readonly maxSkills?: number | undefined;
  readonly maxProjects?: number | undefined;
  readonly maxCertifications?: number | undefined;
  readonly compact: boolean;
  /** Solo estas skills (ids o nombres), antes de `maxSkills`. */
  readonly skills?: readonly string[] | undefined;
  /** Solo estos proyectos (ids o nombres), antes de `maxProjects`. */
  readonly projects?: readonly string[] | undefined;
}

const listOrUndefined = (values: readonly string[] | undefined): readonly string[] | undefined => (values === undefined || values.length === 0 ? undefined : values);

export function resolveLimits(options: LimitOptions): SectionLimits {
  const preset: SectionLimits = options.compact ? COMPACT_LIMITS : {};
  return {
    achievementsPerContainer: options.topN ?? preset.achievementsPerContainer,
    achievements: options.topN ?? preset.achievements,
    skills: options.maxSkills ?? preset.skills,
    projects: options.maxProjects ?? preset.projects,
    certifications: options.maxCertifications ?? preset.certifications,
    skillsInclude: listOrUndefined(options.skills),
    projectsInclude: listOrUndefined(options.projects),
  };
}

export function hasLimits(limits: SectionLimits): boolean {
  return Object.entries(limits).some(([key, limit]) => key !== 'keep' && limit !== undefined);
}

/** `--top-n 1, --max-skills 2` (solo los límites definidos). */
export function describeLimits(limits: SectionLimits): string {
  const parts = [
    limits.achievementsPerContainer === undefined ? undefined : `--top-n ${limits.achievementsPerContainer}`,
    limits.skills === undefined ? undefined : `--max-skills ${limits.skills}`,
    limits.projects === undefined ? undefined : `--max-projects ${limits.projects}`,
    limits.certifications === undefined ? undefined : `--max-certifications ${limits.certifications}`,
    limits.skillsInclude === undefined ? undefined : `--skills ${limits.skillsInclude.join(',')}`,
    limits.projectsInclude === undefined ? undefined : `--projects ${limits.projectsInclude.join(',')}`,
  ];
  return parts.filter((part): part is string => part !== undefined).join(', ');
}
