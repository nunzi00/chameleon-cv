import { InvalidArgumentError } from 'commander';
import { describe, expect, it } from 'vitest';

import { CV_FORMATS, isCvFormat, parseFormat } from '../../src/cli/format';

describe('parseFormat', () => {
  it('admite md, pdf y odt sin distinguir mayúsculas y rechaza el resto con un error de uso', () => {
    expect(CV_FORMATS).toEqual(['md', 'pdf', 'odt']);
    expect(parseFormat('md')).toBe('md');
    expect(parseFormat(' PDF ')).toBe('pdf');
    expect(parseFormat(' ODT ')).toBe('odt');
    expect(isCvFormat('docx')).toBe(false);
    expect(() => parseFormat('docx')).toThrow(new InvalidArgumentError('formatos admitidos: md, pdf, odt'));
  });
});
