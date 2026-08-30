/**
 * Títulos de sección de un CV en español e inglés (T-8.4b, docs/cv-import.md §2): un diccionario cerrado con
 * variantes; una línea es título si, normalizada (sin numeración, dos puntos ni espaciado entre letras), coincide
 * con una entrada. Origen: el spike T-8.4, medido en docs/pdf-import-spike.md.
 */
import { normalize } from './text';

export type SectionKind = 'summary' | 'experience' | 'projects' | 'education' | 'skills' | 'achievements' | 'certifications' | 'languages' | 'contact';

const HEADINGS: ReadonlyArray<readonly [SectionKind, readonly string[]]> = [
  ['summary', ['resumen', 'resumen profesional', 'perfil', 'perfil profesional', 'sobre mi', 'acerca de mi', 'summary', 'professional summary', 'profile', 'about', 'about me', 'objective']],
  ['experience', ['experiencia', 'experiencia profesional', 'experiencia laboral', 'trayectoria', 'trayectoria profesional', 'historial laboral', 'experience', 'work experience', 'professional experience', 'employment', 'employment history', 'career']],
  ['projects', ['proyectos', 'proyectos destacados', 'projects', 'selected projects', 'personal projects', 'open source']],
  ['education', ['formacion', 'formacion academica', 'educacion', 'estudios', 'education', 'academic background', 'studies']],
  ['skills', ['habilidades', 'competencias', 'competencias tecnicas', 'conocimientos', 'tecnologias', 'skills', 'technical skills', 'core skills', 'technologies', 'tech stack', 'stack']],
  ['achievements', ['logros', 'logros destacados', 'hitos', 'highlights', 'key achievements', 'achievements', 'accomplishments']],
  ['certifications', ['certificaciones', 'certificados', 'certifications', 'certificates', 'licenses & certifications', 'licenses and certifications']],
  ['languages', ['idiomas', 'languages']],
  ['contact', ['contacto', 'contact', 'datos de contacto']],
];

const LOOKUP: ReadonlyMap<string, SectionKind> = new Map(HEADINGS.flatMap(([kind, names]) => names.map((name): [string, SectionKind] => [name, kind])));
/** Sin espacios: el kerning de algunos PDF parte una letra («L anguages»). */
const SPACELESS: ReadonlyMap<string, SectionKind> = new Map(HEADINGS.flatMap(([kind, names]) => names.map((name): [string, SectionKind] => [name.replace(/[\s&]/g, ''), kind])));

/** Quita numeración («1  Experiencia», «2. Proyectos»), dos puntos finales y el espaciado entre letras («E X P E R I E N C I A»). */
export function headingKey(line: string): string {
  let text = normalize(line)
    .replace(/^[0-9]+[.)]?\s+/, '')
    .replace(/[:.]+$/, '')
    .trim();
  if (/^(?:[a-z0-9] )+[a-z0-9]$/.test(text)) {
    text = text.replace(/ /g, '');
  }
  return text;
}

/** La clase de sección si la línea es un título conocido; `undefined` si no lo es. */
export function detectHeading(line: string): SectionKind | undefined {
  const key = headingKey(line);
  if (key === '' || key.length > 40) {
    return undefined;
  }
  return LOOKUP.get(key) ?? SPACELESS.get(key.replace(/[\s&]/g, ''));
}

/** Categorías de habilidades («Lenguajes: PHP, Python») del esquema, con sus etiquetas en ambos idiomas. */
export const SKILL_CATEGORY_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['lenguajes', 'language'],
  ['languages', 'language'],
  ['programming languages', 'language'],
  ['frameworks', 'framework'],
  ['librerias', 'library'],
  ['libraries', 'library'],
  ['herramientas', 'tool'],
  ['tools', 'tool'],
  ['plataformas', 'platform'],
  ['platforms', 'platform'],
  ['bases de datos', 'database'],
  ['databases', 'database'],
  ['cloud', 'cloud'],
  ['metodologias', 'methodology'],
  ['methodologies', 'methodology'],
  ['dominio', 'domain'],
  ['domain', 'domain'],
  ['competencias', 'soft'],
  ['soft skills', 'soft'],
  ['otras', 'other'],
  ['other', 'other'],
];

export function skillCategory(label: string): string | undefined {
  const key = normalize(label).replace(/[:.]+$/, '').trim();
  return SKILL_CATEGORY_LABELS.find(([name]) => name === key)?.[1];
}
