/** El formulario de Generar → los cuerpos de POST /generate y POST /analyze-offer, con la validación que la API exigiría. */
import type { AnalyzeRequest, GenerateRequest, ProfileResponse } from '../api/types';

export type OfferMode = 'none' | 'text' | 'file';

export interface GenerateForm {
  readonly specialty: string;
  readonly offerMode: OfferMode;
  readonly offerText: string;
  /** Identificador de fichero del espacio de trabajo (`ofertas/acme.txt`). */
  readonly offerFile: string;
  readonly format: 'md' | 'pdf';
  readonly engine: 'pdfkit' | 'typst';
  readonly theme: string;
  readonly locale: string;
  readonly topN: string;
  readonly maxSkills: string;
  readonly maxProjects: string;
  readonly maxCertifications: string;
  /** Selección explícita de skills (nombres) y proyectos (ids); vacío = todas/todos. */
  skills: string[];
  projects: string[];
  readonly compact: boolean;
  /** Nombre del fichero en output/ (vacío = el de la CLI). */
  readonly output: string;
  readonly build: boolean;
}

export const EMPTY_FORM: GenerateForm = {
  specialty: '',
  offerMode: 'none',
  offerText: '',
  offerFile: '',
  format: 'pdf',
  engine: 'pdfkit',
  theme: '',
  locale: '',
  topN: '',
  maxSkills: '',
  maxProjects: '',
  maxCertifications: '',
  skills: [],
  projects: [],
  compact: false,
  output: '',
  build: false,
};

export type FormResult<T> = { readonly ok: true; readonly body: T } | { readonly ok: false; readonly message: string };

const OUTPUT_NAME = /^[\w.-]+$/;

/** Un entero opcional del formulario (vacío = sin valor). */
export function integerField(label: string, value: string): { readonly ok: true; readonly value: number | undefined } | { readonly ok: false; readonly message: string } {
  const clean = value.trim();
  if (clean === '') {
    return { ok: true, value: undefined };
  }
  const parsed = Number(clean);
  return /^\d+$/.test(clean) && Number.isSafeInteger(parsed) ? { ok: true, value: parsed } : { ok: false, message: `${label} debe ser un entero mayor o igual que 0` };
}

/** La oferta del formulario (modo, texto o fichero) como la espera la API; `undefined` sin oferta. */
export function offerOf(form: Pick<GenerateForm, 'offerMode' | 'offerText' | 'offerFile'>): FormResult<GenerateRequest['offer']> {
  if (form.offerMode === 'none') {
    return { ok: true, body: undefined };
  }
  if (form.offerMode === 'text') {
    const text = form.offerText.trim();
    return text === '' ? { ok: false, message: 'Pega el texto de la oferta (o sube su PDF)' } : { ok: true, body: { text } };
  }
  const workspaceFile = form.offerFile.trim();
  return workspaceFile === '' ? { ok: false, message: 'Indica el fichero de la oferta dentro del espacio de trabajo' } : { ok: true, body: { workspaceFile } };
}

export function buildGenerateRequest(form: GenerateForm): FormResult<GenerateRequest> {
  const offer = offerOf(form);
  if (!offer.ok) {
    return offer;
  }
  const limits = [
    ['Top N', form.topN],
    ['Skills', form.maxSkills],
    ['Proyectos', form.maxProjects],
    ['Certificaciones', form.maxCertifications],
  ] as const;
  const parsed: number[] = [];
  for (const [label, value] of limits) {
    const result = integerField(label, value);
    if (!result.ok) {
      return result;
    }
    parsed.push(result.value ?? -1);
  }
  const output = form.output.trim();
  if (output !== '' && !OUTPUT_NAME.test(output)) {
    return { ok: false, message: 'El nombre del fichero solo admite letras, números, «.», «-» y «_» (sin directorios)' };
  }
  const [topN = -1, maxSkills = -1, maxProjects = -1, maxCertifications = -1] = parsed;
  const pdf = form.format === 'pdf';
  const typst = pdf && form.engine === 'typst';
  const body: GenerateRequest = {
    ...(form.specialty === '' ? {} : { specialty: form.specialty }),
    ...(offer.body === undefined ? {} : { offer: offer.body }),
    format: form.format,
    ...(pdf ? { engine: form.engine } : {}),
    ...(typst && form.theme !== '' ? { theme: form.theme } : {}),
    ...(form.locale.trim() === '' ? {} : { locale: form.locale.trim() }),
    ...(output === '' ? {} : { output }),
    ...(form.build ? { build: true } : {}),
    ...(topN >= 0 ? { topN } : {}),
    ...(maxSkills >= 0 ? { maxSkills } : {}),
    ...(maxProjects >= 0 ? { maxProjects } : {}),
    ...(maxCertifications >= 0 ? { maxCertifications } : {}),
    ...(form.skills.length > 0 ? { skills: [...form.skills] } : {}),
    ...(form.projects.length > 0 ? { projects: [...form.projects] } : {}),
    ...(form.compact ? { compact: true } : {}),
  };
  return { ok: true, body };
}

export function buildAnalyzeRequest(form: GenerateForm): FormResult<AnalyzeRequest> {
  const offer = offerOf(form);
  if (!offer.ok) {
    return offer;
  }
  if (offer.body === undefined) {
    return { ok: false, message: 'Para analizar hace falta una oferta: pega su texto, sube su PDF o indica su fichero' };
  }
  return { ok: true, body: { offer: offer.body, ...(form.specialty === '' ? {} : { specialty: form.specialty }), ...(form.build ? { build: true } : {}) } };
}

export interface SkillGroup {
  readonly category: string;
  readonly names: readonly string[];
}

/** Skills del perfil agrupadas por categoría (en el orden del perfil) para el selector múltiple. */
export function skillGroups(profile: ProfileResponse | undefined): SkillGroup[] {
  const groups = new Map<string, string[]>();
  for (const skill of profile?.skills ?? []) {
    groups.set(skill.category, [...(groups.get(skill.category) ?? []), skill.name]);
  }
  return [...groups.entries()].map(([category, names]) => ({ category, names }));
}

/** Proyectos del perfil (id y nombre) para el selector múltiple. */
export function projectOptions(profile: ProfileResponse | undefined): Array<{ readonly id: string; readonly name: string }> {
  return (profile?.projects ?? []).map((project) => ({ id: project.id, name: project.name }));
}

export interface SpecialtyPreview {
  readonly headline: string;
  /** «14 logros etiquetados · 22 skills · 5 proyectos». */
  readonly summary: string;
}

/** Vista previa del paso 1: titular de la especialidad y qué parte del perfil la reconoce (por sus tags). */
export function specialtyPreview(profile: ProfileResponse | undefined, specialty: string): SpecialtyPreview | undefined {
  if (profile === undefined) {
    return undefined;
  }
  const skills = profile.skills.length;
  const projects = profile.projects.length;
  const achievements = [...profile.experience.flatMap((entry) => entry.achievements), ...profile.projects.flatMap((project) => project.achievements)];
  if (specialty === '') {
    return { headline: 'Todo el perfil, sin recortar', summary: `${achievements.length} logros · ${skills} skills · ${projects} proyectos` };
  }
  const found = profile.specialties.find((entry) => entry.id === specialty);
  if (found === undefined) {
    return undefined;
  }
  const tags = new Set(found.tags);
  const tagged = achievements.filter((achievement) => achievement.tags.some((tag) => tags.has(tag))).length;
  return { headline: found.title, summary: `${tagged} logros etiquetados · ${skills} skills · ${projects} proyectos` };
}
