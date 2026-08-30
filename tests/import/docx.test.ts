/**
 * Extractor DOCX mínimo (T-8.4b): document.xml a texto plano —párrafos, w:t, tabuladores, saltos, viñetas—
 * y los fallos como mensaje (zip roto, sin document.xml, sin texto). El zip se fabrica con el mismo formato
 * store que admite el lector del producto.
 */
import { describe, expect, it } from 'vitest';

import { zipOf } from '../helpers/zip';

import { documentXmlToText, extractDocxText, paragraphText } from '../../src/import/docx';

const DOC = (body: string): string => `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;

describe('paragraphText y documentXmlToText', () => {
  it('une los w:t, convierte tabuladores y saltos, y decodifica entidades', () => {
    expect(paragraphText('<w:p><w:r><w:t>Backend</w:t></w:r><w:tab/><w:r><w:t xml:space="preserve"> &amp; datos</w:t></w:r><w:br/><w:r><w:t>&#233;xito &#x2192; ok</w:t></w:r></w:p>')).toBe('Backend  & datos\néxito → ok');
  });

  it('un párrafo por línea, los numerados como viñetas y los vacíos fuera', () => {
    const xml = DOC('<w:p><w:r><w:t>Experiencia</w:t></w:r></w:p><w:p/><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Migré 14 servicios.</w:t></w:r></w:p>');
    expect(documentXmlToText(xml)).toBe('Experiencia\n- Migré 14 servicios.');
  });
});

describe('extractDocxText', () => {
  it('extrae el texto de un .docx mínimo', () => {
    const bytes = zipOf([['word/document.xml', DOC('<w:p><w:r><w:t>Ada Ejemplo</w:t></w:r></w:p>')]]);
    expect(extractDocxText(bytes)).toEqual({ ok: true, text: 'Ada Ejemplo' });
  });

  it('sin document.xml, con zip roto o sin texto lo dice sin lanzar', () => {
    expect(extractDocxText(zipOf([['word/otra.xml', '<x/>']]))).toMatchObject({ ok: false, message: expect.stringContaining('no contiene word/document.xml') as string });
    expect(extractDocxText(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]))).toMatchObject({ ok: false, message: expect.stringContaining('zip') as string });
    expect(extractDocxText(zipOf([['word/document.xml', DOC('<w:p/>')]]))).toMatchObject({ ok: false, message: 'el documento no tiene texto' });
  });
});
