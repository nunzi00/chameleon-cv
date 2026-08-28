import { describe, expect, it } from 'vitest';

import { inlineText, onlyList, parseMarkdownDocument, sliceNodes, type MarkdownDocument } from '../../../src/parsers/markdown/document';

function parseOk(source: string): MarkdownDocument {
  const result = parseMarkdownDocument(source, 'f.md');
  if (!result.ok) {
    throw new Error(JSON.stringify(result.errors));
  }
  return result.document;
}

describe('parseMarkdownDocument', () => {
  it('separa frontmatter, nodos iniciales y secciones «##» con sus líneas', () => {
    const source = '---\na: 1\n---\n\nResumen *uno*.\n\nSegundo.\n\n## Logros\n\n- Uno\n\n## Otra\n\nTexto.\n';
    const document = parseOk(source);
    expect(document.frontmatter).toEqual({ yaml: 'a: 1', line: 1 });
    expect(document.leading).toHaveLength(2);
    expect(sliceNodes(source, document.leading)).toEqual({ text: 'Resumen *uno*.\n\nSegundo.', line: 5 });
    expect(document.sections.map((section) => [section.name, section.line])).toEqual([
      ['Logros', 9],
      ['Otra', 13],
    ]);
    expect(onlyList(document.sections[0]?.nodes ?? [])).toBeDefined();
    expect(onlyList(document.sections[1]?.nodes ?? [])).toBeUndefined();
  });

  it('admite ficheros sin frontmatter ni secciones', () => {
    const document = parseOk('Solo texto.\n');
    expect(document.frontmatter).toBeUndefined();
    expect(document.sections).toEqual([]);
    expect(document.leading).toHaveLength(1);
  });

  it('rechaza todos los encabezados que no sean de nivel 2, con su línea', () => {
    const result = parseMarkdownDocument('# Uno\n\n## Dos\n\n### Tres\n', 'f.md');
    expect(result).toEqual({
      ok: false,
      errors: [
        { file: 'f.md', line: 1, message: 'Encabezado de nivel 1 no admitido: solo se reconocen secciones «## …»' },
        { file: 'f.md', line: 5, message: 'Encabezado de nivel 3 no admitido: solo se reconocen secciones «## …»' },
      ],
    });
  });

  it('lee el nombre de una sección con formato en línea, imágenes y en estilo setext', () => {
    const document = parseOk('## Logros *del* `año` ![icono](i.png)\n\nLogros\n------\n');
    expect(document.sections.map((section) => section.name)).toEqual(['Logros del año', 'Logros']);
  });
});

describe('utilidades', () => {
  it('sliceNodes devuelve undefined sin nodos', () => {
    expect(sliceNodes('', [])).toBeUndefined();
  });

  it('onlyList exige exactamente una lista', () => {
    expect(onlyList(parseOk('- a\n\ntexto\n').leading)).toBeUndefined();
    expect(onlyList(parseOk('texto\n').leading)).toBeUndefined();
    expect(onlyList(parseOk('- a\n').leading)?.type).toBe('list');
  });

  it('inlineText concatena literales y devuelve vacío para nodos sin texto', () => {
    expect(inlineText({ type: 'text', value: 'hola' })).toBe('hola');
    expect(inlineText({ type: 'thematicBreak' })).toBe('');
  });
});
