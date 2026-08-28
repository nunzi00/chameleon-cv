/**
 * Validación de una sección con su esquema zod, traduciendo cada problema a un
 * `DatasetError` con la línea del fichero en la que está el valor.
 */
import type { z } from 'zod';

import { formatPath, type SchemaPath } from '../../core/schema';
import type { DatasetError } from '../dataset/types';

export type LineLocator = (path: SchemaPath) => number;

export interface ValidationContext {
  readonly file: string;
  readonly locate: LineLocator;
  /** Prefijo con el que se presentan las rutas en los mensajes y se localizan las líneas. */
  readonly prefix?: SchemaPath;
}

export type SectionValidation<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly DatasetError[] };

/**
 * Localizador por mapa de líneas: busca la ruta exacta y, si no está, el prefijo más largo
 * que sí lo esté (`links[0].url` → `links[0]` → `links`); si nada coincide, `fallback`.
 */
export function createLocator(lines: ReadonlyMap<string, number>, fallback: number): LineLocator {
  return (path) => {
    for (let length = path.length; length > 0; length -= 1) {
      const line = lines.get(formatPath(path.slice(0, length)));
      if (line !== undefined) {
        return line;
      }
    }
    return fallback;
  };
}

export function validateSection<S extends z.ZodType>(
  schema: S,
  input: unknown,
  context: ValidationContext,
): SectionValidation<z.output<S>> {
  const result = schema.safeParse(input);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  const prefix = context.prefix ?? [];
  const errors: DatasetError[] = [];
  for (const issue of result.error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        const path = [...prefix, ...issue.path, key];
        errors.push({ file: context.file, line: context.locate(path), message: `${formatPath(path)}: clave no reconocida` });
      }
      continue;
    }
    const path = [...prefix, ...issue.path];
    const label = formatPath(path);
    errors.push({
      file: context.file,
      line: context.locate(path),
      message: label === '' ? issue.message : `${label}: ${issue.message}`,
    });
  }
  return { ok: false, errors };
}
