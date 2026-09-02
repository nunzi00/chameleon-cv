/**
 * Formatos de salida de `generate-cv`: `md` por defecto, `pdf` para entregar (`docs/pdf-integration.md` §3.4) y
 * `odt` para **seguir editando a mano** en LibreOffice, Word o Google Docs (`docs/odt-integration.md`).
 */
export const CV_FORMATS = ['md', 'pdf', 'odt'] as const;
export type CvFormat = (typeof CV_FORMATS)[number];

export function isCvFormat(value: string): value is CvFormat {
  return (CV_FORMATS as readonly string[]).includes(value);
}

/** Motores de `--format pdf` (T-3.2, `docs/typst-integration.md` §6.2): `pdfkit` por defecto, `typst` opcional. */
export const CV_ENGINES = ['pdfkit', 'typst'] as const;
export type CvEngine = (typeof CV_ENGINES)[number];

export function isCvEngine(value: string): value is CvEngine {
  return (CV_ENGINES as readonly string[]).includes(value);
}
