import { describe, expect, it } from 'vitest';

import { achievementRanges, afterFrontmatter, locateAchievementText, locateSummary, rawTextLength, replaceRange, replaceSummary } from '../../../src/parsers';

const SOURCE = [
  '---',
  'company: ACME',
  '---',
  '',
  'Descripción de la empresa.',
  '',
  '## Logros',
  '',
  '- Reduje la latencia p95 un **40 %**. #performance #php',
  '  - impact: -40 % p95',
  '- Lideré la migración',
  '  a Kubernetes sin parada. #kubernetes',
  '  - id: exp-acme-k8s',
  '- Sin etiquetas ni metadatos',
  '',
  '## Otros',
  '',
  '- Reduje la latencia p95 un **40 %**. #repetido',
  '',
].join('\n');

describe('cirugía del Markdown fuente (T-4.7)', () => {
  it('rawTextLength corta justo antes de la cola de hashtags, también con líneas de continuación', () => {
    expect(rawTextLength('Texto del logro. #a #b')).toBe('Texto del logro.'.length);
    expect(rawTextLength('Texto del logro.')).toBe('Texto del logro.'.length);
    expect(rawTextLength('Texto del logro.   ')).toBe('Texto del logro.'.length);
    expect(rawTextLength('Lideré la migración\n  a Kubernetes. #k8s')).toBe('Lideré la migración\n  a Kubernetes.'.length);
  });

  it('achievementRanges enumera todas las viñetas con su tramo de texto, línea y texto parseado', () => {
    const ranges = achievementRanges(SOURCE);
    expect(ranges.map((range) => [range.line, range.text])).toEqual([
      [9, 'Reduje la latencia p95 un **40 %**.'],
      [11, 'Lideré la migración a Kubernetes sin parada.'],
      [14, 'Sin etiquetas ni metadatos'],
      [18, 'Reduje la latencia p95 un **40 %**.'],
    ]);
    const second = ranges[1];
    expect(SOURCE.slice(second?.start, second?.end)).toBe('Lideré la migración\n  a Kubernetes sin parada.');
    expect(achievementRanges('# Título de nivel 1\n\n- viñeta')).toEqual([]);
    expect(achievementRanges('1. a\n2. b\n').map((range) => range.text)).toEqual(['a', 'b']);
    // Viñetas sin párrafo inicial (vacía o con una sublista) no son logros.
    expect(achievementRanges('-\n- - anidada\n- texto\n').map((range) => range.text)).toEqual(['texto']);
  });

  it('locateAchievementText exige igualdad exacta y, ante duplicados, elige el más cercano a la línea registrada', () => {
    expect(locateAchievementText(SOURCE, 'Sin etiquetas ni metadatos')?.line).toBe(14);
    expect(locateAchievementText(SOURCE, 'Sin etiquetas')).toBeUndefined();
    expect(locateAchievementText(SOURCE, 'Reduje la latencia p95 un **40 %**.')?.line).toBe(9);
    expect(locateAchievementText(SOURCE, 'Reduje la latencia p95 un **40 %**.', 17)?.line).toBe(18);
    expect(locateAchievementText(SOURCE, 'Reduje la latencia p95 un **40 %**.', 10)?.line).toBe(9);
    const range = locateAchievementText(SOURCE, 'Reduje la latencia p95 un **40 %**.', 9);
    if (range === undefined) throw new Error('rango');
    const updated = replaceRange(SOURCE, range.start, range.end, 'Rediseñé la caché y bajé la latencia p95 un 40 %.');
    expect(updated).toContain('- Rediseñé la caché y bajé la latencia p95 un 40 %. #performance #php\n  - impact: -40 % p95\n- Lideré la migración\n');
    expect(updated).toContain('- Reduje la latencia p95 un **40 %**. #repetido');
  });

  it('locateSummary encuentra el cuerpo anterior al primer encabezado o dónde insertarlo', () => {
    const present = locateSummary(SOURCE);
    expect(present).toMatchObject({ kind: 'present', range: { line: 5, text: 'Descripción de la empresa.' } });
    expect(replaceSummary(SOURCE, present, 'Nueva descripción.\n\nSegundo párrafo.')).toContain('---\n\nNueva descripción.\n\nSegundo párrafo.\n\n## Logros');
    const absent = locateSummary('---\ntitle: X\n---\n\n## Logros\n\n- a\n');
    expect(absent).toEqual({ kind: 'absent', insertAt: 17 });
    expect(replaceSummary('---\ntitle: X\n---\n\n## Logros\n\n- a\n', absent, 'Resumen.')).toBe('---\ntitle: X\n---\n\nResumen.\n\n## Logros\n\n- a\n');
    expect(replaceSummary('---\ntitle: X\n---\n## Logros\n', locateSummary('---\ntitle: X\n---\n## Logros\n'), 'Resumen.')).toBe('---\ntitle: X\n---\n\nResumen.\n\n## Logros\n');
    expect(replaceSummary('---\ntitle: X\n---', locateSummary('---\ntitle: X\n---'), 'Resumen.')).toBe('---\ntitle: X\n---\n\nResumen.\n');
    expect(replaceSummary('---\ntitle: X\n---\n', locateSummary('---\ntitle: X\n---\n'), 'Resumen.')).toBe('---\ntitle: X\n---\n\nResumen.\n');
    expect(replaceSummary('', locateSummary(''), 'Resumen.')).toBe('Resumen.\n');
    expect(replaceSummary('## Logros\n', locateSummary('## Logros\n'), 'Resumen.')).toBe('Resumen.\n\n## Logros\n');
    expect(locateSummary('# Nivel 1\n\nTexto')).toEqual({ kind: 'absent', insertAt: 0 });
  });

  it('afterFrontmatter tolera frontmatter ausente, sin cerrar o sin salto final', () => {
    expect(afterFrontmatter('sin frontmatter')).toBe(0);
    expect(afterFrontmatter('---\nabierto')).toBe(0);
    expect(afterFrontmatter('---\na: 1\n---')).toBe('---\na: 1\n---'.length);
    expect(afterFrontmatter('---\na: 1\n---\nresto')).toBe('---\na: 1\n---\n'.length);
  });
});
