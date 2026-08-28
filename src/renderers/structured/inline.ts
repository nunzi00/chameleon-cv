/**
 * Markdown en línea → *runs* con estilo (`docs/pdf-integration.md` §3.2), reutilizando el
 * parser mdast del proyecto. El PDF no interpreta Markdown: recibe texto ya descompuesto en
 * tramos con negrita, cursiva, código y enlace.
 */
import type { Nodes, RootContent } from 'mdast';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

export interface Run {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly code: boolean;
  readonly link?: string | undefined;
}

/** Un bloque es un párrafo (o un ítem de lista, con `bullet`) ya descompuesto en runs. */
export interface Block {
  readonly runs: readonly Run[];
  readonly bullet: boolean;
  readonly code: boolean;
}

const processor = unified().use(remarkParse).freeze();

export interface Style {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly code: boolean;
  readonly link: string | undefined;
}

const PLAIN: Style = { bold: false, italic: false, code: false, link: undefined };

function run(text: string, style: Style): Run {
  return { text, bold: style.bold, italic: style.italic, code: style.code, link: style.link };
}

/** Runs de un nodo mdast de frase (texto, énfasis, código, enlace, salto, imagen, HTML…). */
export function nodeRuns(node: Nodes, style: Style = PLAIN): Run[] {
  switch (node.type) {
    case 'text':
      return [run(node.value, style)];
    case 'strong':
      return node.children.flatMap((child) => nodeRuns(child, { ...style, bold: true }));
    case 'emphasis':
      return node.children.flatMap((child) => nodeRuns(child, { ...style, italic: true }));
    case 'inlineCode':
      return [run(node.value, { ...style, code: true })];
    case 'link':
      return node.children.flatMap((child) => nodeRuns(child, { ...style, link: node.url }));
    case 'break':
      return [run('\n', style)];
    case 'image':
      return [run(node.alt ?? '', style)];
    case 'html':
      return [run(node.value, style)];
    default:
      return 'children' in node ? node.children.flatMap((child) => nodeRuns(child, style)) : [];
  }
}

/** Runs de un texto Markdown en línea (un párrafo). */
export function inlineRuns(markdown: string): Run[] {
  return blocks(markdown).flatMap((block) => block.runs);
}

function blocksOf(nodes: readonly RootContent[], bullet: boolean): Block[] {
  return nodes.flatMap((node): Block[] => {
    switch (node.type) {
      case 'paragraph':
      case 'heading':
        return [{ runs: node.children.flatMap((child) => nodeRuns(child, PLAIN)), bullet, code: false }];
      case 'code':
        return [{ runs: [run(node.value, { ...PLAIN, code: true })], bullet, code: true }];
      case 'list':
        return node.children.flatMap((item) => blocksOf(item.children, true));
      case 'blockquote':
        return blocksOf(node.children, bullet);
      default:
        return [];
    }
  });
}

/** Bloques (párrafos, ítems de lista, código) de un texto Markdown de varios párrafos. */
export function blocks(markdown: string): Block[] {
  return blocksOf(processor.parse(markdown).children, false);
}
