import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { compareBytes, comparePdf, compareText, diffOperations, lineDiff } from './compare';
import { normalize, stepPrefix, summarize } from './runner';

const BENCH = join(__dirname, 'bench', 'workspace');

describe('comparadores del arnés de aceptación (T-5.5.2)', () => {
  it('diffOperations y lineDiff señalan inserciones, borrados y contexto, acotando la salida', () => {
    expect(diffOperations(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual([[' ', 'a'], ['-', 'b'], ['+', 'x'], [' ', 'c']]);
    expect(diffOperations([], ['a'])).toEqual([['+', 'a']]);
    expect(diffOperations(['a'], [])).toEqual([['-', 'a']]);
    const expected = Array.from({ length: 10 }, (_, index) => `línea ${index}`).join('\n');
    const actual = expected.replace('línea 5', 'línea cinco');
    expect(lineDiff(expected, actual)).toBe('  línea 3\n  línea 4\n- línea 5\n+ línea cinco\n  línea 6\n  línea 7');
    const twoChanges = expected.replace('línea 1', 'uno').replace('línea 8', 'ocho');
    expect(lineDiff(expected, twoChanges, 1)).toBe('  línea 0\n- línea 1\n+ uno\n  línea 2\n  …\n  línea 7\n- línea 8\n+ ocho\n  línea 9');
    expect(lineDiff(expected, expected.split('\n').map((line) => `${line}!`).join('\n'), 0, 4)).toBe('- línea 0\n- línea 1\n- línea 2\n- línea 3\n  … (16 líneas más)');
    const huge = Array.from({ length: 2100 }, (_, index) => `l${index}`);
    const changed = [...huge];
    changed[7] = 'cambiada';
    expect(diffOperations(huge, changed)).toEqual([[' ', '… (textos demasiado largos para un diff completo; primera diferencia en la línea 8)'], ['-', 'l7'], ['+', 'cambiada']]);
    expect(diffOperations(huge, [...huge, 'extra'])).toEqual([[' ', '… (textos demasiado largos para un diff completo; primera diferencia en la línea 2101)'], ['-', '<fin>'], ['+', 'extra']]);
  });

  it('compareText y compareBytes devuelven nada si coinciden y un detalle si no', () => {
    expect(compareText('stdout', 'a\nb', 'a\nb')).toBeUndefined();
    expect(compareText('stdout', 'a\nb', 'a\nc')).toEqual({ what: 'stdout', detail: '  a\n- b\n+ c' });
    expect(compareBytes('x', Buffer.from('ab'), Buffer.from('ab'))).toBeUndefined();
    expect(compareBytes('x', Buffer.from('ab'), Buffer.from('abc'))).toEqual({ what: 'x', detail: '2 bytes esperados, 3 obtenidos' });
  });

  it('comparePdf compara bytes y, si difieren, explica páginas, tamaño y el diff del texto', async () => {
    const nexo = readFileSync(join(BENCH, 'offers', 'pdf', 'nexo-senior-backend.pdf'));
    const orbita = readFileSync(join(BENCH, 'offers', 'pdf', 'orbita-platform-engineer.pdf'));
    expect(await comparePdf('oferta', nexo, nexo)).toBeUndefined();
    const mismatch = await comparePdf('oferta', nexo, orbita);
    expect(mismatch?.what).toBe('oferta');
    expect(mismatch?.detail).toMatch(/^\d+ bytes esperados, \d+ obtenidos; esperado: 1 página\(s\), \d+ bytes; obtenido: 1 página\(s\), \d+ bytes\n/);
    expect(mismatch?.detail).toContain('- Senior Backend Engineer · Pagos (remoto)');
    expect(mismatch?.detail).toContain('+ Platform Engineer');
    const broken = await comparePdf('oferta', nexo, Buffer.from('%PDF-1.7 roto'));
    expect(broken?.detail).toContain('obtenido: texto ilegible (');
    // Mismo texto, bytes distintos (metadatos): se dice explícitamente.
    const tweaked = Buffer.concat([nexo, Buffer.from('\n% comentario añadido tras %%EOF\n')]);
    expect((await comparePdf('oferta', nexo, tweaked))?.detail).toContain('(el texto extraído es idéntico: difieren solo los bytes)');
  });

  it('normalize sustituye las rutas más largas primero; stepPrefix y summarize dan formato al resumen', () => {
    expect(normalize('/tmp/x/ws/output y /tmp/x', [['/tmp/x', '<TMP>'], ['/tmp/x/ws', '<WS>']])).toBe('<WS>/output y <TMP>');
    expect(stepPrefix(6, { id: 'build', args: [], exitCode: 0 })).toBe('07-build');
    expect(summarize([
      { id: 'a', status: 'ok', steps: 5, failures: [], elapsedMs: 1500 },
      { id: 'b', status: 'skipped', steps: 0, failures: [], message: 'sin Typst', elapsedMs: 0 },
    ])).toEqual({ line: '2 escenarios · 5 pasos · 0 con diferencias · 1 omitidos · 1.5 s', exitCode: 0 });
    expect(summarize([{ id: 'c', status: 'failed', steps: 3, failures: [{ prefix: '02-x', mismatches: [{ what: 'stdout', detail: 'd' }] }], elapsedMs: 500 }])).toEqual({ line: '1 escenarios · 3 pasos · 1 con diferencias · 0 omitidos · 0.5 s → FALLO en c', exitCode: 1 });
  });
});
