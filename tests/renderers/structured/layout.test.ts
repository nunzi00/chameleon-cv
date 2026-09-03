/**
 * La organización declarada por un tema (T-9.26): el orden de las secciones, los logros consolidados con su
 * origen y la experiencia en una línea por puesto. Es lo que hereda el ODT del `[layout]` de `theme.toml`.
 */
import { describe, expect, it } from 'vitest';

import { parseMasterProfile } from '../../../src/core/schema';
import { DEFAULT_LAYOUT, LAYOUT_SECTIONS, applyLayout, buildStructuredView, resolveLayout } from '../../../src/renderers/structured';
import { fullProfileInput } from '../../fixtures/master-profile';

function view() {
  return buildStructuredView(parseMasterProfile(fullProfileInput()), 'es-ES');
}

describe('resolveLayout', () => {
  it('sin [layout] es la organización de siempre', () => {
    expect(resolveLayout(undefined)).toEqual(DEFAULT_LAYOUT);
  });

  it('las secciones que el tema no nombra van detrás, en su orden natural, y nunca se pierden', () => {
    const layout = resolveLayout({ sections: ['skills', 'education'] });
    expect(layout.sections.slice(0, 2)).toEqual(['skills', 'education']);
    expect([...layout.sections].sort()).toEqual([...LAYOUT_SECTIONS].sort());
    expect(layout.achievements).toBe('per-entry');
    expect(layout.experience).toBe('detailed');
  });

  it('lo que el tema sí declara manda', () => {
    expect(resolveLayout({ achievements: 'consolidated', experience: 'compact' })).toMatchObject({ achievements: 'consolidated', experience: 'compact' });
  });
});

describe('applyLayout', () => {
  it('con la organización por defecto devuelve la vista tal cual: el PDF y el Markdown no cambian', () => {
    const original = view();
    expect(applyLayout(original, DEFAULT_LAYOUT)).toEqual(original);
  });

  it('«consolidated» sube los logros de cada puesto y proyecto a la sección común, con su origen', () => {
    const original = view();
    const applied = applyLayout(original, resolveLayout({ achievements: 'consolidated' }));
    const experience = original.experience.find((item) => item.achievements.length > 0);
    expect(experience).toBeDefined();
    // Ya no cuelgan de su entrada…
    expect(applied.experience.every((item) => item.achievements.length === 0)).toBe(true);
    expect(applied.projects.every((item) => item.achievements.length === 0)).toBe(true);
    // …sino de la sección común, con la empresa (o el proyecto) del que salen, y sin perder ninguno.
    expect(applied.achievements.length).toBe(
      original.achievements.length + original.experience.reduce((sum, item) => sum + item.achievements.length, 0) + original.projects.reduce((sum, item) => sum + item.achievements.length, 0),
    );
    expect(applied.achievements[0]).toMatchObject({ source: experience?.company });
    expect(applied.achievements.filter((item) => item.source !== undefined)).toHaveLength(1);
    // Los del propio perfil se quedan como estaban: no tienen origen que anotar.
    expect(applied.achievements.at(-1)?.source).toBeUndefined();
  });

  it('consolidar deja además la experiencia en una línea: sus logros ya se cuentan arriba', () => {
    const applied = applyLayout(view(), resolveLayout({ achievements: 'consolidated' }));
    expect(applied.experience.every((item) => item.summary.length === 0 && item.technologies === '')).toBe(true);
  });

  it('«compact» quita resumen, logros y tecnologías de cada puesto, y no toca los proyectos', () => {
    const original = view();
    const applied = applyLayout(original, resolveLayout({ experience: 'compact' }));
    expect(applied.experience.every((item) => item.achievements.length === 0 && item.summary.length === 0 && item.technologies === '')).toBe(true);
    // El puesto sigue siendo reconocible: rol, empresa y periodo son lo que no se toca.
    expect(applied.experience[0]).toMatchObject({ role: original.experience[0]?.role, company: original.experience[0]?.company, period: original.experience[0]?.period });
    expect(applied.projects).toEqual(original.projects);
    expect(applied.achievements).toEqual(original.achievements);
  });
});
