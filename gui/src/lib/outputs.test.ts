import { describe, expect, it } from 'vitest';

import { classifyOutputs, isTextual, outputKind } from './outputs';

describe('salidas', () => {
  it('clasifica por extensión y ordena CV, revisiones y el resto', () => {
    expect(outputKind('cv-ada.pdf')).toBe('pdf');
    expect(outputKind('cv-ada.ODT')).toBe('odt');
    expect(outputKind('cv-ada.md')).toBe('markdown');
    expect(outputKind('revision-improve-2026-08-29.md')).toBe('review');
    expect(outputKind('notas.txt')).toBe('other');
    const items = classifyOutputs([
      { name: 'revision-summarize.md', bytes: 3 },
      { name: 'b.md', bytes: 2 },
      { name: 'z.pdf', bytes: 1 },
      { name: 'y.odt', bytes: 1 },
      { name: 'a.md', bytes: 2 },
      { name: 'x.txt', bytes: 4 },
    ]);
    expect(items.map((item) => `${item.kind}:${item.name}`)).toEqual(['pdf:z.pdf', 'odt:y.odt', 'markdown:a.md', 'markdown:b.md', 'review:revision-summarize.md', 'other:x.txt']);
  });

  it('distingue lo que se muestra como texto', () => {
    expect(isTextual('text/markdown; charset=utf-8')).toBe(true);
    expect(isTextual('application/json')).toBe(true);
    expect(isTextual('application/pdf')).toBe(false);
    // Un ODT tampoco es texto que enseñar: se descarga y se abre en el editor.
    expect(isTextual('application/vnd.oasis.opendocument.text')).toBe(false);
  });
});
