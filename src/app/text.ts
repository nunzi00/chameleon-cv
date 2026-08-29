import type { MasterProfile } from '../core/schema';
import type { DatasetError } from '../parsers';

/** `ruta/fichero.md:línea: mensaje` (sin línea cuando no se conoce). */
export function formatDatasetError(error: DatasetError): string {
  return error.line === undefined ? `${error.file}: ${error.message}` : `${error.file}:${error.line}: ${error.message}`;
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Resumen de una línea del contenido de un perfil. */
export function profileSummary(profile: MasterProfile): string {
  return [
    pluralize(profile.specialties.length, 'especialidad', 'especialidades'),
    pluralize(profile.experience.length, 'experiencia', 'experiencias'),
    pluralize(profile.projects.length, 'proyecto', 'proyectos'),
    pluralize(profile.education.length, 'formación', 'formaciones'),
    pluralize(profile.skills.length, 'skill', 'skills'),
    pluralize(profile.certifications.length, 'certificación', 'certificaciones'),
    pluralize(profile.achievements.length, 'logro transversal', 'logros transversales'),
    pluralize(profile.languages.length, 'idioma', 'idiomas'),
  ].join(', ');
}
