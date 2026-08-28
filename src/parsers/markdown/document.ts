/**
 * Estructura de un fichero Markdown del dataset (`docs/formato-dataset.md` §4): frontmatter
 * opcional, nodos anteriores al primer encabezado y secciones `## …`. La interpretación
 * (qué secciones se admiten, qué contienen) la hace cada tipo de fichero.
 */
import type { List, Nodes, Root, RootContent } from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import type { DatasetError } from '../dataset/types';
import { spanOf } from './positions';

export interface DocumentSection {
  readonly name: string;
  readonly line: number;
  readonly nodes: readonly RootContent[];
}

export interface MarkdownDocument {
  readonly frontmatter: { readonly yaml: string; readonly line: number } | undefined;
  /** Nodos anteriores al primer encabezado `##` (normalmente el resumen). */
  readonly leading: readonly RootContent[];
  readonly sections: readonly DocumentSection[];
}

export type DocumentResult =
  | { readonly ok: true; readonly document: MarkdownDocument }
  | { readonly ok: false; readonly errors: readonly DatasetError[] };

const processor = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).freeze();

/** Texto plano de un nodo en línea (encabezados): concatena los literales que contiene. */
export function inlineText(node: Nodes): string {
  if ('value' in node) {
    return node.value;
  }
  if ('children' in node) {
    return node.children.map((child) => inlineText(child)).join('');
  }
  return '';
}

/** Texto fuente que abarcan unos nodos consecutivos, con la línea del primero. */
export function sliceNodes(source: string, nodes: readonly RootContent[]): { text: string; line: number } | undefined {
  const [first] = nodes;
  if (first === undefined) {
    return undefined;
  }
  const start = spanOf(first);
  const endOffset = nodes.reduce((end, node) => Math.max(end, spanOf(node).endOffset), start.endOffset);
  return { text: source.slice(start.startOffset, endOffset).trim(), line: start.startLine };
}

/** La lista de viñetas si los nodos son exactamente una lista; si no, `undefined`. */
export function onlyList(nodes: readonly RootContent[]): List | undefined {
  const [first, ...rest] = nodes;
  return first !== undefined && first.type === 'list' && rest.length === 0 ? first : undefined;
}

export function parseMarkdownDocument(source: string, file: string): DocumentResult {
  const root = processor.parse(source) as Root;
  const errors: DatasetError[] = [];
  let frontmatter: MarkdownDocument['frontmatter'];
  const leading: RootContent[] = [];
  const sections: Array<{ name: string; line: number; nodes: RootContent[] }> = [];

  for (const node of root.children) {
    const line = spanOf(node).startLine;
    if (node.type === 'yaml') {
      frontmatter = { yaml: node.value, line };
      continue;
    }
    if (node.type === 'heading') {
      if (node.depth === 2) {
        sections.push({ name: inlineText(node).trim(), line, nodes: [] });
      } else {
        errors.push({
          file,
          line,
          message: `Encabezado de nivel ${node.depth} no admitido: solo se reconocen secciones «## …»`,
        });
      }
      continue;
    }
    const current = sections[sections.length - 1];
    if (current === undefined) {
      leading.push(node);
    } else {
      current.nodes.push(node);
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, document: { frontmatter, leading, sections } };
}
