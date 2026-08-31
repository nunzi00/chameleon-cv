/**
 * Aplicar al borrador una propuesta del co-piloto (T-9.5, docs/cv-import.md §7): mueve UNA línea sin situar a la
 * sección indicada y la registra en el informe. El modelo nunca aplica nada; aplica esta función cuando una
 * persona pulsa el botón, y solo la línea que le señala (C2). Lo que el esquema exige y la línea no trae —una
 * empresa, un puesto, un nivel de idioma— viaja en `fields`: aquí no se inventa ni un dato.
 */
import { dirname, resolve } from 'node:path';

import { identifier, linkLabel, mapLanguageLevel, unplacedFromReport, withApplied } from '../import';
import { IMPORT_SECTIONS, type ImportSection } from '../llm/tasks/import-map';
import { validateMasterProfile, type MasterProfile } from '../core/schema';
import { describeError } from '../shared/errors';
import type { AppContext } from './context';
import { loadSources } from './dataset';
import { dataError, environmentError, notFoundError, type AppError } from './errors';
import { canonicalOrder, planFiles } from './portability';
import { slugify } from './slug';
import { SOURCE_FILE_MODE } from './sources';

/** Campo de contacto al que va la línea: sin decirlo no se puede aplicar (un correo no es un teléfono). */
export const CONTACT_FIELDS = ['email', 'phone', 'location', 'link'] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];

/** Lo que el esquema exige y la línea no trae. Nada tiene valor por defecto: lo que falte, lo pone la persona. */
export interface ImportApplyFields {
  readonly company?: string | undefined;
  readonly role?: string | undefined;
  readonly institution?: string | undefined;
  readonly degree?: string | undefined;
  readonly start?: string | undefined;
  readonly end?: string | undefined;
  readonly level?: string | undefined;
  readonly contact?: string | undefined;
  readonly label?: string | undefined;
}

export interface ImportApplyRequest {
  readonly name: string;
  readonly line: number;
  readonly section: string;
  readonly fields?: ImportApplyFields | undefined;
}

export interface ImportApplyOutcome {
  readonly name: string;
  readonly section: ImportSection;
  readonly line: number;
  readonly text: string;
  /** Ficheros del borrador que cambiaron; vacío al descartar, que no escribe ninguna fuente. */
  readonly written: readonly string[];
  readonly report: string;
}

export type ImportApplyResult = { readonly ok: true; readonly outcome: ImportApplyOutcome } | { readonly ok: false; readonly error: AppError };

type Built = { readonly ok: true; readonly profile: unknown } | { readonly ok: false; readonly message: string };

const SECTIONS: ReadonlySet<string> = new Set<string>(IMPORT_SECTIONS);

/** Todos los identificadores en uso: los nuevos no pueden chocar con los que ya tiene el borrador. */
function usedIds(profile: MasterProfile): Set<string> {
  const groups = [profile.experience, profile.projects, profile.education, profile.certifications, profile.skills, profile.achievements, profile.specialties];
  return new Set(groups.flatMap((group) => group.map((item) => item.id)));
}

/** Falta un dato que solo puede poner quien revisa: se dice cuál y por qué, y no se escribe nada. */
function missing(what: string): Built {
  return { ok: false, message: what };
}

/** «Inglés — C1» → nombre y nivel; el nivel explícito de `fields` manda sobre lo que diga la línea. */
function language(text: string, fields: ImportApplyFields): Built | { readonly name: string; readonly level: string } {
  const parts = text.split(/\s*[—–:|]\s*|\s{2,}|\s+-\s+/, 2);
  // `split` siempre devuelve al menos un elemento, aunque sea la cadena vacía.
  const name = parts[0]!.trim();
  const level = fields.level?.trim() === '' ? undefined : fields.level ?? mapLanguageLevel(parts[1]?.trim());
  if (name === '') {
    return missing('la línea no tiene un nombre de idioma');
  }
  if (level === undefined) {
    return missing('un idioma exige su nivel MCER (A1–C2 o «native»): indícalo');
  }
  return { name, level };
}

function contact(profile: MasterProfile, text: string, fields: ImportApplyFields): Built {
  const field = fields.contact;
  if (field === undefined || !(CONTACT_FIELDS as readonly string[]).includes(field)) {
    return missing(`un dato de contacto exige saber qué campo es (${CONTACT_FIELDS.join(', ')})`);
  }
  const personal = profile.personal;
  switch (field as ContactField) {
    case 'email':
      return { ok: true, profile: { ...profile, personal: { ...personal, email: text } } };
    case 'phone':
      return { ok: true, profile: { ...profile, personal: { ...personal, phone: text } } };
    case 'location':
      return { ok: true, profile: { ...profile, personal: { ...personal, location: { city: text } } } };
    case 'link': {
      const label = fields.label?.trim() === '' || fields.label === undefined ? linkLabel(hostOf(text)) : fields.label;
      return { ok: true, profile: { ...profile, personal: { ...personal, links: [...personal.links, { label, url: text }] } } };
    }
  }
}

/** El host de una URL para etiquetar el enlace; lo que no es una URL se queda sin host y el esquema lo rechazará. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/**
 * El perfil con la línea ya colocada en su sección; devuelve el motivo cuando falta un dato obligatorio.
 * `descartar` no llega aquí a propósito: descartar no toca el perfil, solo el informe.
 */
export function applyToProfile(profile: MasterProfile, section: Exclude<ImportSection, 'descartar'>, text: string, fields: ImportApplyFields): Built {
  const used = usedIds(profile);
  switch (section) {
    case 'habilidad':
      return { ok: true, profile: { ...profile, skills: [...profile.skills, { id: identifier('skill', text, used), name: text }] } };
    case 'logro':
      return { ok: true, profile: { ...profile, achievements: [...profile.achievements, { id: identifier('logro', text.slice(0, 40), used), text }] } };
    case 'resumen': {
      const previous = profile.personal.summary;
      return { ok: true, profile: { ...profile, personal: { ...profile.personal, summary: previous === undefined ? text : `${previous}\n\n${text}` } } };
    }
    case 'proyecto':
      return { ok: true, profile: { ...profile, projects: [...profile.projects, { id: identifier('pro', text, used), name: text }] } };
    case 'certificacion':
      return { ok: true, profile: { ...profile, certifications: [...profile.certifications, { id: identifier('cert', text, used), name: text }] } };
    case 'idioma': {
      const parsed = language(text, fields);
      if ('ok' in parsed) {
        return parsed;
      }
      return { ok: true, profile: { ...profile, languages: [...profile.languages, parsed] } };
    }
    case 'contacto':
      return contact(profile, text, fields);
    case 'experiencia': {
      const { company, role, start, end } = fields;
      if (company === undefined || company.trim() === '' || role === undefined || role.trim() === '' || start === undefined || start.trim() === '') {
        return missing('una experiencia exige empresa, puesto y fecha de inicio');
      }
      const dates = { start: start.trim(), ...(end === undefined || end.trim() === '' ? {} : { end: end.trim() }) };
      const entry = { id: identifier('exp', `${company} ${role}`, used), company: company.trim(), role: role.trim(), dates, summary: text };
      return { ok: true, profile: { ...profile, experience: [...profile.experience, entry] } };
    }
    case 'formacion': {
      const { institution, degree, start, end } = fields;
      if (institution === undefined || institution.trim() === '' || degree === undefined || degree.trim() === '') {
        return missing('una formación exige institución y titulación');
      }
      const dates = start === undefined || start.trim() === '' ? undefined : { start: start.trim(), ...(end === undefined || end.trim() === '' ? {} : { end: end.trim() }) };
      const entry = { id: identifier('edu', `${institution} ${degree}`, used), institution: institution.trim(), degree: degree.trim(), ...(dates === undefined ? {} : { dates }), summary: text };
      return { ok: true, profile: { ...profile, education: [...profile.education, entry] } };
    }
  }
}

/**
 * Mueve la línea y deja el borrador escrito. Un solo camino para la CLI y la API (C14): se relee el borrador con
 * el mismo cargador que valida `cv build --data`, se añade la entidad, se replanifican los ficheros y se escriben
 * SOLO los que cambian. Si la entidad nueva no cumpliera el esquema, no se escribe nada: el borrador que sale de
 * aplicar una propuesta siempre valida.
 */
export async function applyImportProposal(context: AppContext, request: ImportApplyRequest): Promise<ImportApplyResult> {
  // slugify reduce a [a-z0-9-]: el nombre no puede escaparse de import/.
  const name = slugify(request.name);
  if (name === '') {
    return { ok: false, error: dataError(`«${request.name}» no es un nombre de borrador válido`) };
  }
  if (!SECTIONS.has(request.section)) {
    return { ok: false, error: dataError(`«${request.section}» no es una sección del vocabulario (${IMPORT_SECTIONS.join(', ')})`) };
  }
  const section = request.section as ImportSection;
  const root = resolve(context.cwd, 'import', name);
  const reportPath = resolve(root, 'README.md');
  let current: string;
  try {
    current = await context.datasetFileSystem.readTextFile(reportPath);
  } catch {
    return { ok: false, error: notFoundError(`No existe el informe del borrador import/${name} (README.md); impórtalo primero`) };
  }
  const line = unplacedFromReport(current).find((item) => item.line === request.line);
  if (line === undefined) {
    return { ok: false, error: notFoundError(`El informe de import/${name} no tiene la línea ${request.line} sin situar (¿ya la moviste?)`) };
  }

  const written: string[] = [];
  if (section !== 'descartar') {
    const loaded = await loadSources(context, { data: root });
    if (!loaded.ok) {
      return { ok: false, error: dataError(`El borrador import/${name} no valida, así que no se puede aplicar nada sobre él:\n${loaded.error.message}`, loaded.error.lines) };
    }
    const built = applyToProfile(loaded.dataset.profile, section, line.text, request.fields ?? {});
    if (!built.ok) {
      return { ok: false, error: dataError(built.message) };
    }
    const validated = validateMasterProfile(built.profile);
    if (!validated.ok) {
      return { ok: false, error: dataError(`La línea no cabe en «${section}» tal cual: ${validated.issues[0]!.message}`) };
    }
    const plan = planFiles(validated.profile, canonicalOrder(validated.profile).naming);
    for (const planned of plan) {
      const destination = resolve(root, planned.path);
      let before: string | undefined;
      try {
        before = await context.datasetFileSystem.readTextFile(destination);
      } catch {
        before = undefined;
      }
      if (before === planned.content) {
        continue;
      }
      try {
        await context.artifactFileSystem.mkdir(dirname(destination));
        await context.artifactFileSystem.writeFile(destination, planned.content, SOURCE_FILE_MODE);
      } catch (error) {
        return { ok: false, error: environmentError(`No se pudo escribir ${planned.path} en import/${name}: ${describeError(error)}`) };
      }
      written.push(planned.path);
    }
  }

  const report = withApplied(current, { n: line.line, section, text: line.text, file: written.join(', ') });
  try {
    await context.artifactFileSystem.writeFile(reportPath, report, SOURCE_FILE_MODE);
  } catch (error) {
    return { ok: false, error: environmentError(`No se pudo actualizar ${reportPath}: ${describeError(error)}`) };
  }
  return { ok: true, outcome: { name, section, line: line.line, text: line.text, written, report } };
}
