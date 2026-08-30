/**
 * La inversa de los parsers de Markdown (T-8.1, `docs/portability.md` §4.4): perfil → ficheros fuente
 * canónicos y deterministas, byte a byte reproducibles. Solo se escribe lo presente (ni opcionales
 * ausentes ni listas vacías), con las claves en el orden de `docs/formato-dataset.md` §8.1; el YAML lo
 * entrecomilla la misma biblioteca que lo lee, y se lee en esquema *failsafe* (todo texto), así que un
 * valor con aspecto de número o de fecha vuelve exactamente como se escribió.
 */
import { Document } from 'yaml';

import type { Achievement, Education, Experience, MasterProfile, Project, Specialty } from '../../core/schema';

export type EntitySection = 'specialties' | 'experience' | 'projects' | 'education';

/** Prefijo que el parser antepone al nombre del fichero cuando la entidad no lleva `id:` (`entities.ts`). */
const ID_PREFIXES: Readonly<Record<EntitySection, string | undefined>> = {
  specialties: undefined,
  experience: 'exp',
  projects: 'proj',
  education: 'edu',
};

/** Nombre de fichero de entidad admitido por el cargador (`layout.ts`), sin la extensión. */
const FILE_NAME = /^[a-z0-9][a-z0-9-]*$/;

export const ACHIEVEMENTS_HEADING = '## Logros';

type Scalar = string | number;
type ScalarRecord = Readonly<Record<string, Scalar | undefined>>;
type FrontmatterValue = Scalar | readonly Scalar[] | ScalarRecord | readonly ScalarRecord[] | undefined;

export interface SerializedEntity {
  /** Nombre del fichero (sin `.md`). */
  readonly fileName: string;
  readonly content: string;
  /** El id no se deriva del nombre y va explícito en el frontmatter. */
  readonly explicitId: boolean;
}

/**
 * El nombre de fichero de una entidad es su id sin el prefijo por defecto de la sección cuando lo que
 * queda es un nombre válido (`exp-acme` → `acme.md`, sin `id:`); si no, el id completo con `id:` explícito.
 * Las especialidades no llevan prefijo ni admiten `id:`: su nombre es el id.
 */
export function entityFileName(section: EntitySection, id: string): { readonly fileName: string; readonly explicitId: boolean } {
  const prefix = ID_PREFIXES[section];
  if (prefix === undefined) {
    return { fileName: id, explicitId: false };
  }
  const rest = id.startsWith(`${prefix}-`) ? id.slice(prefix.length + 1) : '';
  return FILE_NAME.test(rest) ? { fileName: rest, explicitId: false } : { fileName: id, explicitId: true };
}

export interface EntityNaming {
  readonly fileName: string;
  readonly explicitId: boolean;
}

/**
 * Nombres de fichero de todas las entidades de una sección: el de `entityFileName`, salvo colisión (`exp-acme`
 * y `acme` querrían ambos `acme.md`), en cuyo caso la entidad posterior recibe el primer sufijo libre
 * (`acme-2.md`, `acme-3.md`…) con `id:` explícito. Determinista para un mismo orden de entrada.
 */
export function assignFileNames(section: EntitySection, ids: readonly string[]): Map<string, EntityNaming> {
  const naming = new Map<string, EntityNaming>();
  const taken = new Set<string>();
  for (const id of ids) {
    const preferred = entityFileName(section, id);
    let chosen = preferred;
    for (let suffix = 2; taken.has(chosen.fileName); suffix += 1) {
      chosen = { fileName: `${preferred.fileName}-${suffix}`, explicitId: true };
    }
    taken.add(chosen.fileName);
    naming.set(id, chosen);
  }
  return naming;
}

function isList(value: FrontmatterValue): value is readonly Scalar[] | readonly ScalarRecord[] {
  return Array.isArray(value);
}

function compact(record: ScalarRecord): Record<string, Scalar> {
  const cleaned: Record<string, Scalar> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

/**
 * Bloque `---` de frontmatter con las entradas en el orden dado; se omiten los `undefined` y las listas
 * vacías. Listas de escalares en flujo (`tags: [php, c++]`), listas de objetos en bloque; sin plegar líneas.
 */
export function serializeFrontmatter(entries: ReadonlyArray<readonly [string, FrontmatterValue]>): string {
  const document = new Document({});
  for (const [key, value] of entries) {
    if (value === undefined || (isList(value) && value.length === 0)) {
      continue;
    }
    if (isList(value)) {
      const items: ReadonlyArray<Scalar | ScalarRecord> = value;
      const flow = items.every((item) => typeof item !== 'object');
      document.set(key, document.createNode(items.map((item) => (typeof item === 'object' ? compact(item) : item)), { flow }));
    } else if (typeof value === 'object') {
      document.set(key, compact(value));
    } else {
      document.set(key, value);
    }
  }
  const yaml = document.toString({ lineWidth: 0, defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN', flowCollectionPadding: false });
  return `---\n${yaml}---\n`;
}

/**
 * Por qué un logro no se puede escribir de forma que el parser lo lea igual: el texto va en una sola
 * línea (las continuaciones se unen con un espacio) y las `#etiquetas` finales se leen como etiquetas.
 */
export function achievementProblem(item: Pick<Achievement, 'text'>): string | undefined {
  if (/[\n\r]/.test(item.text)) {
    return 'el texto tiene saltos de línea y el parser los une con un espacio';
  }
  const trailing = /(?:^|\s)(#\S+)\s*$/.exec(item.text);
  return trailing === null ? undefined : `el texto termina en «${trailing[1]}», que el parser leería como etiqueta`;
}

/** Una viñeta `- texto #etiquetas` y su sublista de metadatos (`id` solo si no es el que derivaría el parser). */
export function achievementLines(item: Achievement, defaultId: string): string[] {
  const tags = item.tags.map((tag) => `#${tag}`).join(' ');
  const lines = [`- ${tags === '' ? item.text : `${item.text} ${tags}`}`];
  if (item.id !== defaultId) {
    lines.push(`  - id: ${item.id}`);
  }
  if (item.impact !== undefined) {
    lines.push(`  - impact: ${item.impact}`);
  }
  if (item.date !== undefined) {
    lines.push(`  - date: ${item.date}`);
  }
  return lines;
}

export function serializeAchievementList(items: readonly Achievement[], parentId: string): string {
  return `${items.flatMap((item, index) => achievementLines(item, `${parentId}-${index + 1}`)).join('\n')}\n`;
}

/** `achievements.md`: solo la lista (el parser rechaza frontmatter y secciones); los ids por defecto son `ach-<n>`. */
export function serializeAchievementsFile(items: readonly Achievement[]): string {
  return serializeAchievementList(items, 'ach');
}

function markdownFile(frontmatter: string, summary: string | undefined, achievements: string | undefined): string {
  let content = frontmatter;
  if (summary !== undefined) {
    content += `\n${summary}\n`;
  }
  if (achievements !== undefined) {
    content += `\n${ACHIEVEMENTS_HEADING}\n\n${achievements}`;
  }
  return content;
}

/** `profile.md`: claves planas (meta y personal), `location` como mapa, `links` y `languages` como listas; el resumen en el cuerpo. */
export function serializeProfileFile(profile: MasterProfile): string {
  const { meta, personal } = profile;
  const frontmatter = serializeFrontmatter([
    ['schemaVersion', meta.schemaVersion],
    ['locale', meta.locale],
    ['updatedAt', meta.updatedAt],
    ['fullName', personal.fullName],
    ['headline', personal.headline],
    ['email', personal.email],
    ['phone', personal.phone],
    ['location', personal.location],
    ['links', personal.links],
    ['languages', profile.languages],
  ]);
  return markdownFile(frontmatter, personal.summary, undefined);
}

export function serializeSpecialty(item: Specialty, naming: EntityNaming = entityFileName('specialties', item.id)): SerializedEntity {
  const { fileName, explicitId } = naming;
  const frontmatter = serializeFrontmatter([
    ['title', item.title],
    ['tags', item.tags],
  ]);
  return { fileName, explicitId, content: markdownFile(frontmatter, item.summary, undefined) };
}

function achievementsOf(items: readonly Achievement[], parentId: string): string | undefined {
  return items.length === 0 ? undefined : serializeAchievementList(items, parentId);
}

export function serializeExperience(item: Experience, naming: EntityNaming = entityFileName('experience', item.id)): SerializedEntity {
  const { fileName, explicitId } = naming;
  const frontmatter = serializeFrontmatter([
    ['id', explicitId ? item.id : undefined],
    ['company', item.company],
    ['role', item.role],
    ['location', item.location],
    ['start', item.dates.start],
    ['end', item.dates.end],
    ['tags', item.tags],
    ['technologies', item.technologies],
  ]);
  return { fileName, explicitId, content: markdownFile(frontmatter, item.summary, achievementsOf(item.achievements, item.id)) };
}

export function serializeProject(item: Project, naming: EntityNaming = entityFileName('projects', item.id)): SerializedEntity {
  const { fileName, explicitId } = naming;
  const frontmatter = serializeFrontmatter([
    ['id', explicitId ? item.id : undefined],
    ['name', item.name],
    ['role', item.role],
    ['url', item.url],
    ['start', item.dates?.start],
    ['end', item.dates?.end],
    ['tags', item.tags],
    ['technologies', item.technologies],
  ]);
  return { fileName, explicitId, content: markdownFile(frontmatter, item.summary, achievementsOf(item.achievements, item.id)) };
}

export function serializeEducation(item: Education, naming: EntityNaming = entityFileName('education', item.id)): SerializedEntity {
  const { fileName, explicitId } = naming;
  const frontmatter = serializeFrontmatter([
    ['id', explicitId ? item.id : undefined],
    ['institution', item.institution],
    ['degree', item.degree],
    ['field', item.field],
    ['start', item.dates?.start],
    ['end', item.dates?.end],
    ['tags', item.tags],
  ]);
  return { fileName, explicitId, content: markdownFile(frontmatter, item.summary, undefined) };
}
