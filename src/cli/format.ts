/** Formatos de salida de `cv generate-cv` (`docs/pdf-integration.md` §3.4): `md` por defecto, `pdf` opcional. */
import { InvalidArgumentError } from 'commander';

export const CV_FORMATS = ['md', 'pdf'] as const;
export type CvFormat = (typeof CV_FORMATS)[number];

export function isCvFormat(value: string): value is CvFormat {
  return (CV_FORMATS as readonly string[]).includes(value);
}

/** Parser de commander para `--format`. */
export function parseFormat(value: string): CvFormat {
  const normalized = value.trim().toLowerCase();
  if (!isCvFormat(normalized)) {
    throw new InvalidArgumentError(`formatos admitidos: ${CV_FORMATS.join(', ')}`);
  }
  return normalized;
}

/** Motores de `--format pdf` (T-3.2, `docs/typst-integration.md` §6.2): `pdfkit` por defecto, `typst` opcional. */
export const CV_ENGINES = ['pdfkit', 'typst'] as const;
export type CvEngine = (typeof CV_ENGINES)[number];

export function isCvEngine(value: string): value is CvEngine {
  return (CV_ENGINES as readonly string[]).includes(value);
}

/** Parser de commander para `--engine`. */
export function parseEngine(value: string): CvEngine {
  const normalized = value.trim().toLowerCase();
  if (!isCvEngine(normalized)) {
    throw new InvalidArgumentError(`motores admitidos: ${CV_ENGINES.join(', ')}`);
  }
  return normalized;
}
