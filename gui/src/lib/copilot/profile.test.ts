import { describe, expect, it } from 'vitest';

import type { ProfileResponse } from '../api/types';
import { achievementOptions } from './profile';

describe('achievementOptions', () => {
  it('recorre experiencias, proyectos y logros transversales en orden de documento', () => {
    const profile = {
      experience: [{ role: 'Dev', company: 'ACME', achievements: [{ id: 'e1', text: 'Hice A' }, { id: 'e2', text: 'Hice B' }] }],
      projects: [{ name: 'Chameleon', achievements: [{ id: 'p1', text: 'Hice C' }] }],
      achievements: [{ id: 'a1', text: 'Hice D' }],
    } as unknown as ProfileResponse;
    expect(achievementOptions(profile)).toEqual([
      { id: 'e1', where: 'Dev · ACME', text: 'Hice A' },
      { id: 'e2', where: 'Dev · ACME', text: 'Hice B' },
      { id: 'p1', where: 'Proyecto Chameleon', text: 'Hice C' },
      { id: 'a1', where: 'Logros transversales', text: 'Hice D' },
    ]);
  });
});
