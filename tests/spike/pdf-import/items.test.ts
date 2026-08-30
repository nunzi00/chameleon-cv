import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PDF_LIMITS } from '../../../src/pdf';
import { sixtyPagesPdf } from '../../../scripts/spike/pdf-import/corpus';
import { extractItems } from '../../../scripts/spike/pdf-import/items';

function textPdf(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 72 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(14).text('Hola mundo', 72, 72);
    doc.fontSize(10).text('Segunda línea', 72, 100);
    doc.end();
  });
}

describe('extractItems', () => {
  it('devuelve los items con coordenadas y tamaño de fuente', async () => {
    const result = await extractItems(await textPdf());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.pages).toBe(1);
    const hello = result.items.find((item) => item.text.startsWith('Hola'));
    const second = result.items.find((item) => item.text.startsWith('Segunda'));
    expect(hello).toMatchObject({ page: 1, x: 72, fontSize: 14 });
    expect(second).toMatchObject({ page: 1, x: 72, fontSize: 10 });
    expect(hello!.y).toBeGreaterThan(second!.y);
    expect(hello!.width).toBeGreaterThan(0);
  });

  it('rechaza antes del worker un PDF mayor que el límite', async () => {
    expect(await extractItems(new Uint8Array(10), { ...DEFAULT_PDF_LIMITS, maxBytes: 5 })).toEqual({ ok: false, code: 'too-large', message: 'El PDF ocupa 10 bytes (máximo 5)' });
  });

  it('tipifica un PDF inválido', async () => {
    const result = await extractItems(Buffer.from('esto no es un PDF'));
    expect(result).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('respeta el límite de páginas', async () => {
    const result = await extractItems(await sixtyPagesPdf());
    expect(result).toMatchObject({ ok: false, code: 'too-many-pages' });
  });

  it('corta por tiempo', async () => {
    const result = await extractItems(await textPdf(), { ...DEFAULT_PDF_LIMITS, timeoutMs: 1 });
    expect(result).toEqual({ ok: false, code: 'timeout', message: 'La extracción superó los 1 ms permitidos' });
  });
});
