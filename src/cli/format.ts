/** Parsers de commander para `--format` y `--engine`; los tipos y las listas viven en la capa de casos de uso. */
import { InvalidArgumentError } from 'commander';

import { CV_ENGINES, CV_FORMATS, isCvEngine, isCvFormat, type CvEngine, type CvFormat } from '../app/format';

export { CV_ENGINES, CV_FORMATS, isCvEngine, isCvFormat, type CvEngine, type CvFormat } from '../app/format';

export function parseFormat(value: string): CvFormat {
  const normalized = value.trim().toLowerCase();
  if (!isCvFormat(normalized)) {
    throw new InvalidArgumentError(`formatos admitidos: ${CV_FORMATS.join(', ')}`);
  }
  return normalized;
}

export function parseEngine(value: string): CvEngine {
  const normalized = value.trim().toLowerCase();
  if (!isCvEngine(normalized)) {
    throw new InvalidArgumentError(`motores admitidos: ${CV_ENGINES.join(', ')}`);
  }
  return normalized;
}
