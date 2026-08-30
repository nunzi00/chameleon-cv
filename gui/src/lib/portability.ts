/**
 * Exportar e importar el perfil desde la GUI (docs/portability.md §4.7): leer el JSON elegido, nombrar la
 * descarga y describir el plan que devuelve `POST /import`. Sin DOM: todo puro y probado al 100 %.
 */
import type { ImportResponse } from './api/types';
import { plural } from './format';

export type ParsedProfile = { readonly ok: true; readonly value: Record<string, unknown> } | { readonly ok: false; readonly message: string };

/** El texto de un fichero elegido por el usuario: JSON con o sin BOM, y tiene que ser un objeto (el perfil canónico). */
export function parseProfileText(text: string): ParsedProfile {
  let value: unknown;
  try {
    value = JSON.parse(text.startsWith('﻿') ? text.slice(1) : text);
  } catch (error) {
    // JSON.parse solo lanza SyntaxError.
    return { ok: false, message: `El fichero no es JSON válido: ${(error as SyntaxError).message}` };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, message: 'El fichero no contiene un objeto JSON: se esperaba el perfil canónico (profile.json)' };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

/** La misma serialización que `cv export` y `cv build`: dos espacios y salto final. */
export function serializeForDownload(profile: unknown): string {
  return `${JSON.stringify(profile, null, 2)}\n`;
}

/** `perfil-AAAA-MM-DD.json`, con la fecha local. */
export function profileFileName(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `perfil-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

export function describeCounts(counts: ImportResponse['plan']['counts']): string {
  return [
    plural(counts.specialties, 'especialidad', 'especialidades'),
    plural(counts.experience, 'experiencia', 'experiencias'),
    plural(counts.projects, 'proyecto', 'proyectos'),
    plural(counts.education, 'formación', 'formaciones'),
    plural(counts.skills, 'skill', 'skills'),
    plural(counts.certifications, 'certificación', 'certificaciones'),
    plural(counts.achievements, 'logro transversal', 'logros transversales'),
  ].join(', ');
}

/** El plan de importación, línea a línea: qué se escribiría, cuánto ocupa, qué contiene y los avisos. */
export function planLines(response: ImportResponse): string[] {
  return [
    `${plural(response.plan.files.length, 'fichero', 'ficheros')} en ${response.root} (${describeCounts(response.plan.counts)})`,
    ...response.plan.files.map((file) => `${file.path} (${plural(file.bytes, 'byte', 'bytes')})`),
    ...response.plan.warnings.map((warning) => `Aviso: ${warning}`),
    'Auto-chequeo superado: las fuentes regeneradas reproducen el perfil.',
  ];
}

/** El resumen tras escribir. */
export function describeImport(response: ImportResponse): string {
  const backup = response.backup === undefined ? '' : ` · las fuentes anteriores quedan en ${response.backup}`;
  return `Perfil importado en ${response.root}: ${plural(response.written.length, 'fichero', 'ficheros')}${backup} · compila para regenerar el artefacto`;
}
