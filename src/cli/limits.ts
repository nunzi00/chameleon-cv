/** Parsers de commander para los límites; la resolución vive en la capa de casos de uso. */
import { InvalidArgumentError } from 'commander';

export { describeLimits, hasLimits, resolveLimits, type LimitOptions } from '../app/limits';

/** `argParser` de commander: un entero mayor o igual que 0. */
export function parseLimit(value: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new InvalidArgumentError('debe ser un entero mayor o igual que 0');
  }
  return Number(value);
}

/** `--proposals`: entre 1 y 3 propuestas por logro. */
export function parseProposals(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3) {
    throw new InvalidArgumentError('debe ser un entero entre 1 y 3');
  }
  return parsed;
}

/** `--skills PHP,Kubernetes` / `--projects proj-a,proj-b`: nombres o ids separados por comas, sin vacíos. */
export function parseList(value: string): string[] {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  if (items.length === 0) {
    throw new InvalidArgumentError('debe ser una lista de nombres o ids separados por comas');
  }
  return items;
}
