/**
 * Historial de ofertas procesadas (requisito del Director, 2026-08-30): cada `analyze-offer` y cada `generate-cv` con
 * oferta deja una entrada en `output/historial-ofertas.json` con la huella del texto de la oferta, la fecha, la
 * especialidad y el CV escrito; al volver a añadir la misma oferta, el producto avisa de cuándo se procesó y con qué CV.
 * Es un fichero del usuario, en `output/` como los CV; leerlo nunca falla (si falta o está corrupto, no hay historial)
 * y escribirlo es un efecto de la propia orden que escribe el CV o analiza la oferta.
 */
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';

import type { AppContext } from './context';
import type { CvFormat } from './format';

export const HISTORY_FILE = 'output/historial-ofertas.json';
/** Entradas conservadas (las más antiguas se descartan). */
export const HISTORY_LIMIT = 500;
const HISTORY_MODE = 0o600;

export interface HistoryEntry {
  /** Fecha ISO (UTC) del procesamiento. */
  readonly at: string;
  readonly action: 'analyze' | 'generate';
  readonly offer: { readonly name: string; readonly sha256: string };
  readonly specialty?: string | undefined;
  /** Solo `generate`: el CV escrito. */
  readonly output?: { readonly path: string; readonly format: CvFormat; readonly engine?: 'pdfkit' | 'typst' | undefined; readonly theme?: string | undefined } | undefined;
}

interface HistoryFile {
  readonly version: 1;
  readonly entries: readonly HistoryEntry[];
}

/** Huella del texto de la oferta: espacios colapsados y minúsculas, para que la misma oferta pegada o extraída dos veces coincida. */
export function offerFingerprint(text: string): string {
  return createHash('sha256').update(text.replace(/\s+/g, ' ').trim().toLowerCase(), 'utf8').digest('hex');
}

export function historyPath(cwd: string): string {
  return resolve(cwd, HISTORY_FILE);
}

const isEntry = (value: unknown): value is HistoryEntry =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as HistoryEntry).at === 'string' &&
  ((value as HistoryEntry).action === 'analyze' || (value as HistoryEntry).action === 'generate') &&
  typeof (value as HistoryEntry).offer === 'object' &&
  (value as HistoryEntry).offer !== null &&
  typeof (value as HistoryEntry).offer.sha256 === 'string' &&
  typeof (value as HistoryEntry).offer.name === 'string';

/** Las entradas guardadas; un fichero ausente o inválido equivale a no tener historial. */
export async function readHistory(context: Pick<AppContext, 'cwd' | 'artifactFileSystem'>): Promise<HistoryEntry[]> {
  let raw: string;
  try {
    raw = await context.artifactFileSystem.readFile(historyPath(context.cwd));
  } catch {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const entries = typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as HistoryFile).entries) ? (parsed as HistoryFile).entries : [];
    return entries.filter(isEntry);
  } catch {
    return [];
  }
}

/** Las entradas de una oferta (misma huella), de la más reciente a la más antigua. */
export function lookupHistory(entries: readonly HistoryEntry[], sha256: string): HistoryEntry[] {
  return entries.filter((entry) => entry.offer.sha256 === sha256).sort((a, b) => b.at.localeCompare(a.at));
}

/** Añade una entrada (conservando como mucho `HISTORY_LIMIT`) y escribe el fichero con permisos 0600; devuelve el error si no se pudo. */
export async function recordHistory(context: Pick<AppContext, 'cwd' | 'artifactFileSystem'>, entry: HistoryEntry): Promise<string | undefined> {
  const entries = [...(await readHistory(context)), entry].slice(-HISTORY_LIMIT);
  const file: HistoryFile = { version: 1, entries };
  const path = historyPath(context.cwd);
  try {
    await context.artifactFileSystem.mkdir(dirname(path));
    await context.artifactFileSystem.writeFile(path, `${JSON.stringify(file, null, 2)}\n`, HISTORY_MODE);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Una línea por procesamiento previo: «2026-08-30T10:12:00.000Z · analyze-offer (backend)» o «… · generate-cv (backend) → output/cv.pdf». */
export function describeHistory(entries: readonly HistoryEntry[]): string {
  if (entries.length === 0) {
    return '';
  }
  const lines = entries.map((entry) => {
    const action = entry.action === 'analyze' ? 'analyze-offer' : 'generate-cv';
    const specialty = entry.specialty === undefined ? '' : ` (${entry.specialty})`;
    const output = entry.output === undefined ? '' : ` → ${entry.output.path}`;
    return `  ${entry.at} · ${action}${specialty}${output}`;
  });
  return `Esta oferta ya se procesó ${entries.length === 1 ? 'una vez' : `${entries.length} veces`}:\n${lines.join('\n')}\n`;
}
