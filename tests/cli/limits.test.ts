import { InvalidArgumentError } from 'commander';
import { describe, expect, it } from 'vitest';

import { parseLimit, parseList } from '../../src/cli/limits';

describe('parsers de límites', () => {
  it('parseList separa por comas, recorta espacios y rechaza listas vacías', () => {
    expect(parseList(' PHP , Kubernetes,, proj-a ')).toEqual(['PHP', 'Kubernetes', 'proj-a']);
    expect(() => parseList(' , ')).toThrow(InvalidArgumentError);
    expect(parseLimit('3')).toBe(3);
  });
});
