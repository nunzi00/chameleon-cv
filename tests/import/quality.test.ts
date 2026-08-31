/** Avisos de calidad de la extracción (T-8.4b F2): OCR sucio, plantillas sin rellenar y textos sin entradas. */
import { describe, expect, it } from 'vitest';

import { qualityWarnings } from '../../src/import/quality';

const filler = (words: number): string => Array.from({ length: words }, (_, index) => `palabra${index % 7}`).join(' ');

describe('calidad de la extracción', () => {
  it('avisa de un texto demasiado corto y no sigue mirando', () => {
    expect(qualityWarnings({ text: 'Ada Ejemplo\nIngeniera', entries: 0 })).toEqual(['el texto extraído es muy corto (3 palabras): puede que el fichero sea una imagen sin capa de texto']);
  });

  it('avisa de un escaneo con OCR de baja calidad citando fragmentos', () => {
    const garbled = 'O>nsdentious tfigh Ent2rtained Sc:ience 201& cashJe~ gu|delines';
    const [first] = qualityWarnings({ text: `${garbled} ${filler(120)}`, entries: 2 });
    expect(first).toContain('OCR de baja calidad (6 fragmentos ilegibles, por ejemplo «O>nsdentious», «Ent2rtained», «Sc:ience»)');
  });

  it('no avisa de OCR con pocos fragmentos ni cuando su proporción es baja', () => {
    expect(qualityWarnings({ text: `O>nsdentious tfigh ${filler(120)}`, entries: 1 })).toEqual([]);
    const garbled = 'O>ne tw~o th|ree fo^ur fi\\ve si°x';
    expect(qualityWarnings({ text: `${garbled} ${filler(400)}`, entries: 1 })).toEqual([]);
  });

  it('avisa de una plantilla sin rellenar a partir de tres marcadores', () => {
    const [first] = qualityWarnings({ text: `[Tu nombre] <Company Name> lorem ipsum ${filler(120)}`, entries: 3 });
    expect(first).toContain('parece una plantilla sin rellenar (3 marcadores, por ejemplo «[Tu nombre]», «<Company Name>»)');
    expect(qualityWarnings({ text: `[Tu nombre] <Company Name> ${filler(120)}`, entries: 3 })).toEqual([]);
  });

  it('avisa cuando no se reconoció ninguna entrada, y calla cuando sí las hay', () => {
    expect(qualityWarnings({ text: filler(120), entries: 0 })).toEqual(['no se reconoció ninguna entrada con fechas: revisa el texto sin situar del final; puede que no sea un CV o que su maquetación no se reconozca']);
    expect(qualityWarnings({ text: filler(120), entries: 1 })).toEqual([]);
  });
});
