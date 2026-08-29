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
}

export function resolveLimits(options: LimitOptions): SectionLimits {
  const preset: SectionLimits = options.compact ? COMPACT_LIMITS : {};
  return {
    achievementsPerContainer: options.topN ?? preset.achievementsPerContainer,
    achievements: options.topN ?? preset.achievements,
    skills: options.maxSkills ?? preset.skills,
    projects: options.maxProjects ?? preset.projects,
    certifications: options.maxCertifications ?? preset.certifications,
  };
}

export function hasLimits(limits: SectionLimits): boolean {
  return Object.values(limits).some((limit) => limit !== undefined);
}

/** `--top-n 1, --max-skills 2` (solo los límites definidos). */
export function describeLimits(limits: SectionLimits): string {
  const parts = [
    limits.achievementsPerContainer === undefined ? undefined : `--top-n ${limits.achievementsPerContainer}`,
    limits.skills === undefined ? undefined : `--max-skills ${limits.skills}`,
    limits.projects === undefined ? undefined : `--max-projects ${limits.projects}`,
    limits.certifications === undefined ? undefined : `--max-certifications ${limits.certifications}`,
  ];
  return parts.filter((part): part is string => part !== undefined).join(', ');
}
