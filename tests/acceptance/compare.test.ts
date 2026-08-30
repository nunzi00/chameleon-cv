import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { canonicalPdf, compareBytes, comparePdf, compareText, diffOperations, lineDiff } from './compare';
import { normalize, positional, producedName, stepPrefix, storedName, summarize } from './runner';

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
    expect(normalize('copia en /w/data/sources.20260830-120102.bak y /w/x.19991231-235959.bak.1', [['/w', '<WS>'], [/\.\d{8}-\d{6}\.bak/g, '.<STAMP>.bak']])).toBe('copia en <WS>/data/sources.<STAMP>.bak y <WS>/x.<STAMP>.bak.1');
    expect(stepPrefix(6, { id: 'build', args: [], exitCode: 0 })).toBe('07-build');
    expect(summarize([
      { id: 'a', status: 'ok', steps: 5, failures: [], elapsedMs: 1500 },
      { id: 'b', status: 'skipped', steps: 0, failures: [], message: 'sin Typst', elapsedMs: 0 },
    ])).toEqual({ line: '2 escenarios · 5 pasos · 0 con diferencias · 1 omitidos · 1.5 s', exitCode: 0 });
    expect(summarize([{ id: 'c', status: 'failed', steps: 3, failures: [{ prefix: '02-x', mismatches: [{ what: 'stdout', detail: 'd' }] }], elapsedMs: 500 }])).toEqual({ line: '1 escenarios · 3 pasos · 1 con diferencias · 0 omitidos · 0.5 s → FALLO en c', exitCode: 1 });
  });
});

describe('nombres almacenados de los artefactos', () => {
  it('un .gitignore producido se guarda como gitignore.expected y se recupera', () => {
    expect(storedName('.gitignore')).toBe('gitignore.expected');
    expect(storedName('data/sources/.gitignore')).toBe('data/sources/gitignore.expected');
    expect(storedName('data/sources/profile.md')).toBe('data/sources/profile.md');
    expect(producedName('gitignore.expected')).toBe('.gitignore');
    expect(producedName('a/gitignore.expected')).toBe('a/.gitignore');
    expect(producedName('a/b.md')).toBe('a/b.md');
  });
});

describe('opciones del ejecutor', () => {
  it('positional descarta las opciones y el valor de --binary', () => {
    expect(positional(['core', '--update', '--binary', 'build/sea/cv', 'typst', '--keep'])).toEqual(['core', 'typst']);
    expect(positional(['--binary', 'x'])).toEqual([]);
  });
});

describe('canonicalPdf: el mismo contenido comprimido por dos zlib distintas es el mismo PDF', () => {
  const build = (content: string, level: number): Buffer => {
    const { deflateSync } = require('node:zlib') as typeof import('node:zlib');
    const data = deflateSync(Buffer.from(content), { level });
    const head = Buffer.from(`%PDF-1.3\n1 0 obj\n<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`, 'latin1');
    const tail = Buffer.from('\nendstream\nendobj\nxref\n0 2\n0000000000 65535 f \n0000000009 00000 n \ntrailer\n<< /Size 2 >>\nstartxref\n123\n%%EOF\n', 'latin1');
    return Buffer.concat([head, data, tail]);
  };
  const content = 'BT /F1 12 Tf 72 720 Td (Hola, mundo) Tj ET '.repeat(40);

  it('iguala dos PDF cuyos flujos difieren solo en la compresión, y distingue un contenido distinto', async () => {
    const fast = build(content, 1);
    const best = build(content, 9);
    expect(fast.equals(best)).toBe(false);
    expect(canonicalPdf(fast).equals(canonicalPdf(best))).toBe(true);
    const canonical = canonicalPdf(fast).toString('latin1');
    expect(canonical).toContain('<< /Length  >>');
    expect(canonical).not.toContain('0000000009 00000 n');
    expect(canonical).toContain('trailer\n<< /Size 2 >>\nstartxref\n%%EOF');
    expect(await comparePdf('pdf', fast, best)).toBeUndefined();
    const other = build(content.replace('Hola', 'Adiós'), 9);
    expect(canonicalPdf(fast).equals(canonicalPdf(other))).toBe(false);
    const mismatch = await comparePdf('pdf', fast, other);
    expect(mismatch?.detail).toContain('bytes esperados');
  });

  it('deja intactos los flujos que no son FlateDecode o que no se pueden descomprimir', () => {
    const raw = Buffer.from('%PDF-1.3\n1 0 obj\n<< /Length 4 >>\nstream\nabcd\nendstream\nendobj\n', 'latin1');
    expect(canonicalPdf(raw).toString('latin1')).toContain('abcd');
    const broken = Buffer.from('%PDF-1.3\n1 0 obj\n<< /Length 4 /Filter /FlateDecode >>\nstream\nabcd\nendstream\nendobj\n', 'latin1');
    expect(canonicalPdf(broken).toString('latin1')).toContain('abcd');
    const truncated = Buffer.from('%PDF-1.3\nstream\nsin fin', 'latin1');
    expect(canonicalPdf(truncated).toString('latin1')).toBe('%PDF-1.3\nstream\nsin fin');
  });
});
