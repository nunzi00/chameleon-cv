import { describe, expect, it } from 'vitest';

import { GenerateSchema } from '../../src/serve/contract';

describe('POST /generate: selección explícita de skills y proyectos', () => {
  it('admite listas de nombres o ids y rechaza cadenas vacías', () => {
    expect(GenerateSchema.safeParse({ format: 'md', skills: ['PHP', 'skill-2'], projects: ['proj-a'] }).success).toBe(true);
    expect(GenerateSchema.safeParse({ format: 'md', skills: [''] }).success).toBe(false);
    expect(GenerateSchema.safeParse({ format: 'md', projects: 'proj-a' }).success).toBe(false);
  });
});

describe('keepEvidence (T-8.9)', () => {
  it('GenerateSchema admite keepEvidence booleano y rechaza otros tipos', () => {
    expect(GenerateSchema.parse({ keepEvidence: false })).toMatchObject({ keepEvidence: false });
    expect(GenerateSchema.safeParse({ keepEvidence: 'no' }).success).toBe(false);
  });
});
