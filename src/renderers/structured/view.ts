/**
 * `CvView` → `StructuredView`: mismas secciones y etiquetas, con el Markdown en línea (contacto,
 * resúmenes, logros) convertido en runs/bloques y el texto normalizado (tabuladores → espacio).
 * Serializable a JSON tal cual: es lo que recibe la plantilla Typst y lo que maqueta pdfkit.
 */
import type { MasterProfile } from '../../core/schema';
import type { Labels } from '../markdown/labels';
import { buildCvView, type AchievementView } from '../markdown/view';
import { blocks, inlineRuns, type Block, type Run } from './inline';

export interface StructuredAchievement {
  readonly runs: readonly Run[];
  readonly impact?: string;
  /** De dónde sale, cuando la organización del tema los consolida fuera de su entrada (T-9.26). */
  readonly source?: string;
}

export interface StructuredContainer {
  readonly summary: readonly Block[];
  readonly achievements: readonly StructuredAchievement[];
  readonly technologies: string;
}

export interface StructuredExperience extends StructuredContainer {
  readonly id: string;
  readonly role: string;
  readonly company: string;
  readonly period: string;
  /** Fechas ISO (`YYYY`, `YYYY-MM` o `YYYY-MM-DD`) para cronologías unificadas (T-8.12); sin `end` = actualidad. */
  readonly start: string;
  readonly end?: string;
  readonly location?: string;
}

export interface StructuredProject extends StructuredContainer {
  readonly id: string;
  readonly name: string;
  readonly role?: string;
  readonly meta: string;
  readonly start?: string;
  readonly end?: string;
}

export interface StructuredSkillItem {
  readonly name: string;
  /** Clave del nivel (`beginner` … `expert`); el nombre traducido está en `labels.levels`. */
  readonly level?: string;
  readonly years?: number;
}

export interface StructuredSkillGroup {
  readonly label: string;
  readonly names: string;
  /** Cada skill con su nivel y años, si constan (matrices de skills, T-8.12). */
  readonly items: readonly StructuredSkillItem[];
}

export interface StructuredEducation {
  readonly degree: string;
  readonly field?: string;
  readonly institution: string;
  readonly period: string;
  readonly start?: string;
  readonly end?: string;
}

export interface StructuredCertification {
  readonly name: string;
  readonly issuer?: string;
  readonly date: string;
  /** Fecha ISO del perfil, si la hay. */
  readonly dateIso?: string;
  readonly url?: string;
}

export interface StructuredLanguage {
  readonly name: string;
  readonly level: string;
}

export interface StructuredView {
  readonly locale: string;
  /** Código de idioma de dos letras (silabación, comillas). */
  readonly lang: string;
  readonly labels: Labels;
  readonly fullName: string;
  readonly headline?: string;
  readonly contact: readonly Run[];
  readonly summary: readonly Block[];
  readonly experience: readonly StructuredExperience[];
  readonly projects: readonly StructuredProject[];
  readonly skillGroups: readonly StructuredSkillGroup[];
  readonly achievements: readonly StructuredAchievement[];
  readonly education: readonly StructuredEducation[];
  readonly certifications: readonly StructuredCertification[];
  readonly languages: readonly StructuredLanguage[];
}

/** Un tabulador no tiene representación fiable en PDF: se normaliza a un espacio. */
export function normalizeText(text: string): string {
  return text.replace(/\t/g, ' ');
}

function normalizeRun(run: Run): Run {
  return { ...run, text: normalizeText(run.text) };
}

function runsOf(markdown: string): Run[] {
  return inlineRuns(markdown).map(normalizeRun);
}

function blocksOf(markdown: string | undefined): Block[] {
  return markdown === undefined ? [] : blocks(markdown).map((block) => ({ ...block, runs: block.runs.map(normalizeRun) }));
}

function achievement(view: AchievementView): StructuredAchievement {
  const runs = runsOf(view.text);
  return view.impact === undefined ? { runs } : { runs, impact: view.impact };
}

/** Copia solo las claves opcionales presentes (el JSON resultante no lleva `null`). */
function optional<K extends string>(key: K, value: string | undefined): { readonly [P in K]?: string } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]: string });
}

export function buildStructuredView(profile: MasterProfile, locale: string): StructuredView {
  const view = buildCvView(profile, locale);
  return {
    locale: view.locale,
    lang: view.locale.slice(0, 2).toLowerCase(),
    labels: view.labels,
    fullName: view.fullName,
    ...optional('headline', view.headline),
    contact: runsOf(view.contact),
    summary: blocksOf(view.summary),
    experience: view.experience.map((item) => ({
      id: item.id,
      role: item.role,
      company: item.company,
      period: item.period,
      start: item.start,
      ...optional('end', item.end),
      ...optional('location', item.location),
      summary: blocksOf(item.summary),
      achievements: item.achievements.map(achievement),
      technologies: item.technologies,
    })),
    projects: view.projects.map((item) => ({
      id: item.id,
      name: item.name,
      ...optional('role', item.role),
      meta: item.meta,
      ...optional('start', item.start),
      ...optional('end', item.end),
      summary: blocksOf(item.summary),
      achievements: item.achievements.map(achievement),
      technologies: item.technologies,
    })),
    skillGroups: view.skillGroups.map((group) => ({
      label: group.label,
      names: group.names,
      items: group.skills.map((skill) => ({ name: skill.name, ...optional('level', skill.level), ...(skill.years === undefined ? {} : { years: skill.years }) })),
    })),
    achievements: view.achievements.map(achievement),
    education: view.education.map((item) => ({
      degree: item.degree,
      ...optional('field', item.field),
      institution: item.institution,
      period: item.period,
      ...optional('start', item.start),
      ...optional('end', item.end),
    })),
    certifications: view.certifications.map((item) => ({
      name: item.name,
      ...optional('issuer', item.issuer),
      date: item.date,
      ...optional('dateIso', item.dateIso),
      ...optional('url', item.url),
    })),
    languages: view.languages.map((language) => ({ name: language.name, level: language.level })),
  };
}
