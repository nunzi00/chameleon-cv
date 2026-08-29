/**
 * Las marcas de una revisión (docs/gui-mvp.md §4.6): la GUI cambia solo `[ ]`↔`[x]` en la línea exacta de la propuesta,
 * dentro de la sección `## <id> · …` de su ítem, y deja el resto del texto byte a byte como estaba, para que
 * `cv improve apply` (y su huella de origen) lo lean tal cual.
 */
export interface MarkChange {
  readonly text: string;
  readonly changed: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Límites de la sección de un ítem: desde su cabecera `## <id> · ` hasta la siguiente cabecera `## ` (o el final). */
function section(text: string, itemId: string): { readonly start: number; readonly end: number } | undefined {
  const header = new RegExp(`^## ${escapeRegExp(itemId)} · `, 'm');
  const found = header.exec(text);
  if (found === null) {
    return undefined;
  }
  const start = found.index;
  const next = /^## /m.exec(text.slice(start + found[0].length));
  return { start, end: next === null ? text.length : start + found[0].length + next.index };
}

export function toggleMark(text: string, itemId: string, number: number, checked: boolean): MarkChange {
  const bounds = section(text, itemId);
  if (bounds === undefined) {
    return { text, changed: false };
  }
  const body = text.slice(bounds.start, bounds.end);
  const line = new RegExp(`^- \\[( |x)\\] Propuesta ${number}: `, 'm');
  const found = line.exec(body);
  if (found === null || (found[1] === 'x') === checked) {
    return { text, changed: false };
  }
  const replaced = `${body.slice(0, found.index)}- [${checked ? 'x' : ' '}] Propuesta ${number}: ${body.slice(found.index + found[0].length)}`;
  return { text: `${text.slice(0, bounds.start)}${replaced}${text.slice(bounds.end)}`, changed: true };
}

/** Cuántas propuestas están marcadas `[x]`. */
export function countMarks(text: string): number {
  return (text.match(/^- \[x\] Propuesta \d+: /gm) ?? []).length;
}
