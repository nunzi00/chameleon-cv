/**
 * Límites de recorte de la CLI (`docs/trimming-cli.md` §3.4, §4.1): enteros ≥ 0, con el preset
 * `--compact` como base y los límites explícitos por encima.
 */
import { InvalidArgumentError } from 'commander';

import { COMPACT_LIMITS, type SectionLimits } from '../core/scoring';

export interface LimitOptions {
  readonly topN?: number | undefined;
  readonly maxSkills?: number | undefined;
  readonly maxProjects?: number | undefined;
  readonly maxCertifications?: number | undefined;
  readonly compact: boolean;
}

/** `argParser` de commander: un entero mayor o igual que 0. */
export function parseLimit(value: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new InvalidArgumentError('debe ser un entero mayor o igual que 0');
  }
  return Number(value);
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

/** `--proposals`: entre 1 y 3 propuestas por logro. */
export function parseProposals(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3) {
    throw new InvalidArgumentError('debe ser un entero entre 1 y 3');
  }
  return parsed;
}
