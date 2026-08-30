/**
 * P2 · Parte pura del estructurador con el co-piloto local (T-8.4, docs/pdf-import-spike.md §4.2): el esquema JSON que
 * guía la respuesta, el prompt y la **verificación por código** de lo que devuelve el modelo: todo texto que no esté en
 * el CV se descarta y se cuenta como inventado; las fechas se normalizan al formato del esquema. La llamada al modelo
 * está en `model.ts`.
 */
import { z } from 'zod';

import { splitImpact, type DraftAchievement, type DraftEntry, type DraftProfile, type Provenance } from './structure';
import { parsePoint } from './dates';
import { alphanumeric, normalize } from './text';

const short = z.string().max(300).nullable();
const AchievementSchema = z.strictObject({ text: z.string().max(600), impact: z.string().max(160).nullable() });
const EntrySchema = z.strictObject({
  title: z.string().max(300),
  subtitle: short,
  location: short,
  start: z.string().max(40).nullable(),
  end: z.string().max(40).nullable(),
  current: z.boolean().nullable(),
  date: z.string().max(40).nullable(),
  url: short,
  summary: z.string().max(3000).nullable(),
  technologies: z.array(z.string().max(60)).max(60),
  achievements: z.array(AchievementSchema).max(40),
});
/**
 * Esquema v2: todas las claves son obligatorias (`null` cuando el CV no tiene el dato). Con claves opcionales (v1) el
 * modelo omitía la cabecera entera y las fechas en la mayoría de los PDF; obligarle a decidir campo a campo es lo que
 * hacen las tareas del producto.
 */
export const ModelDraftSchema = z.strictObject({
  fullName: short,
  headline: short,
  email: short,
  phone: short,
  location: short,
  links: z.array(z.string().max(300)).max(20),
  summary: z.string().max(3000).nullable(),
  experience: z.array(EntrySchema).max(30),
  projects: z.array(EntrySchema).max(30),
  education: z.array(EntrySchema).max(20),
  certifications: z.array(EntrySchema).max(30),
  skills: z.array(z.strictObject({ category: short, names: z.array(z.string().max(80)).max(60) })).max(20),
  achievements: z.array(AchievementSchema).max(40),
  languages: z.array(z.strictObject({ name: z.string().max(300), level: short })).max(20),
});
export type ModelDraft = z.output<typeof ModelDraftSchema>;

export const MODEL_PROMPT_VERSION = 'structure-cv.v2';
export const MODEL_LIMITS = { maxTokens: 6000, maxTextChars: 24_000, timeoutMs: 15 * 60 * 1000 } as const;

export function modelJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ModelDraftSchema) as Record<string, unknown>;
}

export const SYSTEM_PROMPT = [
  'Eres un extractor de currículums. Recibes el texto plano de un CV (extraído de un PDF) y devuelves SOLO un objeto JSON con el esquema indicado.',
  'Rellena TODAS las claves del esquema: usa null (o una lista vacía) cuando el CV no tenga el dato. Empieza por la cabecera: fullName, headline, email, phone, location, links y summary están casi siempre en las primeras líneas.',
  'Reglas: copia cada texto LITERALMENTE del CV (mismo idioma, misma ortografía); no inventes, no resumas, no traduzcas ni completes datos que no estén.',
  '`experience` son los puestos de trabajo (title = puesto, subtitle = empresa), `projects` los proyectos (title = nombre, subtitle = rol),',
  '`education` la formación (title = título, subtitle = centro), `certifications` las certificaciones (title = nombre, subtitle = emisor, date = fecha).',
  'Fechas en formato AAAA-MM o AAAA (o AAAA-MM-DD si el CV da el día); `current` = true si el puesto sigue vigente («actualidad», «present»), si no, false.',
  'Los `achievements` de cada puesto o proyecto son TODAS sus viñetas o frases de logro, una por elemento, con el texto íntegro; `impact` es solo la cifra o frase entre paréntesis al final, si la hay (si no, null).',
  'Las `technologies` son la lista que sigue a «Tecnologías:»/«Technologies:» de cada puesto. En `skills`, una entrada por categoría del CV: category = la etiqueta («Lenguajes»), names = los nombres de esa categoría («PHP», «Python»), nunca las etiquetas como nombres.',
].join(' ');

/**
 * `true` si el valor aparece en el texto como palabra o secuencia completa (forma alfanumérica, con límites de palabra):
 * un «Go» dentro de «Pagos» o un «56» dentro de un teléfono no cuentan.
 */
export function present(text: string, value: string): boolean {
  const target = alphanumeric(value);
  if (target === '') {
    return false;
  }
  const words = normalize(text).replace(/[^a-z0-9]+/g, ' ').split(' ');
  const glued = words.join('');
  let offset = 0;
  const starts = new Set<number>();
  const ends = new Set<number>();
  for (const word of words) {
    starts.add(offset);
    offset += word.length;
    ends.add(offset);
  }
  let from = glued.indexOf(target);
  while (from !== -1) {
    if (starts.has(from) && ends.has(from + target.length)) {
      return true;
    }
    from = glued.indexOf(target, from + 1);
  }
  return false;
}

export interface Dropped {
  entries: number;
  achievements: number;
  fields: number;
}

const provenanceOf = (lines: readonly string[], value: string): Provenance => {
  const index = lines.findIndex((line) => present(line, value));
  return index === -1 ? { line: 0, text: value } : { line: index + 1, text: lines[index]! };
};

/** Fecha del modelo → formato del esquema (`AAAA`, `AAAA-MM`, `AAAA-MM-DD`); las formas con el mes en letras («mar 2022») pasan por el analizador de fechas del spike; lo que no cuadre se descarta. */
export function normalizeDate(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const match = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(value.trim());
  if (match === null) {
    return parsePoint(value);
  }
  const parts = [match[1]!, match[2], match[3]].filter((part): part is string => part !== undefined).map((part, index) => (index === 0 ? part : part.padStart(2, '0')));
  return parts.join('-');
}

/** Conserva solo lo que está en el texto del CV; devuelve el borrador verificado y lo descartado. */
export function verifyModelDraft(draft: ModelDraft, text: string): { readonly draft: DraftProfile; readonly dropped: Dropped } {
  const lines = text.split(/\r?\n/);
  const dropped: Dropped = { entries: 0, achievements: 0, fields: 0 };
  const keep = (value: string | null | undefined): string | undefined => {
    if (value === undefined || value === null || value.trim() === '') {
      return undefined;
    }
    if (present(text, value)) {
      return value.trim();
    }
    dropped.fields += 1;
    return undefined;
  };
  const keepAll = (values: readonly string[]): string[] => values.map(keep).filter((value): value is string => value !== undefined);
  const achievementsOf = (items: ReadonlyArray<{ text: string; impact: string | null }>): DraftAchievement[] =>
    items.flatMap((item) => {
      if (!present(text, item.text)) {
        dropped.achievements += 1;
        return [];
      }
      // El modelo suele dejar el impacto «(…)» dentro del texto: se separa por código, como hace P1.
      const split = item.impact === null ? splitImpact(item.text.trim()) : { text: item.text.trim(), impact: undefined };
      return [{ text: split.text, impact: keep(item.impact) ?? split.impact, provenance: provenanceOf(lines, item.text) }];
    });
  const entriesOf = (items: ReadonlyArray<z.output<typeof EntrySchema>>): DraftEntry[] =>
    items.flatMap((item) => {
      if (!present(text, item.title)) {
        dropped.entries += 1;
        return [];
      }
      return [
        {
          title: item.title.trim(),
          subtitle: keep(item.subtitle),
          location: keep(item.location),
          start: normalizeDate(item.start),
          end: normalizeDate(item.end),
          current: item.current === true || (item.start !== null && item.end === null && item.current !== false) ? true : (item.current ?? undefined),
          date: normalizeDate(item.date),
          url: keep(item.url),
          summary: keep(item.summary),
          technologies: keepAll(item.technologies),
          achievements: achievementsOf(item.achievements),
          provenance: provenanceOf(lines, item.title),
        },
      ];
    });
  const skills = draft.skills
    .map((group) => ({ category: group.category === null ? undefined : normalize(group.category), names: keepAll(group.names), provenance: provenanceOf(lines, group.names[0] ?? '') }))
    .filter((group) => group.names.length > 0);
  const languages = draft.languages.flatMap((language) => (present(text, language.name) ? [{ name: language.name.trim(), level: keep(language.level) }] : (dropped.fields += 1, [])));
  return {
    draft: {
      fullName: keep(draft.fullName),
      headline: keep(draft.headline),
      email: keep(draft.email),
      phone: keep(draft.phone),
      location: keep(draft.location),
      links: keepAll(draft.links),
      summary: keep(draft.summary),
      experience: entriesOf(draft.experience),
      projects: entriesOf(draft.projects),
      education: entriesOf(draft.education),
      certifications: entriesOf(draft.certifications),
      skills,
      achievements: achievementsOf(draft.achievements),
      languages,
      sections: [],
      unparsed: [],
    },
    dropped,
  };
}
