/**
 * Documento principal para Typst (T-3.2, `docs/typst-integration.md` §3.1): dos líneas generadas
 * por nosotros. Los datos viajan como **literal de cadena** (solo escapes de cadena): nunca son
 * código, nunca están en `argv` y nunca tocan el disco.
 */
import type { StructuredView } from '../structured';

/** Literal de cadena Typst: `\`, `"` y los caracteres de control se escapan; el resto va tal cual. */
export function typstStringLiteral(text: string): string {
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\u0000-\u001f\u007f]/g, (character) => `\\u{${character.charCodeAt(0).toString(16)}}`);
  return `"${escaped}"`;
}

/**
 * Documento principal: importa la función `cv` de la plantilla (ruta absoluta dentro del `--root`)
 * y la aplica a la vista decodificada desde el literal JSON.
 */
export function mainDocument(view: StructuredView, importPath: string): string {
  return `#import ${typstStringLiteral(importPath)}: cv\n#cv(json(bytes(${typstStringLiteral(JSON.stringify(view))})))\n`;
}
