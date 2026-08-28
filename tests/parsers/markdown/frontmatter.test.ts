import { describe, expect, it } from 'vitest';
import { LineCounter, Pair, Scalar, YAMLMap, YAMLSeq } from 'yaml';

import { collectLines, firstLine, parseFrontmatter, yamlErrorLine, yamlNodeLine } from '../../../src/parsers/markdown/frontmatter';

function expectErrors(yaml: string): readonly { file: string; line?: number | undefined; message: string }[] {
  const result = parseFrontmatter(yaml, 'f.md', 1);
  if (result.ok) {
    throw new Error('Se esperaba un frontmatter inválido');
  }
  return result.errors;
}

describe('parseFrontmatter', () => {
  it('devuelve cadenas (failsafe) y la línea de fichero de cada clave, incluidas las anidadas', () => {
    const result = parseFrontmatter(
      'company: ACME\nstart: 2021\nlocation:\n  city: Madrid\nlinks:\n  - label: GitHub\n    url: https://x\ntags: [php, symfony]\n',
      'f.md',
      1,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.frontmatter.data).toEqual({
        company: 'ACME',
        start: '2021',
        location: { city: 'Madrid' },
        links: [{ label: 'GitHub', url: 'https://x' }],
        tags: ['php', 'symfony'],
      });
      expect(Object.fromEntries(result.frontmatter.lines)).toEqual({
        company: 2,
        start: 3,
        location: 4,
        'location.city': 5,
        links: 6,
        'links[0]': 7,
        'links[0].label': 7,
        'links[0].url': 8,
        tags: 9,
        'tags[0]': 9,
        'tags[1]': 9,
      });
      expect(result.frontmatter.line).toBe(1);
    }
  });

  it('conserva los valores vacíos como cadena vacía (los descarta el llamador)', () => {
    const result = parseFrontmatter('end:\n', 'f.md', 1);
    expect(result.ok && result.frontmatter.data).toEqual({ end: '' });
  });

  it('rechaza claves duplicadas señalando la línea del duplicado', () => {
    expect(expectErrors('a: 1\na: 2\n')).toEqual([
      { file: 'f.md', line: 3, message: expect.stringContaining('Frontmatter YAML inválido: Map keys must be unique') },
    ]);
  });

  it('rechaza anchors y alias', () => {
    expect(expectErrors('base: &b [x]\ncopy: *b\n')).toEqual([
      { file: 'f.md', line: 1, message: 'El frontmatter no admite anchors ni alias YAML' },
    ]);
  });

  it.each(['- a\n- b\n', 'hola\n', ''])('rechaza un frontmatter que no es un mapa (%j)', (yaml) => {
    expect(expectErrors(yaml)).toEqual([{ file: 'f.md', line: 1, message: 'El frontmatter debe ser un mapa «clave: valor»' }]);
  });

  it('reporta los errores de sintaxis con su línea', () => {
    const errors = expectErrors('a: [1, 2\nb: 3\n');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ file: 'f.md', line: 3 });
    expect(errors[0]?.message).toMatch(/^Frontmatter YAML inválido: /);
    expect(errors[0]?.message).not.toContain('\n');
  });
});

describe('utilidades', () => {
  it('yamlErrorLine suma la posición del error a la línea del bloque, o devuelve esta si no hay posición', () => {
    expect(yamlErrorLine({ message: 'x', linePos: [{ line: 2 }] }, 4)).toBe(6);
    expect(yamlErrorLine({ message: 'x' }, 4)).toBe(4);
  });

  it('firstLine devuelve la primera línea', () => {
    expect(firstLine('a\nb')).toBe('a');
    expect(firstLine('solo')).toBe('solo');
  });

  it('yamlNodeLine devuelve undefined para valores que no son nodos o que no tienen rango', () => {
    expect(yamlNodeLine('x', new LineCounter(), 1)).toBeUndefined();
    expect(yamlNodeLine(new Scalar('x'), new LineCounter(), 1)).toBeUndefined();
  });

  it('collectLines omite los nodos sintéticos sin rango y nombra las claves complejas por su texto', () => {
    const map = new YAMLMap<unknown, unknown>();
    map.items.push(new Pair(new Scalar('k'), new Scalar('v')));
    const seq = new YAMLSeq<unknown>();
    seq.items.push(new Scalar('x'));
    map.items.push(new Pair(new Scalar('list'), seq));
    map.items.push(new Pair(new YAMLSeq<unknown>(), new Scalar('complex')));
    const lines = new Map<string, number>();
    collectLines(map, [], lines, new LineCounter(), 1);
    expect(lines.size).toBe(0);
  });
});
