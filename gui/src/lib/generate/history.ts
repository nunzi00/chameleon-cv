/** Texto de los procesamientos previos de una oferta (respuesta de POST /offers/history, /analyze-offer o /generate). */
import type { HistoryEntry } from '../api/types';

/** «2026-08-30 12:10» a partir de la fecha ISO (UTC), sin depender de la configuración regional del navegador. */
export function shortDate(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return match === null ? iso : `${match[1]} ${match[2]}`;
}

export function describeHistoryEntries(entries: readonly HistoryEntry[]): string[] {
  return entries.map((entry) => {
    const action = entry.action === 'analyze' ? 'Analizar oferta' : 'Generar CV';
    const specialty = entry.specialty === undefined ? '' : ` (${entry.specialty})`;
    const output = entry.output === undefined ? '' : ` → ${entry.output.path}`;
    return `${shortDate(entry.at)} · ${action}${specialty}${output}`;
  });
}
