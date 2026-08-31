/**
 * Importar la exportación oficial de datos de LinkedIn (T-9.8, docs/cv-import.md §8): el zip que LinkedIn
 * entrega en «Ajustes → Privacidad de datos → Obtener una copia de tus datos» trae los datos YA ESTRUCTURADOS
 * en CSV, así que aquí no se adivina ninguna maquetación: se leen las columnas y se rellena el mismo
 * `DraftProfile` que produce el importador de PDF, de modo que todo lo de aguas abajo sirve sin cambios.
 *
 * No hay red por ninguna parte. Raspar la URL de un perfil queda descartado a propósito: el `robots.txt` de
 * LinkedIn prohíbe el acceso automatizado y lo que devuelve una URL de perfil es el muro de acceso, no el CV.
 */
import { parse } from 'csv-parse/sync';

import { parsePoint } from './dates';
import { readZipEntries } from '../themes/archive';
import { describeError } from '../shared/errors';
import type { DraftEntry, DraftLanguage, DraftProfile, DraftSkillGroup, Provenance } from './structure';

/** Límite por CSV descomprimido: la exportación de un perfil enorme no llega; un zip-bomba se corta aquí. */
const MAX_CSV_BYTES = 8 * 1024 * 1024;

/** Los ficheros que interesan, por nombre base: la exportación a veces los envuelve en una carpeta. */
const FILES = ['Profile.csv', 'Positions.csv', 'Education.csv', 'Skills.csv', 'Languages.csv', 'Certifications.csv', 'Projects.csv', 'Email Addresses.csv', 'PhoneNumbers.csv'] as const;
type FileName = (typeof FILES)[number];

type Row = Record<string, string>;

export type LinkedInResult = { readonly ok: true; readonly draft: DraftProfile; readonly read: readonly string[] } | { readonly ok: false; readonly message: string };

/** Los cinco niveles que usa LinkedIn, a MCER. Lo que no esté en la lista se deja sin nivel y se avisa. */
const PROFICIENCY: ReadonlyMap<string, string> = new Map([
  ['native or bilingual proficiency', 'native'],
  ['full professional proficiency', 'C1'],
  ['professional working proficiency', 'B2'],
  ['limited working proficiency', 'B1'],
  ['elementary proficiency', 'A2'],
]);

function rowsOf(content: string): Row[] {
  // La exportación es siempre coma y comillas dobles; `relax_column_count` evita que una fila con una columna
  // de más (LinkedIn las añade entre versiones) tire toda la importación.
  return parse(content, { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true });
}

function value(row: Row, ...names: readonly string[]): string {
  for (const name of names) {
    const found = row[name];
    if (found !== undefined && found.trim() !== '') {
      return found.trim();
    }
  }
  return '';
}

function optional(text: string): string | undefined {
  return text === '' ? undefined : text;
}

/** Procedencia legible: el CSV y la fila, que es lo que hay que mirar para corregir algo a mano. */
function provenance(file: string, index: number, text: string): Provenance {
  return { line: index + 2, text: `${file}: ${text}` };
}

function entry(file: string, index: number, fields: Omit<DraftEntry, 'technologies' | 'achievements' | 'provenance'>): DraftEntry {
  return { ...fields, technologies: [], achievements: [], provenance: provenance(file, index, fields.title) };
}

/** «[GITHUB:https://…]» y variantes: la columna Websites de LinkedIn empaqueta etiqueta y URL. */
function websites(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s,\]]+/g)].map((match) => match[0]);
}

export function importLinkedInExport(bytes: Uint8Array): LinkedInResult {
  let entries;
  try {
    entries = readZipEntries(bytes);
  } catch (error) {
    return { ok: false, message: `el archivo no se puede leer como zip: ${describeError(error)}` };
  }
  const csv = new Map<FileName, Row[]>();
  const read: string[] = [];
  for (const name of FILES) {
    const found = entries.find((candidate) => candidate.type === 'file' && candidate.path.split('/').at(-1) === name);
    if (found === undefined || found.type !== 'file') {
      continue;
    }
    let rows: Row[];
    try {
      rows = rowsOf(new TextDecoder('utf-8', { fatal: false }).decode(found.read(MAX_CSV_BYTES)));
    } catch (error) {
      return { ok: false, message: `${name} no se pudo leer: ${describeError(error)}` };
    }
    csv.set(name, rows);
    read.push(name);
  }
  if (!csv.has('Profile.csv') && !csv.has('Positions.csv')) {
    return { ok: false, message: 'el zip no parece una exportación de LinkedIn: no trae ni Profile.csv ni Positions.csv' };
  }

  const profile = csv.get('Profile.csv')?.[0] ?? {};
  const fullName = [value(profile, 'First Name'), value(profile, 'Last Name')].filter((part) => part !== '').join(' ');
  const primaryEmail = (csv.get('Email Addresses.csv') ?? []).find((row) => value(row, 'Primary').toLowerCase() === 'yes') ?? csv.get('Email Addresses.csv')?.[0];

  const experience = (csv.get('Positions.csv') ?? []).map((row, index) => {
    const end = parsePoint(value(row, 'Finished On'));
    return entry('Positions.csv', index, {
      title: value(row, 'Title'),
      subtitle: optional(value(row, 'Company Name')),
      location: optional(value(row, 'Location')),
      start: parsePoint(value(row, 'Started On')),
      end,
      current: value(row, 'Finished On') === '',
      summary: optional(value(row, 'Description')),
    });
  });

  const education = (csv.get('Education.csv') ?? []).map((row, index) =>
    entry('Education.csv', index, {
      title: value(row, 'Degree Name', 'Notes'),
      subtitle: optional(value(row, 'School Name')),
      start: parsePoint(value(row, 'Start Date')),
      end: parsePoint(value(row, 'End Date')),
      summary: optional(value(row, 'Activities')),
    }),
  );

  const certifications = (csv.get('Certifications.csv') ?? []).map((row, index) =>
    entry('Certifications.csv', index, {
      title: value(row, 'Name'),
      subtitle: optional(value(row, 'Authority')),
      date: parsePoint(value(row, 'Started On')),
      url: optional(value(row, 'Url')),
    }),
  );

  const projects = (csv.get('Projects.csv') ?? []).map((row, index) =>
    entry('Projects.csv', index, {
      title: value(row, 'Title'),
      url: optional(value(row, 'Url')),
      start: parsePoint(value(row, 'Started On')),
      end: parsePoint(value(row, 'Finished On')),
      summary: optional(value(row, 'Description')),
    }),
  );

  const names = (csv.get('Skills.csv') ?? []).map((row) => value(row, 'Name')).filter((name) => name !== '');
  const skills: DraftSkillGroup[] = names.length === 0 ? [] : [{ category: undefined, names, provenance: provenance('Skills.csv', 0, `${names.length} habilidades`) }];

  const languages: DraftLanguage[] = (csv.get('Languages.csv') ?? [])
    .map((row): DraftLanguage => ({ name: value(row, 'Name'), level: PROFICIENCY.get(value(row, 'Proficiency').toLowerCase()) }))
    .filter((language) => language.name !== '');

  const draft: DraftProfile = {
    fullName: optional(fullName),
    headline: optional(value(profile, 'Headline')),
    summary: optional(value(profile, 'Summary')),
    location: optional(value(profile, 'Geo Location', 'Address')),
    email: primaryEmail === undefined ? undefined : optional(value(primaryEmail, 'Email Address')),
    phone: optional(value(csv.get('PhoneNumbers.csv')?.[0] ?? {}, 'Number')),
    links: websites(value(profile, 'Websites')),
    experience: experience.filter((item) => item.title !== ''),
    projects: projects.filter((item) => item.title !== ''),
    education: education.filter((item) => item.title !== ''),
    certifications: certifications.filter((item) => item.title !== ''),
    skills,
    achievements: [],
    languages,
    sections: [],
    // Nada queda «sin situar»: el CSV dice a qué sección pertenece cada fila. Lo que no cumpla el esquema lo
    // degradará `draftFiles` con su motivo, como con cualquier otro origen.
    unparsed: [],
  };
  return { ok: true, draft, read };
}
