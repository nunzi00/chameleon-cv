import { describe, expect, it } from 'vitest';

import { blocks, inlineRuns, nodeRuns, type Run } from '../../../src/renderers/pdf';

const plain = (text: string): Run => ({ text, bold: false, italic: false, code: false, link: undefined });

describe('inlineRuns', () => {
  it('descompone negrita, cursiva, código y enlaces (anidados incluidos) en runs', () => {
    expect(inlineRuns('Reduje **la latencia** *p95* con `k6` en [ACME](https://acme.example)')).toEqual([
      plain('Reduje '),
      { text: 'la latencia', bold: true, italic: false, code: false, link: undefined },
      plain(' '),
      { text: 'p95', bold: false, italic: true, code: false, link: undefined },
      plain(' con '),
      { text: 'k6', bold: false, italic: false, code: true, link: undefined },
      plain(' en '),
      { text: 'ACME', bold: false, italic: false, code: false, link: 'https://acme.example' },
    ]);
    expect(inlineRuns('***fuerte y cursiva***')).toEqual([{ text: 'fuerte y cursiva', bold: true, italic: true, code: false, link: undefined }]);
  });

  it('convierte saltos de línea duros, imágenes y HTML en texto plano', () => {
    expect(inlineRuns('a  \nb')).toEqual([plain('a'), plain('\n'), plain('b')]);
    expect(inlineRuns('![logo](x.png) ![](y.png)')).toEqual([plain('logo'), plain(' '), plain('')]);
    expect(nodeRuns({ type: 'image', url: 'x.png' })).toEqual([plain('')]);
    expect(inlineRuns('<b>x</b>')).toEqual([plain('<b>'), plain('x'), plain('</b>')]);
    expect(inlineRuns('')).toEqual([]);
    // Referencias: el enlace por referencia conserva su texto; la imagen por referencia no aporta nada.
    expect(inlineRuns('[texto][ref] ![alt][ref]\n\n[ref]: https://x.example')).toEqual([plain('texto'), plain(' ')]);
  });
});

describe('blocks', () => {
  it('separa párrafos, listas (con viñeta), citas, código y títulos; ignora las reglas horizontales', () => {
    const result = blocks('Primero.\n\nSegundo **fuerte**.\n\n- uno\n- dos\n\n> cita\n\n---\n\n```\ncódigo\n```\n\n# Título');
    expect(result).toEqual([
      { runs: [plain('Primero.')], bullet: false, code: false },
      { runs: [plain('Segundo '), { text: 'fuerte', bold: true, italic: false, code: false, link: undefined }, plain('.')], bullet: false, code: false },
      { runs: [plain('uno')], bullet: true, code: false },
      { runs: [plain('dos')], bullet: true, code: false },
      { runs: [plain('cita')], bullet: false, code: false },
      { runs: [{ text: 'código', bold: false, italic: false, code: true, link: undefined }], bullet: false, code: true },
      { runs: [plain('Título')], bullet: false, code: false },
    ]);
  });

  it('las listas anidadas heredan la viñeta y las tablas (nodos sin contenido de frase) no aportan runs', () => {
    expect(blocks('- padre\n  - hijo')).toEqual([
      { runs: [plain('padre')], bullet: true, code: false },
      { runs: [plain('hijo')], bullet: true, code: false },
    ]);
    expect(inlineRuns('- [ ] tarea')).toEqual([plain('[ ] tarea')]);
  });
});
