/**
 * Esquema de Datos Unificado de Chameleon CV (T-1.1).
 *
 * `MasterProfile` es el contrato central del sistema: toda la información de un
 * candidato, con independencia del formato de entrada (Markdown, CSV…) o de salida
 * (Markdown, PDF…). Los parsers producen un `MasterProfile`; los generadores lo
 * consumen; la selección y el scoring operan sobre sus ítems.
 *
 * Decisiones de diseño
 * --------------------
 * - Una sola fuente de verdad: el esquema se declara con zod y los tipos TypeScript se
 *   derivan de él, de modo que tipo y validación no pueden divergir.
 * - Todo lo que un CV puede mostrar u omitir es un ítem con `id` estable (único en todo
 *   el perfil) y `tags`. Las tags son el vocabulario de relevancia con el que se
 *   selecciona contenido por especialidad (Hito 1) y se puntúa contra una oferta (Hito 2).
 * - Una `Specialty` describe una «versión» del candidato: titular, resumen y tags que
 *   hacen relevante a un ítem. Regla de relevancia prevista: un ítem pertenece a la
 *   especialidad si comparte alguna tag con ella o lleva la tag `<specialty.id>`.
 * - Los logros (`Achievement`) viven dentro de cada experiencia o proyecto y, los
 *   transversales (premios, ponencias…), en `achievements` a nivel de perfil.
 * - Fechas ISO parciales (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`); un periodo sin `end` está en curso.
 * - Saneado en el borde: texto recortado, sin caracteres de control y con longitud
 *   máxima; tags y alias en minúsculas y sin duplicados; URLs solo http(s); objetos
 *   estrictos (una clave desconocida es un error, no se ignora en silencio).
 * - `meta.schemaVersion` permite migrar los datos cuando el esquema evolucione.
 */
import { z } from 'zod';

import { isOrderedRange, isValidIsoDate, MAX_YEAR, MIN_YEAR } from './dates';
import { formatPath, type SchemaPath } from './path';

// Mensajes de validación de zod en castellano (configuración global de la librería).
z.config(z.locales.es());

/* ───────────────────────────── primitivas de texto ───────────────────────────── */

/** Texto de una sola línea: ningún carácter de control (los saltos de línea lo son). */
const SINGLE_LINE_PATTERN = /^[^\p{Cc}]*$/u;

/** Texto multilínea: se admiten `\n`, `\r` y `\t`; ningún otro carácter de control. */
const MULTI_LINE_PATTERN = /^(?:[^\p{Cc}]|[\n\r\t])*$/u;

const CONTROL_CHARS_ERROR = 'No se admiten caracteres de control';

const shortText = (max: number) =>
  z.string().trim().min(1).max(max).regex(SINGLE_LINE_PATTERN, { error: CONTROL_CHARS_ERROR });

const longText = (max: number) =>
  z.string().trim().min(1).max(max).regex(MULTI_LINE_PATTERN, { error: CONTROL_CHARS_ERROR });

const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

/* ─────────────────────────── identificadores y tags ─────────────────────────── */

/** Identificador estable de un ítem: minúsculas, dígitos y guiones (`exp-acme-2021`). */
export const IdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, {
    error: 'Identificador inválido: usa minúsculas, dígitos y guiones (p. ej. "exp-acme-2021")',
  });

/** Etiqueta de relevancia, normalizada a minúsculas (`php`, `kubernetes`, `c++`, `.net`). */
export const TagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9.][a-z0-9.+#/-]*$/, {
    error: 'Etiqueta inválida: minúsculas, dígitos y los símbolos . + # / - (p. ej. "node.js", "c++")',
  });

/** Alias o palabra clave para el emparejamiento (`k8s`, `google cloud`); admite espacios. */
export const KeywordSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9.][a-z0-9 .+#/-]*$/, {
    error: 'Alias inválido: minúsculas, dígitos, espacios y los símbolos . + # / -',
  });

const TagListSchema = z.array(TagSchema).max(50).transform(unique).default([]);

/**
 * Tag reservada de anclaje (`#pin`, T-2.9, `docs/consolidacion.md` §4): el ítem es relevante
 * para toda especialidad y oferta, va primero y nunca se recorta. No puntúa ni entra en el
 * vocabulario, y una especialidad no puede usarla como id ni como tag.
 */
export const PIN_TAG = 'pin';

export function isPinned(tags: readonly string[]): boolean {
  return tags.includes(PIN_TAG);
}
const KeywordListSchema = z.array(KeywordSchema).max(50).transform(unique).default([]);

/** Nombres de tecnologías tal y como deben mostrarse (`PHP 8.3`, `Kubernetes`). */
const TechnologyListSchema = z.array(shortText(60)).max(60).transform(unique).default([]);

/* ────────────────────────────────── fechas ────────────────────────────────── */

/** Fecha ISO parcial (`YYYY`, `YYYY-MM` o `YYYY-MM-DD`) válida en el calendario. */
export const IsoDateSchema = z.string().trim().refine(isValidIsoDate, {
  error: `Fecha inválida: usa YYYY, YYYY-MM o YYYY-MM-DD con un valor existente (años ${MIN_YEAR}–${MAX_YEAR})`,
});

/** Periodo. Sin `end` significa «en curso». */
export const DateRangeSchema = z
  .strictObject({
    start: IsoDateSchema,
    end: IsoDateSchema.optional(),
  })
  .superRefine((range, ctx) => {
    if (
      range.end !== undefined &&
      isValidIsoDate(range.start) &&
      isValidIsoDate(range.end) &&
      !isOrderedRange(range.start, range.end)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['end'],
        message: 'La fecha de fin no puede ser anterior a la de inicio',
      });
    }
  });

/* ─────────────────────────────── contacto y enlaces ─────────────────────────────── */

/** URL pública; por seguridad solo se admiten los esquemas http y https. */
export const UrlSchema = z
  .string()
  .trim()
  .max(2048)
  .pipe(z.url({ protocol: /^https?$/, error: 'URL inválida: solo se admiten direcciones http(s)' }));

export const EmailSchema = z.email({ error: 'Email inválido' }).max(254);

export const PhoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 ().\/-]{5,30}$/, { error: 'Teléfono inválido: dígitos, espacios y los símbolos + ( ) . / -' });

/** Enlace público: GitHub, LinkedIn, web personal… */
export const LinkSchema = z.strictObject({
  label: shortText(60),
  url: UrlSchema,
});

export const LocationSchema = z.strictObject({
  city: shortText(80),
  region: shortText(80).optional(),
  country: shortText(80).optional(),
});

/* ───────────────────────────────── secciones ───────────────────────────────── */

/** Datos personales. `headline` y `summary` son los valores por defecto cuando la especialidad no los define. */
export const PersonalSchema = z.strictObject({
  fullName: shortText(120),
  headline: shortText(160).optional(),
  summary: longText(3000).optional(),
  email: EmailSchema.optional(),
  phone: PhoneSchema.optional(),
  location: LocationSchema.optional(),
  links: z.array(LinkSchema).max(20).default([]),
});

/** Logro: un punto del CV seleccionable y puntuable de forma independiente. */
export const AchievementSchema = z.strictObject({
  id: IdSchema,
  /** Enunciado del logro; se admite Markdown en línea. */
  text: longText(600),
  /** Impacto cuantificado, p. ej. «-40 % de latencia p95». */
  impact: shortText(160).optional(),
  date: IsoDateSchema.optional(),
  tags: TagListSchema,
});

export const ExperienceSchema = z.strictObject({
  id: IdSchema,
  company: shortText(160),
  role: shortText(160),
  location: shortText(120).optional(),
  dates: DateRangeSchema,
  summary: longText(3000).optional(),
  technologies: TechnologyListSchema,
  achievements: z.array(AchievementSchema).max(100).default([]),
  tags: TagListSchema,
});

export const ProjectSchema = z.strictObject({
  id: IdSchema,
  name: shortText(160),
  role: shortText(160).optional(),
  url: UrlSchema.optional(),
  dates: DateRangeSchema.optional(),
  summary: longText(3000).optional(),
  technologies: TechnologyListSchema,
  achievements: z.array(AchievementSchema).max(100).default([]),
  tags: TagListSchema,
});

export const EducationSchema = z.strictObject({
  id: IdSchema,
  institution: shortText(160),
  degree: shortText(160),
  field: shortText(160).optional(),
  dates: DateRangeSchema.optional(),
  summary: longText(3000).optional(),
  tags: TagListSchema,
});

export const CertificationSchema = z.strictObject({
  id: IdSchema,
  name: shortText(160),
  issuer: shortText(160).optional(),
  date: IsoDateSchema.optional(),
  url: UrlSchema.optional(),
  tags: TagListSchema,
});

export const SkillCategorySchema = z.enum([
  'language',
  'framework',
  'library',
  'tool',
  'platform',
  'database',
  'cloud',
  'methodology',
  'domain',
  'soft',
  'other',
]);

export const SkillLevelSchema = z.enum(['beginner', 'intermediate', 'advanced', 'expert']);

export const SkillSchema = z.strictObject({
  id: IdSchema,
  name: shortText(80),
  category: SkillCategorySchema.default('other'),
  level: SkillLevelSchema.optional(),
  /** Años de experiencia con la skill. */
  years: z.number().int().min(0).max(60).optional(),
  /** Sinónimos que deben reconocerse como esta skill (`k8s` → Kubernetes). */
  aliases: KeywordListSchema,
  tags: TagListSchema,
});

/** Nivel de idioma según el MCER, o nativo. */
export const LanguageLevelSchema = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native']);

export const LanguageSchema = z.strictObject({
  name: shortText(60),
  level: LanguageLevelSchema,
});

/** «Versión» del candidato para un tipo de puesto: titular, resumen y vocabulario de relevancia. */
export const SpecialtySchema = z.strictObject({
  id: IdSchema,
  /** Titular del CV para esta especialidad, p. ej. «Senior Backend Engineer». */
  title: shortText(160),
  summary: longText(3000).optional(),
  /** Tags que hacen relevante a un ítem para esta especialidad. */
  tags: TagListSchema,
});

/** Versión del esquema que entiende esta versión de Chameleon CV. */
export const MASTER_PROFILE_SCHEMA_VERSION = 1;

export const MetaSchema = z
  .strictObject({
    schemaVersion: z.literal(MASTER_PROFILE_SCHEMA_VERSION, {
      error: `Versión de esquema no soportada: esta versión de Chameleon CV entiende la ${MASTER_PROFILE_SCHEMA_VERSION}`,
    }),
    /** Idioma del contenido, en formato BCP-47 corto (`es-ES`, `en`). */
    locale: z
      .string()
      .trim()
      .regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/, { error: 'Locale inválido: usa formato BCP-47 corto, p. ej. "es-ES"' })
      .optional(),
    updatedAt: IsoDateSchema.optional(),
  })
  .default({ schemaVersion: MASTER_PROFILE_SCHEMA_VERSION });

/* ─────────────────────────────── MasterProfile ─────────────────────────────── */

const MasterProfileShape = z.strictObject({
  meta: MetaSchema,
  personal: PersonalSchema,
  specialties: z.array(SpecialtySchema).max(50).default([]),
  experience: z.array(ExperienceSchema).max(100).default([]),
  projects: z.array(ProjectSchema).max(200).default([]),
  education: z.array(EducationSchema).max(50).default([]),
  skills: z.array(SkillSchema).max(500).default([]),
  /** Logros transversales, no ligados a una experiencia o proyecto concretos. */
  achievements: z.array(AchievementSchema).max(200).default([]),
  certifications: z.array(CertificationSchema).max(100).default([]),
  languages: z.array(LanguageSchema).max(20).default([]),
});

/** Esquema completo: forma estricta + unicidad de identificadores en todo el perfil. */
export const MasterProfileSchema = MasterProfileShape.superRefine((profile, ctx) => {
  for (const duplicate of findDuplicateIds(profile)) {
    ctx.addIssue({
      code: 'custom',
      path: [...duplicate.path],
      message: `Identificador duplicado "${duplicate.id}": ya se usa en ${formatPath(duplicate.firstPath)}`,
    });
  }
  profile.specialties.forEach((specialty, index) => {
    if (specialty.id === PIN_TAG) {
      ctx.addIssue({
        code: 'custom',
        path: ['specialties', index, 'id'],
        message: `"${PIN_TAG}" está reservado: es la tag de anclaje (#pin) y no puede ser el id de una especialidad`,
      });
    }
    const pinIndex = specialty.tags.indexOf(PIN_TAG);
    if (pinIndex !== -1) {
      ctx.addIssue({
        code: 'custom',
        path: ['specialties', index, 'tags', pinIndex],
        message: `"${PIN_TAG}" está reservado: es la tag de anclaje (#pin) y no forma parte del vocabulario de una especialidad`,
      });
    }
  });
});

/* ───────────────────────────── unicidad de ids ───────────────────────────── */

/** Aparición de un `id` en el perfil y la ruta donde está. */
export interface IdOccurrence {
  readonly id: string;
  readonly path: SchemaPath;
}

/** Aparición repetida de un `id`, con la ruta de la primera aparición. */
export interface DuplicateId extends IdOccurrence {
  readonly firstPath: SchemaPath;
}

interface Identified {
  readonly id: string;
  readonly achievements?: ReadonlyArray<{ readonly id: string }>;
}

/** Recorre el perfil en orden de documento y devuelve cada `id` con su ruta. */
export function collectIds(profile: MasterProfile): IdOccurrence[] {
  const found: IdOccurrence[] = [];
  const collect = (collection: string, items: ReadonlyArray<Identified>): void => {
    items.forEach((item, index) => {
      found.push({ id: item.id, path: [collection, index, 'id'] });
      item.achievements?.forEach((achievement, achievementIndex) => {
        found.push({ id: achievement.id, path: [collection, index, 'achievements', achievementIndex, 'id'] });
      });
    });
  };
  collect('specialties', profile.specialties);
  collect('experience', profile.experience);
  collect('projects', profile.projects);
  collect('education', profile.education);
  collect('skills', profile.skills);
  collect('achievements', profile.achievements);
  collect('certifications', profile.certifications);
  return found;
}

/** Devuelve las apariciones de `id` que repiten uno ya usado antes en el perfil. */
export function findDuplicateIds(profile: MasterProfile): DuplicateId[] {
  const firstSeen = new Map<string, SchemaPath>();
  const duplicates: DuplicateId[] = [];
  for (const { id, path } of collectIds(profile)) {
    const firstPath = firstSeen.get(id);
    if (firstPath === undefined) {
      firstSeen.set(id, path);
    } else {
      duplicates.push({ id, path, firstPath });
    }
  }
  return duplicates;
}

/* ─────────────────────────────────── tipos ─────────────────────────────────── */

export type Id = z.output<typeof IdSchema>;
export type Tag = z.output<typeof TagSchema>;
export type DateRange = z.output<typeof DateRangeSchema>;
export type Link = z.output<typeof LinkSchema>;
export type Location = z.output<typeof LocationSchema>;
export type Personal = z.output<typeof PersonalSchema>;
export type Achievement = z.output<typeof AchievementSchema>;
export type Experience = z.output<typeof ExperienceSchema>;
export type Project = z.output<typeof ProjectSchema>;
export type Education = z.output<typeof EducationSchema>;
export type Certification = z.output<typeof CertificationSchema>;
export type SkillCategory = z.output<typeof SkillCategorySchema>;
export type SkillLevel = z.output<typeof SkillLevelSchema>;
export type Skill = z.output<typeof SkillSchema>;
export type LanguageLevel = z.output<typeof LanguageLevelSchema>;
export type Language = z.output<typeof LanguageSchema>;
export type Specialty = z.output<typeof SpecialtySchema>;
export type Meta = z.output<typeof MetaSchema>;

/** Perfil canónico y saneado: el contrato que consumen generadores, selección y scoring. */
export type MasterProfile = z.output<typeof MasterProfileShape>;

/** Forma que aceptan los parsers antes de validar: secciones opcionales, sin normalizar. */
export type MasterProfileInput = z.input<typeof MasterProfileShape>;
