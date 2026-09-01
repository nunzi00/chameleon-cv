/**
 * Invariante de los esquemas que viajan a un proveedor (regresión del 1-sep, encontrada en vivo con Groq): la
 * salida estructurada estricta de OpenAI y de Groq **exige que `required` liste todas las claves de
 * `properties`**, y si falta una devuelve un HTTP 400 que tumba la orden entera —no una propuesta: la orden—.
 * Ningún doble de proveedor lo reproduce, porque quien valida es el servidor del proveedor; por eso la guarda va
 * sobre el esquema y cubre las cinco tareas de una vez, incluidas las que aún no existen el día que se añadan.
 */
import { describe, expect, it } from 'vitest';

import { improveJsonSchema } from '../../src/llm/tasks/improve';
import { importMapJsonSchema } from '../../src/llm/tasks/import-map';
import { offerMapJsonSchema } from '../../src/llm/tasks/offer-map';
import { suggestTagsJsonSchema } from '../../src/llm/tasks/suggest-tags';
import { summarizeJsonSchema } from '../../src/llm/tasks/summarize';

const SCHEMAS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['improve', improveJsonSchema()],
  ['summarize', summarizeJsonSchema()],
  ['suggest-tags', suggestTagsJsonSchema(['php', 'kubernetes'])],
  ['import-map', importMapJsonSchema()],
  ['offer-map', offerMapJsonSchema(['kafka', 'python'])],
];

/** Cada objeto del esquema, a cualquier profundidad, con la ruta desde la raíz para poder señalarlo. */
function objects(node: unknown, path = ''): Array<{ readonly path: string; readonly node: Record<string, unknown> }> {
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => objects(item, `${path}[${index}]`));
  }
  if (typeof node !== 'object' || node === null) {
    return [];
  }
  const record = node as Record<string, unknown>;
  const nested = Object.entries(record).flatMap(([key, value]) => objects(value, `${path}/${key}`));
  return record['type'] === 'object' ? [{ path: path === '' ? '/' : path, node: record }, ...nested] : nested;
}

describe('los esquemas JSON que se envían a un proveedor', () => {
  for (const [name, schema] of SCHEMAS) {
    it(`«${name}»: cada objeto declara en «required» todas sus propiedades`, () => {
      const found = objects(schema);
      expect(found.length).toBeGreaterThan(0);
      for (const { path, node } of found) {
        const properties = Object.keys(node['properties'] ?? {});
        const required = (node['required'] ?? []) as readonly string[];
        expect({ tarea: name, ruta: path, faltan: properties.filter((key) => !required.includes(key)) }).toEqual({ tarea: name, ruta: path, faltan: [] });
      }
    });

    it(`«${name}»: ningún objeto admite propiedades extra`, () => {
      // El otro requisito de la salida estricta: «additionalProperties: false» en cada objeto.
      for (const { path, node } of objects(schema)) {
        expect({ ruta: path, extra: node['additionalProperties'] }).toEqual({ ruta: path, extra: false });
      }
    });
  }
});
