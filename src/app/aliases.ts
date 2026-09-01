/**
 * Cerrar el bucle del alias (T-9.12): cuando el co-piloto tiende un puente entre lo que la oferta dice y una
 * etiqueta tuya —«sistemas de mensajería» → `kafka`—, ese puente puede dejar de necesitar modelo. Basta con que
 * la frase quede como **alias** de la skill que lleva esa etiqueta: la próxima oferta que la use la reconocerá
 * el emparejado literal, gratis y sin red.
 *
 * Dos guardas, en la línea de todo lo demás: solo se escribe cuando la etiqueta pertenece a **una sola** skill
 * —si son varias, el alias no es de ninguna en particular y no se adivina— y **nunca** se reescribe el fichero:
 * se añade al final de la columna `aliases` de esa fila, dejando el resto byte a byte igual.
 */
import { resolve } from 'node:path';

import { normalizeLine } from '../core/keywords';
import type { MasterProfile } from '../core/schema';
import { describeError } from '../shared/errors';
import type { AppContext } from './context';
import { environmentError, notFoundError, type AppError } from './errors';
import { SOURCE_FILE_MODE } from './sources';

/** Lo que el co-piloto aportó, reducido a lo que hace falta para guardar un alias. */
export interface AliasProposal {
  readonly tag: string;
  readonly evidence: string;
}

export type AliasPlanEntry =
  | { readonly ok: true; readonly tag: string; readonly alias: string; readonly skill: string }
  | { readonly ok: false; readonly tag: string; readonly alias: string; readonly reason: string };

/**
 * De cada propuesta verificada a un alias concreto de una skill concreta. No escribe nada: esto es lo que se
 * enseña antes de tocar el disco.
 */
export function planAliases(profile: MasterProfile, proposals: readonly AliasProposal[]): readonly AliasPlanEntry[] {
  const entries: AliasPlanEntry[] = [];
  const seen = new Set<string>();
  for (const proposal of proposals) {
    const alias = proposal.evidence.trim().replace(/\s+/g, ' ');
    const key = `${proposal.tag} ${normalizeLine(alias)}`;
    if (alias === '' || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const owners = profile.skills.filter((skill) => skill.tags.includes(proposal.tag));
    const skill = owners[0];
    if (skill === undefined) {
      entries.push({ ok: false, tag: proposal.tag, alias, reason: `ninguna skill lleva la etiqueta «${proposal.tag}»` });
      continue;
    }
    if (owners.length > 1) {
      entries.push({
        ok: false,
        tag: proposal.tag,
        alias,
        reason: `la etiqueta «${proposal.tag}» es de ${owners.length} skills (${owners.map((owner) => owner.name).join(', ')}): elige tú a cuál pertenece`,
      });
      continue;
    }
    if ([skill.name, ...skill.aliases].some((known) => normalizeLine(known) === normalizeLine(alias))) {
      entries.push({ ok: false, tag: proposal.tag, alias, reason: `«${skill.name}» ya lo reconoce` });
      continue;
    }
    entries.push({ ok: true, tag: proposal.tag, alias, skill: skill.name });
  }
  return entries;
}

/** Una celda de CSV, con las comillas que el formato exija. */
function quote(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function unquote(cell: string): string {
  const trimmed = cell.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1).replace(/""/g, '"') : trimmed;
}

/** Trocea una línea de CSV respetando las comillas. */
function cells(line: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (char === ',' && !quoted) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

export interface AliasWriteResult {
  readonly path: string;
  readonly written: readonly AliasPlanEntry[];
}

export type AliasWriteOutcome = { readonly ok: true; readonly result: AliasWriteResult } | { readonly ok: false; readonly error: AppError };

/**
 * Escribe los alias en `skills.csv` **fila a fila, sin reescribir el fichero**: se añaden al final de la columna
 * `aliases` de la skill que toca. Nada más cambia —ni el orden, ni las comillas, ni las líneas de las demás
 * skills—, que es la misma promesa de `cv improve apply`.
 */
export async function saveAliases(context: AppContext, data: string, plan: readonly AliasPlanEntry[]): Promise<AliasWriteOutcome> {
  const path = resolve(context.cwd, data, 'skills.csv');
  const pending = plan.filter((entry): entry is Extract<AliasPlanEntry, { readonly ok: true }> => entry.ok);
  if (pending.length === 0) {
    return { ok: true, result: { path, written: [] } };
  }
  let content: string;
  try {
    content = await context.datasetFileSystem.readTextFile(path);
  } catch (error) {
    return { ok: false, error: notFoundError(`No se pudo leer ${path}: ${describeError(error)}`) };
  }
  const lines = content.split('\n');
  // `split` devuelve siempre al menos un elemento, incluso con el fichero vacío: no hay caso sin cabecera que
  // tratar aquí —uno vacío se cae más abajo, al no encontrar las columnas—.
  const header = cells(lines[0]!).map((cell) => unquote(cell).toLowerCase());
  const nameAt = header.indexOf('name');
  const aliasAt = header.indexOf('aliases');
  if (nameAt === -1 || aliasAt === -1) {
    return { ok: false, error: notFoundError(`${path} no tiene las columnas «name» y «aliases»`) };
  }
  const written: AliasPlanEntry[] = [];
  for (const entry of pending) {
    const index = lines.findIndex((line, position) => position > 0 && line.trim() !== '' && unquote(cells(line)[nameAt] ?? '') === entry.skill);
    if (index === -1) {
      continue;
    }
    const row = cells(lines[index]!);
    const current = unquote(row[aliasAt] ?? '');
    row[aliasAt] = quote(current === '' ? entry.alias : `${current}|${entry.alias}`);
    lines[index] = row.join(',');
    written.push(entry);
  }
  try {
    await context.artifactFileSystem.writeFile(path, lines.join('\n'), SOURCE_FILE_MODE);
  } catch (error) {
    return { ok: false, error: environmentError(`No se pudo escribir ${path}: ${describeError(error)}`) };
  }
  return { ok: true, result: { path, written } };
}
