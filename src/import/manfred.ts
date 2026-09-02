/**
 * Importar un MAC de Manfred (T-9.22, `docs/cv-import.md` §12): el JSON que Manfred exporta
 * («Manfred Awesome CV», <https://github.com/getmanfred/mac>) trae los datos **ya estructurados**, así que aquí
 * no se adivina ninguna maquetación: se leen los campos y se rellena el mismo `DraftProfile` que produce el
 * importador de PDF, de modo que todo lo de aguas abajo —validación entidad a entidad, ficheros del borrador,
 * informe, adopción— sirve sin cambios. Como en la exportación de LinkedIn, no queda nada «sin situar».
 *
 * Sin red: el `$schema` del fichero **no se descarga**. Se lee de forma tolerante —lo que no se reconoce se
 * ignora y se dice en el informe— porque un MAC de otra versión no puede tirar la importación entera.
 *
 * Lo que el MAC trae y el perfil no sabe guardar (preferencias de búsqueda, salario, recomendaciones…) no se
 * inventa un sitio: se anota en el informe como no importado, que es lo honesto.
 */
import type { DraftAchievement, DraftEntry, DraftLanguage, DraftProfile, DraftSkillGroup, Provenance } from './structure';

/** Un MAC es un JSON de perfil, no un archivo: más de esto es otra cosa. */
const MAX_JSON_BYTES = 4 * 1024 * 1024;

export type ManfredResult =
  | {
      readonly ok: true;
      readonly draft: DraftProfile;
      /** Lo que el fichero traía y el perfil no guarda; va al informe como aviso, nunca en silencio. */
      readonly notes: readonly string[];
    }
  | { readonly ok: false; readonly message: string };

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectAt(value: unknown, ...path: readonly string[]): Json | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!isObject(current)) {
      return undefined;
    }
    current = current[key];
  }
  return isObject(current) ? current : undefined;
}

function arrayAt(value: unknown, ...path: readonly string[]): readonly unknown[] {
  let current: unknown = value;
  for (const key of path) {
    if (!isObject(current)) {
      return [];
    }
    current = current[key];
  }
  return Array.isArray(current) ? current : [];
}

/** Un texto con contenido, o `undefined`: en MAC un campo vacío y un campo ausente significan lo mismo. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function textAt(value: unknown, ...path: readonly string[]): string | undefined {
  const last = path[path.length - 1] as string;
  const parent = path.length === 1 ? (isObject(value) ? value : undefined) : objectAt(value, ...path.slice(0, -1));
  return parent === undefined ? undefined : text(parent[last]);
}

/**
 * Los cinco niveles de MAC (los mismos textos que usa LinkedIn) al MCER. Lo que no esté en la tabla se deja sin
 * nivel y el esquema lo dirá: aproximar un idioma a ojo es inventar.
 */
const PROFICIENCY: ReadonlyMap<string, string> = new Map([
  ['native or bilingual proficiency', 'native'],
  ['full professional proficiency', 'C1'],
  ['professional working proficiency', 'B2'],
  ['limited working proficiency', 'B1'],
  ['elementary proficiency', 'A2'],
]);

/** La procedencia de una entrada de MAC: no hay líneas, así que se cita la ruta dentro del JSON. */
function provenance(path: string, title: string): Provenance {
  return { line: 0, text: `${path}: ${title}` };
}

function entryOf(path: string, fields: Omit<DraftEntry, 'technologies' | 'achievements' | 'provenance'>, technologies: readonly string[] = [], achievements: readonly DraftAchievement[] = []): DraftEntry {
  return { ...fields, technologies: [...technologies], achievements: [...achievements], provenance: provenance(path, fields.title) };
}

/** «Lucas» + «Nunzi» → «Lucas Nunzi»; con uno solo, ese. */
function fullNameOf(profile: Json | undefined): string | undefined {
  const parts = [textAt(profile, 'name'), textAt(profile, 'surnames')].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? undefined : parts.join(' ');
}

/**
 * La ubicación legible. Se descarta `notes` a propósito: Manfred la rellena con la traza de su autocompletado
 * («Autocompleted using Google Maps API (id: …)»), que no es una ubicación sino cómo se obtuvo.
 */
function locationOf(location: Json | undefined): string | undefined {
  const parts = [textAt(location, 'municipality'), textAt(location, 'region'), textAt(location, 'country')].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? undefined : [...new Set(parts)].join(', ');
}

/** Los enlaces del perfil: los relevantes y los perfiles públicos de contacto, sin repetir y en orden. */
function linksOf(mac: Json): string[] {
  const found = [...arrayAt(mac, 'aboutMe', 'relevantLinks'), ...arrayAt(mac, 'careerPreferences', 'contact', 'publicProfiles')]
    .map((link) => textAt(link, 'URL'))
    .filter((url): url is string => url !== undefined);
  return [...new Set(found)];
}

/** Los retos de un puesto son logros: su descripción y, si las trae, cada una de sus acciones. */
function challengesOf(role: unknown, path: string): DraftAchievement[] {
  const achievements: DraftAchievement[] = [];
  for (const [index, challenge] of arrayAt(role, 'challenges').entries()) {
    const description = textAt(challenge, 'description');
    if (description !== undefined) {
      achievements.push({ text: description, provenance: provenance(`${path}.challenges[${index}]`, description.slice(0, 60)) });
    }
    for (const action of arrayAt(challenge, 'actions')) {
      // Una acción es `{ description }` en el esquema, pero hay MAC con la cadena suelta: se admiten los dos.
      const line = typeof action === 'string' ? text(action) : textAt(action, 'description');
      if (line !== undefined) {
        achievements.push({ text: line, provenance: provenance(`${path}.challenges[${index}].actions`, line.slice(0, 60)) });
      }
    }
  }
  return achievements;
}

function competencesOf(role: unknown): string[] {
  return arrayAt(role, 'competences')
    .map((competence) => textAt(competence, 'name'))
    .filter((name): name is string => name !== undefined);
}

/** Un empleo con varios puestos es varias entradas: en el perfil, cada puesto tiene sus fechas y sus logros. */
function jobsOf(mac: Json): DraftEntry[] {
  const entries: DraftEntry[] = [];
  for (const [index, job] of arrayAt(mac, 'experience', 'jobs').entries()) {
    const organization = textAt(job, 'organization', 'name');
    const location = locationOf(objectAt(job, 'organization', 'location'));
    for (const [position, role] of arrayAt(job, 'roles').entries()) {
      const name = textAt(role, 'name');
      if (name === undefined) {
        continue;
      }
      const path = `experience.jobs[${index}].roles[${position}]`;
      entries.push(
        entryOf(
          path,
          {
            title: name,
            subtitle: organization,
            location,
            start: textAt(role, 'startDate'),
            end: textAt(role, 'finishDate'),
            summary: textAt(role, 'notes'),
          },
          competencesOf(role),
          challengesOf(role, path),
        ),
      );
    }
  }
  return entries;
}

/** Los proyectos de MAC (`proBono`, `openSource`, `sideProject`…): su detalle y las fechas de su rol. */
function projectsOf(mac: Json): DraftEntry[] {
  const entries: DraftEntry[] = [];
  for (const [index, project] of arrayAt(mac, 'experience', 'projects').entries()) {
    const name = textAt(project, 'details', 'name');
    if (name === undefined) {
      continue;
    }
    const role = arrayAt(project, 'roles')[0];
    entries.push(
      entryOf(
        `experience.projects[${index}]`,
        {
          title: name,
          subtitle: textAt(role, 'name'),
          url: textAt(project, 'details', 'URL'),
          summary: textAt(project, 'details', 'description'),
          start: textAt(role, 'startDate'),
          end: textAt(role, 'finishDate'),
        },
        competencesOf(role),
        challengesOf(role, `experience.projects[${index}]`),
      ),
    );
  }
  return entries;
}

/** Un estudio con `studyType: certification` es una certificación; el resto, formación. MAC no las separa. */
function studiesOf(mac: Json): { readonly education: DraftEntry[]; readonly certifications: DraftEntry[] } {
  const education: DraftEntry[] = [];
  const certifications: DraftEntry[] = [];
  for (const [index, study] of arrayAt(mac, 'knowledge', 'studies').entries()) {
    const name = textAt(study, 'name');
    if (name === undefined) {
      continue;
    }
    const path = `knowledge.studies[${index}]`;
    const institution = textAt(study, 'institution', 'name');
    const start = textAt(study, 'startDate');
    const end = textAt(study, 'finishDate');
    if (textAt(study, 'studyType') === 'certification') {
      certifications.push(entryOf(path, { title: name, subtitle: institution, date: end ?? start, url: textAt(study, 'institution', 'URL') }));
    } else {
      education.push(entryOf(path, { title: name, subtitle: institution, start, end, summary: textAt(study, 'description') }));
    }
  }
  return { education, certifications };
}

/**
 * Las habilidades. MAC dice de cada una un `type` («technology»…) que **no** es ninguna de las categorías del
 * perfil, así que las duras entran sin categoría —el esquema las deja en «other» y tú las clasificas— y las
 * blandas sí, que ahí la equivalencia es exacta.
 */
function skillsOf(mac: Json): DraftSkillGroup[] {
  const groups: DraftSkillGroup[] = [];
  const named = (items: readonly unknown[], key: 'skill' | undefined): string[] =>
    items.map((item) => (key === undefined ? textAt(item, 'name') : textAt(item, key, 'name'))).filter((name): name is string => name !== undefined);

  const hard = named(arrayAt(mac, 'knowledge', 'hardSkills'), 'skill');
  // El «stack principal» de Manfred son habilidades como las demás; se añaden sin repetir.
  const stack = named(arrayAt(mac, 'manfredSpecificData', 'mainStackTechs'), undefined);
  const all = [...new Set([...hard, ...stack])];
  if (all.length > 0) {
    groups.push({ category: undefined, names: all, provenance: provenance('knowledge.hardSkills', `${all.length} habilidades`) });
  }
  const soft = named(arrayAt(mac, 'knowledge', 'softSkills'), 'skill');
  if (soft.length > 0) {
    groups.push({ category: 'soft', names: soft, provenance: provenance('knowledge.softSkills', `${soft.length} habilidades`) });
  }
  return groups;
}

function languagesOf(mac: Json): DraftLanguage[] {
  const languages: DraftLanguage[] = [];
  for (const language of arrayAt(mac, 'knowledge', 'languages')) {
    const name = textAt(language, 'fullName') ?? textAt(language, 'name');
    if (name === undefined) {
      continue;
    }
    const level = textAt(language, 'level');
    languages.push({ name, level: level === undefined ? undefined : PROFICIENCY.get(level.toLowerCase()) });
  }
  return languages;
}

/**
 * Lo que el fichero trae y el perfil no guarda. No se calla ni se le busca un hueco forzado: se dice, para que
 * quien revisa sepa qué se quedó en Manfred.
 */
function notesOf(mac: Json, studies: readonly unknown[]): string[] {
  const notes: string[] = [];
  const mention = (count: number, what: string): void => {
    if (count > 0) {
      notes.push(`no importado (el perfil no lo guarda): ${what}`);
    }
  };
  mention(arrayAt(mac, 'careerPreferences', 'preferences', 'preferredRoles').length, 'los puestos que buscas');
  mention(arrayAt(mac, 'careerPreferences', 'requirements', 'contractTypes').length, 'el tipo de contrato que buscas');
  mention(objectAt(mac, 'careerPreferences', 'currentSalary') === undefined ? 0 : 1, 'tu salario actual');
  mention(arrayAt(mac, 'aboutMe', 'recommendations').length, 'las recomendaciones');
  mention(arrayAt(mac, 'aboutMe', 'interestingFacts').length, 'los «interesting facts»');
  mention(arrayAt(mac, 'experience', 'publicArtifacts').length, 'los artefactos públicos (charlas, posts, vídeos)');
  if (textAt(mac, 'careerPreferences', 'status') !== undefined) {
    notes.push('no importado (el perfil no lo guarda): tu estado de búsqueda');
  }
  if (arrayAt(mac, 'knowledge', 'hardSkills').some((skill) => textAt(skill, 'level') !== undefined)) {
    notes.push('los niveles de las habilidades no se importan: MAC los da como básico/intermedio/alto/experto y aquí se revisan a mano');
  }

  // El perfil guarda la ubicación como ciudad (obligatoria), región y país; el borrador solo lleva una línea, que
  // acaba en `city`. Si el MAC no dijo el municipio, ahí queda un país haciendo de ciudad: se avisa para que se
  // corrija, en vez de dejar un dato que se ve raro en el CV sin explicación.
  const location = objectAt(mac, 'aboutMe', 'profile', 'location');
  if (location !== undefined && textAt(location, 'municipality') === undefined && locationOf(location) !== undefined) {
    notes.push(`la ubicación queda como «${locationOf(location) as string}» en el campo de ciudad: el MAC no dice el municipio, así que ajústala en profile.md`);
  }

  // Manfred rellena la fecha de un estudio con el día en que lo escribiste si no recuerdas cuándo lo cursaste.
  // Varias con la MISMA fecha y ninguna terminada es esa forma exacta, y hay que mirarla antes de adoptar.
  const starts = studies.map((study) => textAt(study, 'startDate')).filter((start): start is string => start !== undefined);
  const repeated = starts.filter((start, index) => starts.indexOf(start) !== index);
  if (repeated.length > 0 && studies.every((study) => textAt(study, 'finishDate') === undefined)) {
    notes.push(`revisa las fechas de la formación: ${starts.length} estudios comparten la fecha de inicio «${repeated[0] as string}» y ninguno tiene fin, que es lo que queda cuando se rellenan de una sentada`);
  }
  return notes;
}

/**
 * Del JSON de Manfred al borrador. Tolerante por diseño: lo que no se reconoce no rompe nada; solo se exige que
 * el fichero **sea** un MAC, porque importar otro JSON cualquiera daría un perfil vacío sin decir por qué.
 */
export function importManfredMac(input: Uint8Array | string): ManfredResult {
  if (typeof input !== 'string' && input.byteLength > MAX_JSON_BYTES) {
    return { ok: false, message: `El fichero pesa ${Math.round(input.byteLength / 1024)} KiB: un MAC es un perfil, no un archivo (máximo ${MAX_JSON_BYTES / 1024 / 1024} MiB)` };
  }
  let parsed: unknown;
  try {
    const raw = typeof input === 'string' ? input : new TextDecoder('utf-8').decode(input);
    parsed = JSON.parse(raw.startsWith('﻿') ? raw.slice(1) : raw);
  } catch (error) {
    return { ok: false, message: `El fichero no es JSON válido: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!isObject(parsed)) {
    return { ok: false, message: 'El fichero no es un objeto JSON: un MAC empieza por «{»' };
  }
  const mac = parsed;
  const looksLikeMac = textAt(mac, 'settings', 'MACVersion') !== undefined || (textAt(mac, '$schema') ?? '').includes('/mac/') || ['aboutMe', 'experience', 'knowledge'].some((key) => isObject(mac[key]));
  if (!looksLikeMac) {
    return { ok: false, message: 'El JSON no parece un MAC de Manfred: se esperaba «settings.MACVersion» o alguna de las secciones «aboutMe», «experience» o «knowledge»' };
  }

  const profile = objectAt(mac, 'aboutMe', 'profile');
  const contact = objectAt(profile, 'contact');
  const { education, certifications } = studiesOf(mac);
  const draft: DraftProfile = {
    fullName: fullNameOf(profile),
    headline: textAt(profile, 'title'),
    email: textAt(arrayAt(contact, 'contactMails')[0], 'email') ?? text(arrayAt(contact, 'contactMails')[0]),
    phone: textAt(arrayAt(contact, 'phoneNumbers')[0], 'number') ?? text(arrayAt(contact, 'phoneNumbers')[0]),
    location: locationOf(objectAt(profile, 'location')),
    links: linksOf(mac),
    summary: textAt(profile, 'description'),
    experience: jobsOf(mac),
    projects: projectsOf(mac),
    education,
    certifications,
    skills: skillsOf(mac),
    achievements: [],
    languages: languagesOf(mac),
    sections: [],
    // Un MAC dice a qué sección pertenece cada dato: aquí no queda nada «sin situar», como en LinkedIn.
    unparsed: [],
  };
  const version = textAt(mac, 'settings', 'MACVersion');
  const notes = notesOf(mac, arrayAt(mac, 'knowledge', 'studies'));
  if (version !== undefined && !version.startsWith('0.5')) {
    notes.unshift(`el fichero declara MAC ${version} y este lector se escribió para la 0.5: lo que no reconozca se habrá quedado fuera`);
  }
  return { ok: true, draft, notes };
}
