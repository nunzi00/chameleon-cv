import type { List } from 'mdast';
import { describe, expect, it } from 'vitest';

import { parseAchievementList, splitTrailingHashtags } from '../../../src/parsers/markdown/achievements';
import { onlyList, parseMarkdownDocument } from '../../../src/parsers/markdown/document';

function listOf(markdown: string): List {
  const result = parseMarkdownDocument(markdown, 'f.md');
  if (!result.ok) {
    throw new Error(JSON.stringify(result.errors));
  }
  const list = onlyList(result.document.leading);
  if (list === undefined) {
    throw new Error('La fixture debe ser una única lista');
  }
  return list;
}

function parse(markdown: string, parentId = 'exp-acme') {
  return parseAchievementList(listOf(markdown), markdown, 'f.md', parentId);
}

function expectErrors(markdown: string): readonly string[] {
  const result = parse(markdown);
  if (result.ok) {
    throw new Error('Se esperaban errores');
  }
  return result.errors.map((error) => `${error.line}: ${error.message}`);
}

describe('parseAchievementList', () => {
  it('extrae texto, hashtags, metadatos, ids posicionales o explícitos y líneas', () => {
    const markdown = [
      '- Reduje la latencia un **40 %**. #performance #php',
      '  - impact: -40 % p95',
      '  - date: 2023-05',
      '- Segundo logro',
      '  - id: custom-id',
      '- Tercero',
      '',
    ].join('\n');
    const result = parse(markdown);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.achievements.map((achievement) => achievement.input)).toEqual([
      { id: 'exp-acme-1', text: 'Reduje la latencia un **40 %**.', tags: ['performance', 'php'], impact: '-40 % p95', date: '2023-05' },
      { id: 'custom-id', text: 'Segundo logro', tags: [] },
      { id: 'exp-acme-3', text: 'Tercero', tags: [] },
    ]);
    expect(result.achievements.map((achievement) => achievement.line)).toEqual([1, 4, 6]);
    expect(Object.fromEntries(result.achievements[0]?.lines ?? [])).toEqual({ text: 1, tags: 1, id: 1, impact: 2, date: 3 });
    expect(result.achievements[1]?.lines.get('id')).toBe(5);
  });

  it('une las líneas de continuación con un espacio', () => {
    const result = parse('- Primera línea\n  segunda línea #tag\n');
    expect(result.ok && result.achievements[0]?.input).toEqual({ id: 'exp-acme-1', text: 'Primera línea segunda línea', tags: ['tag'] });
  });

  it('solo reconoce hashtags al final; «#» en medio, en código o en URLs se conserva', () => {
    const result = parse('- Uso #php en producción\n- Ver `#include` y https://x/#top\n- #solo #tags\n');
    expect(result.ok && result.achievements.map((achievement) => [achievement.input.text, achievement.input.tags])).toEqual([
      ['Uso #php en producción', []],
      ['Ver `#include` y https://x/#top', []],
      ['', ['solo', 'tags']],
    ]);
  });

  it('rechaza listas numeradas', () => {
    expect(expectErrors('1. Uno\n2. Dos\n')).toEqual(['1: Los logros se escriben como lista con viñetas «- », no numerada']);
  });

  it('rechaza viñetas vacías o que no empiezan por texto', () => {
    expect(expectErrors('-\n- - anidada\n')).toEqual([
      '1: Logro 1: la viñeta debe empezar por el texto del logro',
      '2: Logro 2: la viñeta debe empezar por el texto del logro',
    ]);
  });

  it('rechaza más de un párrafo o contenido tras la sub-lista', () => {
    expect(expectErrors('- Uno\n\n  Dos\n')).toEqual([
      '1: Logro 1: solo se admite un párrafo y, opcionalmente, una sub-lista de metadatos «clave: valor»',
    ]);
    expect(expectErrors('- Uno\n  - impact: x\n\n  Tres\n')).toEqual([
      '1: Logro 1: solo se admite un párrafo y, opcionalmente, una sub-lista de metadatos «clave: valor»',
    ]);
  });

  it.each<[string, string, string]>([
    ['clave desconocida', '- Uno\n  - foo: bar\n', '2: Logro 1: metadato «foo» no admitido (admitidos: impact, date, id)'],
    ['sin dos puntos', '- Uno\n  - sin separador\n', '2: Logro 1: metadato mal formado; usa «clave: valor»'],
    ['empieza por dos puntos', '- Uno\n  - : valor\n', '2: Logro 1: metadato mal formado; usa «clave: valor»'],
    ['sin valor', '- Uno\n  - impact:\n', '2: Logro 1: el metadato «impact» no tiene valor'],
    ['repetido', '- Uno\n  - date: 2020\n  - date: 2021\n', '3: Logro 1: metadato «date» repetido'],
    ['sub-sub-lista', '- Uno\n  - impact: x\n    - profundo\n', '2: Logro 1: cada metadato es una línea «clave: valor», sin sub-listas'],
    ['sub-lista numerada', '- Uno\n  1. impact: x\n', '2: Logro 1: los metadatos van en una sub-lista con viñetas «- »'],
  ])('rechaza metadatos mal formados: %s', (_label, markdown, expected) => {
    expect(expectErrors(markdown)).toEqual([expected]);
  });

  it('acumula los errores de todas las viñetas', () => {
    expect(expectErrors('- Uno\n  - foo: 1\n- Dos\n  - bar: 2\n')).toHaveLength(2);
  });
});

describe('splitTrailingHashtags', () => {
  it('devuelve el texto recortado sin etiquetas cuando no hay hashtags', () => {
    expect(splitTrailingHashtags('  texto  ')).toEqual({ text: 'texto', tags: [] });
  });

  it('separa las etiquetas finales aunque vayan en la línea siguiente', () => {
    expect(splitTrailingHashtags('texto\n  #a #b  ')).toEqual({ text: 'texto', tags: ['a', 'b'] });
  });
});
