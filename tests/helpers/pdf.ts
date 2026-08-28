import PDFDocument from 'pdfkit';

/** Genera un PDF con pdfkit (Helvetica): una lista de líneas por página. */
export function makePdf(pages: ReadonlyArray<readonly string[]>): Promise<Buffer> {
  return new Promise((resolve) => {
    const document = new PDFDocument({ size: 'A4', margin: 56, info: { CreationDate: new Date('2026-01-01T00:00:00Z') } });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    pages.forEach((lines, index) => {
      if (index > 0) {
        document.addPage();
      }
      document.font('Helvetica').fontSize(11);
      for (const line of lines) {
        if (line === '') {
          document.moveDown(0.5);
        } else {
          document.text(line);
        }
      }
    });
    document.end();
  });
}
