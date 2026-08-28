/**
 * Frontmatter YAML con el esquema *failsafe* (`docs/formato-dataset.md` §8.3): todo escalar
 * es texto, sin tipado implícito, sin alias, y con la línea de cada clave para los errores.
 */
import { isMap, isNode, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';

import { formatPath, type SchemaPath } from '../../core/schema';
import type { DatasetError } from '../dataset/types';
import { isPlainObject } from '../shared/objects';
import { firstLine } from '../shared/text';

export interface Frontmatter {
  /** Datos tal cual los devuelve YAML failsafe: cadenas, listas y mapas. */
  readonly data: Record<string, unknown>;
  /** Línea (del fichero) de cada clave o elemento, indexada por ruta formateada (`location.city`, `links[0].url`). */
  readonly lines: ReadonlyMap<string, number>;
  /** Línea del `---` de apertura. */
  readonly line: number;
}

export type FrontmatterResult =
  | { readonly ok: true; readonly frontmatter: Frontmatter }
  | { readonly ok: false; readonly errors: readonly DatasetError[] };

interface YamlErrorLike {
  readonly message: string;
  readonly linePos?: readonly [{ readonly line: number }, ...unknown[]] | undefined;
}

/** Línea de fichero de un error YAML: el bloque empieza en la línea siguiente al `---`. */
export function yamlErrorLine(error: YamlErrorLike, blockLine: number): number {
  const position = error.linePos?.[0];
  return position === undefined ? blockLine : blockLine + position.line;
}

/** Línea de fichero en la que empieza un nodo YAML, si el parser la registró. */
export function yamlNodeLine(node: unknown, lineCounter: LineCounter, blockLine: number): number | undefined {
  if (!isNode(node) || node.range == null) {
    return undefined;
  }
  return blockLine + lineCounter.linePos(node.range[0]).line;
}

function keyName(key: unknown): string {
  return isScalar(key) ? String(key.value) : String(key);
}

/** Rellena `lines` con la línea de cada clave e índice del árbol YAML (exportada para tests con nodos sintéticos). */
export function collectLines(
  node: unknown,
  path: SchemaPath,
  lines: Map<string, number>,
  lineCounter: LineCounter,
  blockLine: number,
): void {
  if (isMap(node)) {
    for (const pair of node.items) {
      const keyPath = [...path, keyName(pair.key)];
      const line = yamlNodeLine(pair.key, lineCounter, blockLine);
      if (line !== undefined) {
        lines.set(formatPath(keyPath), line);
      }
      collectLines(pair.value, keyPath, lines, lineCounter, blockLine);
    }
  } else if (isSeq(node)) {
    node.items.forEach((item, index) => {
      const itemPath = [...path, index];
      const line = yamlNodeLine(item, lineCounter, blockLine);
      if (line !== undefined) {
        lines.set(formatPath(itemPath), line);
      }
      collectLines(item, itemPath, lines, lineCounter, blockLine);
    });
  }
}

export function parseFrontmatter(yamlSource: string, file: string, blockLine: number): FrontmatterResult {
  const lineCounter = new LineCounter();
  const document = parseDocument(yamlSource, { schema: 'failsafe', lineCounter, uniqueKeys: true });
  if (document.errors.length > 0) {
    return {
      ok: false,
      errors: document.errors.map((error) => ({
        file,
        line: yamlErrorLine(error, blockLine),
        message: `Frontmatter YAML inválido: ${firstLine(error.message)}`,
      })),
    };
  }

  let data: unknown;
  try {
    data = document.toJS({ maxAliasCount: 0 });
  } catch {
    return { ok: false, errors: [{ file, line: blockLine, message: 'El frontmatter no admite anchors ni alias YAML' }] };
  }
  if (!isPlainObject(data)) {
    return { ok: false, errors: [{ file, line: blockLine, message: 'El frontmatter debe ser un mapa «clave: valor»' }] };
  }

  const lines = new Map<string, number>();
  collectLines(document.contents, [], lines, lineCounter, blockLine);
  return { ok: true, frontmatter: { data, lines, line: blockLine } };
}
