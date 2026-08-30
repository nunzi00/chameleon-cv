/**
 * P2 · Parte pura del estructurador con el co-piloto local (T-8.4, docs/pdf-import-spike.md §4.2): el esquema JSON que
 * guía la respuesta, el prompt y la **verificación por código** de lo que devuelve el modelo: todo texto que no esté en
 * el CV se descarta y se cuenta como inventado; las fechas se normalizan al formato del esquema. La llamada al modelo
 * está en `model.ts`.
 */
import { z } from 'zod';

import type { DraftAchievement, DraftEntry, DraftProfile, Provenance } from './structure';
import { alphanumeric, normalize } from './text';

const short = z.string().max(300);
const AchievementSchema = z.strictObject({ text: z.string().max(600), impact: z.string().max(160).optional() });
const EntrySchema = z.strictObject({
  title: short,
  subtitle: short.optional(),
  location: short.optional(),
  start: z.string().max(12).optional(),
  end: z.string().max(12).optional(),
  current: z.boolean().optional(),
  date: z.string().max(12).optional(),
  url: short.optional(),
  summary: z.string().max(3000).optional(),
  technologies: z.array(z.string().max(60)).max(60).optional(),
  achievements: z.array(AchievementSchema).max(40).optional(),
});
export const ModelDraftSchema = z.strictObject({
  fullName: short.optional(),
  headline: short.optional(),
  email: short.optional(),
  phone: short.optional(),
  location: short.optional(),
  links: z.array(short).max(20).optional(),
  summary: z.string().max(3000).optional(),
  experience: z.array(EntrySchema).max(30).optional(),
  projects: z.array(EntrySchema).max(30).optional(),
  education: z.array(EntrySchema).max(20).optional(),
  certifications: z.array(EntrySchema).max(30).optional(),
  skills: z.array(z.strictObject({ category: short.optional(), names: z.array(z.string().max(80)).max(60) })).max(20).optional(),
  achievements: z.array(AchievementSchema).max(40).optional(),
  languages: z.array(z.strictObject({ name: short, level: short.optional() })).max(20).optional(),
});
export type ModelDraft = z.output<typeof ModelDraftSchema>;

export const MODEL_PROMPT_VERSION = 'structure-cv.v1';
export const MODEL_LIMITS = { maxTokens: 6000, maxTextChars: 24_000, timeoutMs: 15 * 60 * 1000 } as const;

export function modelJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ModelDraftSchema) as Record<string, unknown>;
}

export const SYSTEM_PROMPT = [
  'Eres un extractor de currículums. Recibes el texto plano de un CV (extraído de un PDF) y devuelves SOLO un objeto JSON con el esquema indicado.',
  'Reglas: copia cada texto LITERALMENTE del CV (mismo idioma, misma ortografía); no inventes, no resumas, no traduzcas ni completes datos que no estén.',
  'Si un dato no aparece, omite la clave. `experience` son los puestos de trabajo (title = puesto, subtitle = empresa), `projects` los proyectos (title = nombre, subtitle = rol),',
  '`education` la formación (title = título, subtitle = centro), `certifications` las certificaciones (title = nombre, subtitle = emisor, date = fecha).',
  'Fechas en formato AAAA-MM o AAAA (o AAAA-MM-DD si el CV da el día); `current` = true si el puesto sigue vigente («actualidad», «present»).',
  'Los `achievements` de cada puesto son sus viñetas o frases de logro, una por elemento, con el texto íntegro; `impact` es solo la cifra o frase entre paréntesis al final, si la hay.',
  'Las `technologies` son la lista que sigue a «Tecnologías:»/«Technologies:» de cada puesto. `skills` agrupa las habilidades por categoría tal como aparecen.',
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

/** Fecha del modelo → formato del esquema (`AAAA`, `AAAA-MM`, `AAAA-MM-DD`); lo que no cuadre se descarta. */
export function normalizeDate(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const match = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(value.trim());
  if (match === null) {
    return undefined;
  }
  const parts = [match[1]!, match[2], match[3]].filter((part): part is string => part !== undefined).map((part, index) => (index === 0 ? part : part.padStart(2, '0')));
  return parts.join('-');
}

/** Conserva solo lo que está en el texto del CV; devuelve el borrador verificado y lo descartado. */
export function verifyModelDraft(draft: ModelDraft, text: string): { readonly draft: DraftProfile; readonly dropped: Dropped } {
  const lines = text.split(/\r?\n/);
  const dropped: Dropped = { entries: 0, achievements: 0, fields: 0 };
  const keep = (value: string | undefined): string | undefined => {
    if (value === undefined || value.trim() === '') {
      return undefined;
    }
    if (present(text, value)) {
      return value.trim();
    }
    dropped.fields += 1;
    return undefined;
  };
  const keepAll = (values: readonly string[] | undefined): string[] => (values ?? []).map(keep).filter((value): value is string => value !== undefined);
  const achievementsOf = (items: ReadonlyArray<{ text: string; impact?: string | undefined }> | undefined): DraftAchievement[] =>
    (items ?? []).flatMap((item) => {
      if (!present(text, item.text)) {
        dropped.achievements += 1;
        return [];
      }
      return [{ text: item.text.trim(), impact: keep(item.impact), provenance: provenanceOf(lines, item.text) }];
    });
  const entriesOf = (items: ReadonlyArray<z.output<typeof EntrySchema>> | undefined): DraftEntry[] =>
    (items ?? []).flatMap((item) => {
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
          current: item.current === true || (item.start !== undefined && item.end === undefined && item.current !== false) ? true : item.current,
          date: normalizeDate(item.date),
          url: keep(item.url),
          summary: keep(item.summary),
          technologies: keepAll(item.technologies),
          achievements: achievementsOf(item.achievements),
          provenance: provenanceOf(lines, item.title),
        },
      ];
    });
  const skills = (draft.skills ?? [])
    .map((group) => ({ category: group.category === undefined ? undefined : normalize(group.category), names: keepAll(group.names), provenance: provenanceOf(lines, group.names[0] ?? '') }))
    .filter((group) => group.names.length > 0);
  const languages = (draft.languages ?? []).flatMap((language) => (present(text, language.name) ? [{ name: language.name.trim(), level: keep(language.level) }] : (dropped.fields += 1, [])));
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
