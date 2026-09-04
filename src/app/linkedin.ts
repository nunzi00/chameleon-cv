/**
 * El plan para poner LinkedIn al día a partir de tus fuentes (T-9.27, encargo del PO del 3-sep: «me falta un
 * botón en la web para generar las mejoras de linkedin en base al perfil»).
 *
 * No hay modelo ni red: es un **diff entre dos perfiles** —el tuyo y el que LinkedIn exportó— con la misma
 * regla de identidad que usa el detector de duplicados (`sameOrganization` + `periodsOverlap`, B-20). Si dos
 * entradas son de la misma empresa y sus periodos coinciden, son el mismo empleo y lo que difiera es algo que
 * corregir; si no aparece, es algo que añadir.
 *
 * Tres acciones, y la tercera mira al revés que las otras dos:
 *
 * - `add`: está en tus fuentes y no en LinkedIn.
 * - `fix`: está en los dos y no dice lo mismo. **Tus fuentes son la referencia**, porque son las que compilas,
 *   versionas y de las que salen tus CV.
 * - `pending`: le falta a **tu perfil**, no a LinkedIn. Subir un puesto sin un solo logro no mejora nada, así
 *   que lo que hay que arreglar antes se dice aparte en vez de mezclarlo con lo que ya se puede copiar.
 *
 * Sin borrador de LinkedIn el plan sigue saliendo: todo lo que tienes es `add`, que es exactamente lo que
 * necesita quien aún no ha exportado nada.
 */
import type { Education, Experience, MasterProfile, Project } from '../core/schema';
import type { AppContext } from './context';
import { loadSources } from './dataset';
import { DRAFTS_DIR, isDraftName } from './drafts';
import { entriesOf, periodsOverlap, sameOrganization, signaturesOf, similarity, type AdoptableSection, type ProfileEntry } from './duplicates';
import { dataError, type AppError } from './errors';
export type PlanAction = 'add' | 'fix' | 'pending';
export type PlanKind = 'headline' | 'about' | 'experience' | 'project' | 'skills' | 'languages' | 'education' | 'certifications';
export interface PlanItem {
  readonly action: PlanAction;
  readonly kind: PlanKind;
  /** Qué hacer, en una línea. */
  readonly title: string;
  /** El texto listo para copiar en LinkedIn, cuando lo hay. */
  readonly body?: string | undefined;
  /** Por qué, cuando no se ve solo. */
  readonly reason?: string | undefined;
}
export interface LinkedinPlan {
  /** Borrador comparado (`import/<nombre>`); ausente si no se comparó con ninguno. */
  readonly draft?: string | undefined;
  readonly items: readonly PlanItem[];
  readonly counts: Readonly<Record<PlanAction, number>>;
}
export type LinkedinPlanResult = { readonly ok: true; readonly plan: LinkedinPlan } | { readonly ok: false; readonly error: AppError };
export interface LinkedinPlanRequest {
  readonly data: string;
  /** Borrador con lo exportado de LinkedIn; sin él, el plan es «todo lo tuyo va a LinkedIn». */
  readonly draft?: string | undefined;
}
/** El periodo de una entrada como se lee en LinkedIn: «may 2022 – actualidad». */
function period(entry: Pick<ProfileEntry, 'start' | 'end'>): string {
  if (entry.start === undefined) {
    return 'sin fechas';
  }
  return `${entry.start} – ${entry.end ?? 'actualidad'}`;
}
/** A qué sección del plan pertenece una entrada del perfil. */
function kindOf(section: AdoptableSection): PlanKind {
  return section === 'experience' ? 'experience' : section === 'projects' ? 'project' : 'education';
}

/**
 * Empareja cada entrada con **la misma cosa** del otro perfil: misma organización y periodos que coinciden
 * (B-20). Dos decisiones que solo se ven con datos reales:
 *
 * - **Uno a uno**: una entrada emparejada se consume. Sin esto, la única «desarrollo de aplicaciones web · ies
 *   muralla romana» que exportó LinkedIn —sin fechas, así que casa con cualquier periodo— salía como
 *   contrapartida de las TRES titulaciones del mismo instituto, y las tres se anotaban como «corregir».
 * - **La mejor, no la primera**: entre las candidatas gana la que más se parece por título. Es lo que hace que
 *   el «Software Developer · Life5» de LinkedIn, abierto desde 2022, se empareje con **una** de las cuatro
 *   etapas y deje las otras tres como «añadir», que es justo lo que hay que hacer.
 */
function pairUp(mine: readonly ProfileEntry[], theirs: readonly ProfileEntry[]): ReadonlyMap<string, ProfileEntry> {
  const pool = [...theirs];
  const pairs = new Map<string, ProfileEntry>();
  for (const entry of mine) {
    const signature = signaturesOf(entry);
    let best: { readonly index: number; readonly score: number } | undefined;
    for (const [index, other] of pool.entries()) {
      if (other.section !== entry.section || !sameOrganization(signature, signaturesOf(other)) || !periodsOverlap(entry, other)) {
        continue;
      }
      const score = similarity(signature.title, signaturesOf(other).title);
      if (best === undefined || score > best.score) {
        best = { index, score };
      }
    }
    if (best !== undefined) {
      pairs.set(entry.id, pool[best.index] as ProfileEntry);
      pool.splice(best.index, 1);
    }
  }
  return pairs;
}
function experienceOf(profile: MasterProfile, id: string): Experience | undefined {
  return profile.experience.find((item) => item.id === id);
}
/**
 * El cuerpo que se copia en LinkedIn: el resumen de la entrada y sus logros como viñetas. Vale igual para un
 * puesto y para un proyecto porque los dos se cuentan igual —lo que hacías y lo que conseguiste—; distinguirlos
 * era la misma función escrita dos veces.
 */
function bodyOf(item: Experience | Project): string | undefined {
  const lines = [...(item.summary === undefined ? [] : [item.summary]), ...item.achievements.map((achievement) => `• ${achievement.text}`)];
  return lines.length === 0 ? undefined : lines.join('\n');
}

function educationLabel(item: Education): string {
  return `${item.degree} · ${item.institution}`;
}
/** Lo que le falta a TU perfil para que subirlo a LinkedIn valga la pena. */
function pendingItems(profile: MasterProfile): PlanItem[] {
  const items: PlanItem[] = [];
  for (const item of profile.experience) {
    if (item.achievements.length === 0) {
      items.push({
        action: 'pending',
        kind: 'experience',
        title: `«${item.role} · ${item.company}» no tiene ningún logro`,
        reason: 'Subir un puesto sin contenido no mejora el perfil: en LinkedIn sale como un titular suelto.',
      });
    }
    if (item.tags.length === 0) {
      items.push({
        action: 'pending',
        kind: 'experience',
        title: `«${item.role} · ${item.company}» no tiene etiquetas`,
        reason: 'Sin etiquetas el motor la trata como «universal» y no puede descartarla: entra en TODOS tus CV.',
      });
    }
  }
  if (profile.certifications.length === 0) {
    items.push({ action: 'pending', kind: 'certifications', title: 'No tienes ninguna certificación registrada', reason: 'LinkedIn tiene sección propia y es de las que más filtra un recruiter.' });
  }
  return items;
}
/**
 * Las habilidades del perfil que el borrador no trae. Se comparan **también por alias**: LinkedIn dice «GCP» y
 * tus fuentes «Google Cloud», y sin los alias esa habilidad saldría como si faltara.
 */
function missingSkills(profile: MasterProfile, draft: MasterProfile | undefined): readonly string[] {
  const known = new Set((draft?.skills ?? []).flatMap((skill) => [skill.name, ...skill.aliases]).map((name) => name.toLowerCase()));
  return profile.skills.filter((skill) => ![skill.name, ...skill.aliases].some((name) => known.has(name.toLowerCase()))).map((skill) => skill.name);
}
export async function linkedinPlan(context: AppContext, request: LinkedinPlanRequest): Promise<LinkedinPlanResult> {
  const loaded = await loadSources(context, { data: request.data });
  if (!loaded.ok) {
    return { ok: false, error: loaded.error };
  }
  const profile = loaded.dataset.profile;
  let draft: MasterProfile | undefined;
  if (request.draft !== undefined) {
    if (!isDraftName(request.draft)) {
      return { ok: false, error: dataError(`Nombre de borrador no válido «${request.draft}»`) };
    }
    const read = await loadSources(context, { data: `${DRAFTS_DIR}/${request.draft}` });
    if (!read.ok) {
      return { ok: false, error: dataError(`No se pudo leer el borrador «${request.draft}»: ${read.error.message}`, read.error.lines) };
    }
    draft = read.dataset.profile;
  }
  const items: PlanItem[] = [];
  const mine = entriesOf(profile);
  const theirs = draft === undefined ? [] : entriesOf(draft);
  const pairs = pairUp(mine, theirs);
  const paired = new Set(pairs.values());
  // 1. Titular y «Acerca de»: lo primero que se lee y lo que LinkedIn casi nunca tiene al día.
  if (profile.personal.headline !== undefined) {
    const same = draft?.personal.headline === profile.personal.headline;
    if (!same) {
      items.push({
        action: draft?.personal.headline === undefined ? 'add' : 'fix',
        kind: 'headline',
        title: draft?.personal.headline === undefined ? 'Poner tu titular' : `Cambiar el titular (LinkedIn dice «${draft.personal.headline}»)`,
        body: profile.personal.headline,
      });
    }
  }
  if (profile.personal.summary !== undefined && draft?.personal.summary === undefined) {
    const highlights = profile.achievements.map((achievement) => `• ${achievement.text}`);
    items.push({
      action: 'add',
      kind: 'about',
      title: 'Rellenar «Acerca de» con tu resumen y tus logros transversales',
      body: [profile.personal.summary, ...highlights].join('\n\n'),
    });
  }
  // 2. Experiencia y formación: lo que no está, y lo que está y no dice lo mismo.
  for (const entry of mine) {
    const other = pairs.get(entry.id);
    if (other === undefined) {
      const experience = entry.section === 'experience' ? experienceOf(profile, entry.id) : undefined;
      const project = entry.section === 'projects' ? profile.projects.find((item) => item.id === entry.id) : undefined;
      const education = entry.section === 'education' ? profile.education.find((item) => item.id === entry.id) : undefined;
      items.push({
        action: 'add',
        kind: kindOf(entry.section),
        title: `${entry.title} · ${period(entry)}`,
        ...(experience === undefined ? {} : { body: bodyOf(experience) }),
        ...(project === undefined ? {} : { body: bodyOf(project) }),
        ...(education === undefined ? {} : { title: `${educationLabel(education)} · ${period(entry)}` }),
      });
      continue;
    }
    if (other.title !== entry.title) {
      items.push({ action: 'fix', kind: kindOf(entry.section), title: `«${other.title}» → «${entry.title}»`, reason: 'Tus fuentes son la referencia.' });
    }
    if (other.start !== entry.start || other.end !== entry.end) {
      items.push({ action: 'fix', kind: kindOf(entry.section), title: `${entry.title}: ${period(other)} → ${period(entry)}`, reason: 'Tus fuentes son la referencia.' });
    }
  }
  // 3. Lo que LinkedIn trae y tus fuentes no: no se copia a ciegas, se revisa.
  for (const entry of theirs) {
    if (!paired.has(entry)) {
      items.push({ action: 'pending', kind: kindOf(entry.section), title: `LinkedIn tiene «${entry.title}» (${period(entry)}) y tus fuentes no`, reason: 'Revísalo: o le falta a tu perfil, o sobra en LinkedIn.' });
    }
  }
  // 4. Habilidades e idiomas, en un solo apunte cada uno: son listas, no entradas.
  const skills = missingSkills(profile, draft);
  if (skills.length > 0) {
    items.push({
      action: 'add',
      kind: 'skills',
      title: `${skills.length.toString()} aptitudes que tienes y LinkedIn no`,
      body: skills.join(' · '),
      reason: 'LinkedIn destaca las tres primeras: pon delante las que quieras que se lean.',
    });
  }
  const languages = profile.languages.filter((language) => !(draft?.languages ?? []).some((other) => other.name.toLowerCase() === language.name.toLowerCase()));
  if (languages.length > 0) {
    items.push({ action: 'add', kind: 'languages', title: 'Idiomas', body: languages.map((language) => `${language.name} (${language.level})`).join(' · ') });
  }
  items.push(...pendingItems(profile));
  const counts = { add: items.filter((item) => item.action === 'add').length, fix: items.filter((item) => item.action === 'fix').length, pending: items.filter((item) => item.action === 'pending').length };
  return { ok: true, plan: { ...(request.draft === undefined ? {} : { draft: request.draft }), items, counts } };
}
