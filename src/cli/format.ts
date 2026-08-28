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
