/**
 * Etiquetas de la plantilla por idioma (`docs/selector-engine.md` §5.1): una sola plantilla
 * sirve para todos los idiomas; los títulos de sección y palabras fijas salen de aquí.
 */
import type { SkillCategory, SkillLevel } from '../../core/schema';

export interface Labels {
  readonly experience: string;
  readonly projects: string;
  readonly skills: string;
  readonly achievements: string;
  readonly education: string;
  readonly certifications: string;
  readonly languages: string;
  readonly technologies: string;
  readonly link: string;
  /** Cabecera de la columna de contacto (temas con lateral) y pie «página X de Y». */
  readonly contact: string;
  readonly page: string;
  readonly of: string;
  readonly present: string;
  readonly native: string;
  readonly categories: Readonly<Record<SkillCategory, string>>;
  /** Matriz de skills (T-8.12): cabeceras «nivel» y «años» y el nombre de cada nivel. */
  readonly level: string;
  readonly years: string;
  readonly levels: Readonly<Record<SkillLevel, string>>;
}

const SPANISH: Labels = {
  experience: 'Experiencia',
  projects: 'Proyectos',
  skills: 'Habilidades',
  achievements: 'Logros destacados',
  education: 'Formación',
  certifications: 'Certificaciones',
  languages: 'Idiomas',
  technologies: 'Tecnologías',
  link: 'enlace',
  contact: 'Contacto',
  page: 'página',
  of: 'de',
  present: 'actualidad',
  native: 'nativo',
  categories: {
    language: 'Lenguajes',
    framework: 'Frameworks',
    library: 'Librerías',
    tool: 'Herramientas',
    platform: 'Plataformas',
    database: 'Bases de datos',
    cloud: 'Cloud',
    methodology: 'Metodologías',
    domain: 'Dominio',
    soft: 'Competencias',
    other: 'Otras',
  },
  level: 'Nivel',
  years: 'Años',
  levels: { beginner: 'Básico', intermediate: 'Intermedio', advanced: 'Avanzado', expert: 'Experto' },
};

const ENGLISH: Labels = {
  experience: 'Experience',
  projects: 'Projects',
  skills: 'Skills',
  achievements: 'Highlights',
  education: 'Education',
  certifications: 'Certifications',
  languages: 'Languages',
  technologies: 'Technologies',
  link: 'link',
  contact: 'Contact',
  page: 'page',
  of: 'of',
  present: 'present',
  native: 'native',
  categories: {
    language: 'Languages',
    framework: 'Frameworks',
    library: 'Libraries',
    tool: 'Tools',
    platform: 'Platforms',
    database: 'Databases',
    cloud: 'Cloud',
    methodology: 'Methodologies',
    domain: 'Domain',
    soft: 'Soft skills',
    other: 'Other',
  },
  level: 'Level',
  years: 'Years',
  levels: { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced', expert: 'Expert' },
};

/** Idioma del locale (`es-ES` → `es`). */
export function languageOf(locale: string): string {
  return locale.toLowerCase().replace(/[-_].*$/, '');
}

/** Castellano para `es*`; inglés como reserva para cualquier otro idioma. */
export function labelsFor(locale: string): Labels {
  return languageOf(locale) === 'es' ? SPANISH : ENGLISH;
}
