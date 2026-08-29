import { describe, expect, it } from 'vitest';

import { countMarks, toggleMark } from './marks';

const REVIEW = `# Revisión improve · 2026-08-30

Proveedor: ollama · modelo m

## ach-1 · Dev · ACME

Original: Reduje la latencia.
Fuente: experience/acme.md:15 · sha256 0123456789abcdef

- [ ] Propuesta 1: Reduje la latencia p95 un 40 %.
  Motivo: más concreto
- [ ] Propuesta 2: Bajé la latencia.

## ach-1-bis · Dev · ACME

- [ ] Propuesta 1: Otra cosa.

## ach-2 · Proyecto X

Original: Hice cosas.

- [x] Propuesta 1: Hice cosas mejores.
`;

describe('marcas de la revisión', () => {
  it('marca y desmarca solo la línea de la propuesta dentro de su sección, byte a byte', () => {
    const marked = toggleMark(REVIEW, 'ach-1', 2, true);
    expect(marked.changed).toBe(true);
    expect(marked.text).toBe(REVIEW.replace('- [ ] Propuesta 2: Bajé la latencia.', '- [x] Propuesta 2: Bajé la latencia.'));
    expect(marked.text.length).toBe(REVIEW.length);
    const back = toggleMark(marked.text, 'ach-1', 2, false);
    expect(back.text).toBe(REVIEW);
    // «ach-1» no toca «ach-1-bis» (la cabecera exige el separador «· »), y la propuesta 1 de ach-1-bis es la suya.
    expect(toggleMark(REVIEW, 'ach-1-bis', 1, true).text).toContain('- [x] Propuesta 1: Otra cosa.');
    expect(toggleMark(REVIEW, 'ach-1-bis', 1, true).text).toContain('- [ ] Propuesta 1: Reduje la latencia p95');
  });

  it('no cambia nada si el ítem o la propuesta no existen, o si la marca ya está como se pide', () => {
    expect(toggleMark(REVIEW, 'no-existe', 1, true)).toEqual({ text: REVIEW, changed: false });
    expect(toggleMark(REVIEW, 'ach-1', 9, true)).toEqual({ text: REVIEW, changed: false });
    expect(toggleMark(REVIEW, 'ach-2', 1, true)).toEqual({ text: REVIEW, changed: false });
    expect(toggleMark(REVIEW, 'ach-1', 1, false)).toEqual({ text: REVIEW, changed: false });
    expect(toggleMark('', 'ach-1', 1, true)).toEqual({ text: '', changed: false });
    expect(toggleMark(REVIEW, 'a.b*c', 1, true).changed).toBe(false);
  });

  it('cuenta las marcas', () => {
    expect(countMarks(REVIEW)).toBe(1);
    expect(countMarks(toggleMark(REVIEW, 'ach-1', 1, true).text)).toBe(2);
    expect(countMarks('')).toBe(0);
  });
});
