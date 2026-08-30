/**
 * Modelo de vista del CV (`docs/selector-engine.md` §5.1): función pura que ordena, agrupa
 * y formatea un `MasterProfile` para que la plantilla no contenga lógica.
 */
import {
  SkillCategorySchema,
  type Achievement,
  type Certification,
  type Education,
  type Experience,
  type Language,
  type MasterProfile,
  type Personal,
  type Project,
  type Skill,
  type SkillCategory,
} from '../../core/schema';
import { byDateDescending, chronological, formatDate, formatPeriod, joinParts } from './format';
import { labelsFor, type Labels } from './labels';

export interface AchievementView {
  readonly id: string;
  readonly text: string;
  readonly impact: string | undefined;
}

export interface ExperienceView {
  readonly id: string;
  readonly role: string;
  readonly company: string;
  readonly location: string | undefined;
  readonly period: string;
  /** Fechas ISO del perfil (`YYYY`, `YYYY-MM` o `YYYY-MM-DD`) para ordenar cronologías (T-8.12); `end` ausente = actualidad. */
  readonly start: string;
  readonly end: string | undefined;
  readonly summary: string | undefined;
  readonly achievements: readonly AchievementView[];
  /** Tecnologías unidas por «, »; cadena vacía si no hay. */
  readonly technologies: string;
}

export interface ProjectView {
  readonly id: string;
  readonly name: string;
  readonly role: string | undefined;
  /** Periodo y URL unidos por « · »; cadena vacía si no hay. */
  readonly meta: string;
  readonly start: string | undefined;
  readonly end: string | undefined;
  readonly summary: string | undefined;
  readonly achievements: readonly AchievementView[];
  readonly technologies: string;
}

export interface SkillView {
  readonly id: string;
  readonly name: string;
  readonly level: string | undefined;
  readonly years: number | undefined;
}

export interface SkillGroupView {
  readonly category: SkillCategory;
  readonly label: string;
  /** Nombres unidos por «, ». */
  readonly names: string;
  readonly skills: readonly SkillView[];
}

export interface EducationView {
  readonly id: string;
  readonly degree: string;
  readonly field: string | undefined;
  readonly institution: string;
  readonly period: string;
  readonly start: string | undefined;
  readonly end: string | undefined;
}

export interface CertificationView {
  readonly id: string;
  readonly name: string;
  readonly issuer: string | undefined;
  readonly date: string;
  /** La fecha ISO tal como está en el perfil, si la hay. */
  readonly dateIso: string | undefined;
  readonly url: string | undefined;
}

export interface LanguageView {
  readonly name: string;
  readonly level: string;
}

export interface CvView {
  readonly locale: string;
  readonly labels: Labels;
  readonly fullName: string;
  readonly headline: string | undefined;
  /** Línea de contacto ya compuesta; cadena vacía si no hay datos. */
  readonly contact: string;
  readonly summary: string | undefined;
  readonly experience: readonly ExperienceView[];
  readonly projects: readonly ProjectView[];
  readonly skillGroups: readonly SkillGroupView[];
  readonly achievements: readonly AchievementView[];
  readonly education: readonly EducationView[];
  readonly certifications: readonly CertificationView[];
  readonly languages: readonly LanguageView[];
}

function achievementView(achievement: Achievement): AchievementView {
  return { id: achievement.id, text: achievement.text, impact: achievement.impact };
}

export function contactLine(personal: Personal): string {
  const location = personal.location === undefined ? undefined : joinParts([personal.location.city, personal.location.country]).replace(' · ', ', ');
  return joinParts([location, personal.email, personal.phone, ...personal.links.map((link) => `[${link.label}](${link.url})`)]);
}

function experienceView(experience: Experience, locale: string, labels: Labels): ExperienceView {
  return {
    id: experience.id,
    role: experience.role,
    company: experience.company,
    location: experience.location,
    period: formatPeriod(experience.dates, locale, labels.present),
    start: experience.dates.start,
    end: experience.dates.end,
    summary: experience.summary,
    achievements: experience.achievements.map(achievementView),
    technologies: experience.technologies.join(', '),
  };
}

function projectView(project: Project, locale: string, labels: Labels): ProjectView {
  return {
    id: project.id,
    name: project.name,
    role: project.role,
    meta: joinParts([project.dates === undefined ? undefined : formatPeriod(project.dates, locale, labels.present), project.url]),
    start: project.dates?.start,
    end: project.dates?.end,
    summary: project.summary,
    achievements: project.achievements.map(achievementView),
    technologies: project.technologies.join(', '),
  };
}

export function skillGroups(skills: readonly Skill[], labels: Labels): SkillGroupView[] {
  return SkillCategorySchema.options.flatMap((category) => {
    const members = skills.filter((skill) => skill.category === category);
    if (members.length === 0) {
      return [];
    }
    return [
      {
        category,
        label: labels.categories[category],
        names: members.map((skill) => skill.name).join(', '),
        skills: members.map((skill) => ({ id: skill.id, name: skill.name, level: skill.level, years: skill.years })),
      },
    ];
  });
}

function educationView(education: Education, locale: string, labels: Labels): EducationView {
  return {
    id: education.id,
    degree: education.degree,
    field: education.field,
    institution: education.institution,
    period: education.dates === undefined ? '' : formatPeriod(education.dates, locale, labels.present),
    start: education.dates?.start,
    end: education.dates?.end,
  };
}

function certificationView(certification: Certification, locale: string): CertificationView {
  return {
    id: certification.id,
    name: certification.name,
    issuer: certification.issuer,
    date: certification.date === undefined ? '' : formatDate(certification.date, locale),
    dateIso: certification.date,
    url: certification.url,
  };
}

function languageView(language: Language, labels: Labels): LanguageView {
  return { name: language.name, level: language.level === 'native' ? labels.native : language.level };
}

/** Construye el modelo de vista. Puro: no muta el perfil. */
export function buildCvView(profile: MasterProfile, locale: string): CvView {
  const labels = labelsFor(locale);
  return {
    locale,
    labels,
    fullName: profile.personal.fullName,
    headline: profile.personal.headline,
    contact: contactLine(profile.personal),
    summary: profile.personal.summary,
    experience: chronological(profile.experience).map((experience) => experienceView(experience, locale, labels)),
    projects: chronological(profile.projects).map((project) => projectView(project, locale, labels)),
    skillGroups: skillGroups(profile.skills, labels),
    achievements: profile.achievements.map(achievementView),
    education: chronological(profile.education).map((education) => educationView(education, locale, labels)),
    certifications: byDateDescending(profile.certifications).map((certification) => certificationView(certification, locale)),
    languages: profile.languages.map((language) => languageView(language, labels)),
  };
}
