/**
 * Aplicar a las fuentes las etiquetas que el co-piloto sugirió (T-9.15). `cv suggest tags` proponía y te dejaba
 * la línea para copiar y pegar: la mitad del trabajo. Esto la escribe, **solo las que marques**, con las mismas
 * garantías que `cv improve apply` —cambio mínimo (se añaden los `#hashtags` al final de la viñeta y no se toca
 * nada más), copia `.bak` previa que nunca se sobrescribe, y comprobación de que el logro sigue estando tal cual
 * en la fuente; si cambió desde que se sugirió, ese ítem no se escribe y se dice por qué—.
 *
 * El modelo no escribe: escribe esta función cuando una persona elige (C2, C9).
 */
import { resolve } from 'node:path';

import { TagSchema } from '../core/schema';
import { locateAchievementText, replaceRange } from '../parsers';
import { describeError } from '../shared/errors';
import type { AppContext } from './context';
import { environmentError, notFoundError, type AppError } from './errors';
import type { SourceIndex } from './provenance';
import { backupPath } from './review';
import { SOURCE_FILE_MODE } from './sources';

/** Lo que el co-piloto sugirió para un logro, reducido a lo que hace falta para escribirlo. */
export interface TagProposal {
  readonly id: string;
  readonly tags: readonly string[];
}

export type TagApplyEntry =
  | { readonly ok: true; readonly id: string; readonly file: string; readonly line: number; readonly text: string; readonly add: readonly string[] }
  | { readonly ok: false; readonly id: string; readonly reason: string };

/** Las `#etiquetas` que la viñeta ya lleva, leídas del propio fichero justo detrás de su texto. */
function tagsAfter(source: string, end: number): { readonly tags: readonly string[]; readonly insertAt: number } {
  // Se queda con la ristra de `#etiquetas` que sigue al texto y descarta lo demás; si no hay, cadena vacía.
  const tail = source.slice(end).replace(/^((?:[ \t]*#[^\s#]+)*)[\s\S]*$/, '$1');
  const tags = tail
    .trim()
    .split(/\s+/)
    .filter((token) => token.startsWith('#'))
    .map((token) => token.slice(1).toLowerCase());
  return { tags, insertAt: end + tail.length };
}

/**
 * De la sugerencia al plan: qué etiquetas se escribirían y en qué viñeta, y cuáles no se pueden. No toca el
 * disco —esto es lo que se enseña antes de decidir— y descarta lo que ya está puesto.
 */
export function planApplyTags(index: SourceIndex, proposals: readonly TagProposal[]): readonly TagApplyEntry[] {
  const entries: TagApplyEntry[] = [];
  const seen = new Set<string>();
  for (const proposal of proposals) {
    if (seen.has(proposal.id)) {
      entries.push({ ok: false, id: proposal.id, reason: 'repetido en la misma petición' });
      continue;
    }
    seen.add(proposal.id);
    const located = index.achievements.get(proposal.id);
    if (located === undefined) {
      entries.push({ ok: false, id: proposal.id, reason: 'no está en las fuentes (¿artefacto obsoleto? recompila con «cv build»)' });
      continue;
    }
    const add = [...new Set(proposal.tags.map((tag) => tag.trim().toLowerCase()))].filter((tag) => TagSchema.safeParse(tag).success);
    if (add.length === 0) {
      entries.push({ ok: false, id: proposal.id, reason: 'ninguna etiqueta válida que añadir' });
      continue;
    }
    entries.push({ ok: true, id: proposal.id, file: located.file, line: located.line, text: located.text, add });
  }
  return entries;
}

export interface TagsWriteResult {
  /** Ficheros tocados, con la copia que se dejó al lado y los logros que cambiaron. */
  readonly written: ReadonlyArray<{ readonly file: string; readonly backup: string; readonly ids: readonly string[] }>;
  /** Lo que de verdad se escribió, ya sin lo que la viñeta tenía. */
  readonly applied: ReadonlyArray<{ readonly id: string; readonly added: readonly string[] }>;
  /** Lo que no se escribió al llegar al fichero, con su motivo. */
  readonly skipped: ReadonlyArray<{ readonly id: string; readonly reason: string }>;
}

export type TagsWriteOutcome = { readonly ok: true; readonly result: TagsWriteResult } | { readonly ok: false; readonly error: AppError };

/**
 * Escribe las etiquetas del plan. Un fichero se lee, se modifica en memoria con todas las viñetas que le tocan y
 * se escribe una sola vez con su copia delante: una pasada lo deja coherente o no lo deja tocado.
 */
export async function applyTags(context: AppContext, data: string, plan: readonly TagApplyEntry[]): Promise<TagsWriteOutcome> {
  const byFile = new Map<string, Array<Extract<TagApplyEntry, { readonly ok: true }>>>();
  for (const entry of plan) {
    if (entry.ok) {
      byFile.set(entry.file, [...(byFile.get(entry.file) ?? []), entry]);
    }
  }
  const written: Array<{ file: string; backup: string; ids: readonly string[] }> = [];
  const applied: Array<{ id: string; added: readonly string[] }> = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const [file, entries] of byFile) {
    const path = resolve(context.cwd, data, file);
    let content: string;
    try {
      content = await context.datasetFileSystem.readTextFile(path);
    } catch (error) {
      return { ok: false, error: notFoundError(`No se pudo leer ${file}: ${describeError(error)}`) };
    }
    let updated = content;
    const ids: string[] = [];
    // De abajo arriba: insertar mueve los desplazamientos de todo lo que viene después.
    for (const entry of [...entries].sort((a, b) => b.line - a.line)) {
      const range = locateAchievementText(updated, entry.text, entry.line);
      if (range === undefined) {
        skipped.push({ id: entry.id, reason: `el logro ya no está tal cual en ${file} (¿editado a mano?)` });
        continue;
      }
      // Las etiquetas van tras las que ya hubiera: el tramo del logro termina donde acaba su TEXTO.
      const { tags, insertAt } = tagsAfter(updated, range.end);
      const fresh = entry.add.filter((tag) => !tags.includes(tag));
      if (fresh.length === 0) {
        skipped.push({ id: entry.id, reason: 'ya las tenía' });
        continue;
      }
      updated = replaceRange(updated, insertAt, insertAt, ` ${fresh.map((tag) => `#${tag}`).join(' ')}`);
      applied.push({ id: entry.id, added: fresh });
      ids.push(entry.id);
    }
    if (updated === content) {
      continue;
    }
    const backup = await backupPath(context, path);
    try {
      await context.artifactFileSystem.writeFile(backup, content, SOURCE_FILE_MODE);
      await context.artifactFileSystem.writeFile(path, updated, SOURCE_FILE_MODE);
    } catch (error) {
      return { ok: false, error: environmentError(`No se pudo escribir ${file}: ${describeError(error)}`) };
    }
    written.push({ file, backup: backup.slice(path.lastIndexOf('/') + 1), ids });
  }
  return { ok: true, result: { written, applied, skipped } };
}
