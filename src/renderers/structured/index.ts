/**
 * Vista estructurada (T-3.2, `docs/typst-integration.md` §6.1): el `CvView` con el Markdown en
 * línea ya descompuesto en runs y bloques. Es la única fuente de verdad de los dos motores PDF
 * (pdfkit y Typst): ninguno interpreta Markdown ni conoce el esquema.
 */
export * from './inline';
export * from './view';
export * from './layout';
