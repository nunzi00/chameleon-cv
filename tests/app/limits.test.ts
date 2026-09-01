import { describe, expect, it } from 'vitest';

import { describeLimits, hasLimits, resolveLimits } from '../../src/app/limits';

describe('límites de recorte con selección explícita', () => {
  it('resolveLimits traduce las listas a skillsInclude/projectsInclude y omite las vacías', () => {
    expect(resolveLimits({ compact: false })).toEqual({ achievementsPerContainer: undefined, achievements: undefined, skills: undefined, projects: undefined, certifications: undefined, skillsInclude: undefined, projectsInclude: undefined, skillsExclude: undefined, projectsExclude: undefined });
    expect(resolveLimits({ compact: false, skills: [], projects: ['proj-a'] })).toMatchObject({ skillsInclude: undefined, projectsInclude: ['proj-a'] });
    expect(resolveLimits({ compact: true, skills: ['PHP'], maxSkills: 3 })).toMatchObject({ skills: 3, projects: 4, skillsInclude: ['PHP'], projectsInclude: undefined });
  });

  it('la lista de exclusión viaja aparte de la de inclusión, y la vacía tampoco cuenta', () => {
    expect(resolveLimits({ compact: false, excludeSkills: ['PHP'], excludeProjects: [] })).toMatchObject({ skillsExclude: ['PHP'], projectsExclude: undefined, skillsInclude: undefined });
    expect(resolveLimits({ compact: false, skills: ['PHP', 'Go'], excludeSkills: ['Go'] })).toMatchObject({ skillsInclude: ['PHP', 'Go'], skillsExclude: ['Go'] });
  });

  it('hasLimits y describeLimits tienen en cuenta las listas', () => {
    const limits = resolveLimits({ compact: false, skills: ['PHP', 'Kubernetes'], projects: ['proj-a'] });
    expect(hasLimits(limits)).toBe(true);
    expect(describeLimits(limits)).toBe('--skills PHP,Kubernetes, --projects proj-a');
    expect(describeLimits(resolveLimits({ compact: false, topN: 2, skills: ['PHP'] }))).toBe('--top-n 2, --skills PHP');
    const excluidas = resolveLimits({ compact: false, excludeSkills: ['PHP'], excludeProjects: ['proj-a'] });
    expect(hasLimits(excluidas)).toBe(true);
    expect(describeLimits(excluidas)).toBe('--exclude-skills PHP, --exclude-projects proj-a');
  });
});
