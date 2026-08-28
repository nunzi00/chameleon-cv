/**
 * Diccionario cerrado de etiquetas y verificación de sugerencias (T-4.6; canon C10: política
 * propia de la tarea `suggest tags`). «El perfil es el diccionario»: solo las tags que definen
 * las especialidades del usuario pueden sugerirse; cualquier otra se rechaza en código, sin
 * confiar en el modelo. La evidencia de cada etiqueta (literal en el texto, en el contexto del
 * contenedor o meramente inferida) también se calcula aquí, sin modelo.
 */
import { containsTerm, normalizeLine, type Vocabulary } from '../keywords';
import { PIN_TAG, type MasterProfile } from '../schema';

export interface DictionarySpecialty {
  readonly id: string;
  readonly title: string;
  readonly tags: readonly string[];
}

export interface ClosedDictionary {
  /** Unión de las tags de las especialidades consideradas, sin duplicados y en orden de aparición. */
  readonly tags: readonly string[];
  readonly specialties: readonly DictionarySpecialty[];
}

export type DictionaryResult = { readonly ok: true; readonly dictionary: ClosedDictionary } | { readonly ok: false; readonly message: string };

/** Diccionario cerrado del perfil: las tags de todas sus especialidades o solo de `specialtyId`. */
export function closedDictionary(profile: MasterProfile, specialtyId?: string): DictionaryResult {
  const specialties = specialtyId === undefined ? profile.specialties : profile.specialties.filter((specialty) => specialty.id === specialtyId);
  if (specialtyId !== undefined && specialties.length === 0) {
    const known = profile.specialties.map((specialty) => specialty.id);
    return { ok: false, message: `No existe la especialidad «${specialtyId}» (${known.length === 0 ? 'el perfil no define ninguna' : `definidas: ${known.join(', ')}`})` };
  }
  if (specialties.length === 0) {
    return { ok: false, message: 'El perfil no define especialidades: el diccionario de etiquetas está vacío (crea data/sources/specialties/<id>.md con sus tags)' };
  }
  // El esquema ya impide que una especialidad use la tag reservada `pin`.
  const tags = [...new Set(specialties.flatMap((specialty) => specialty.tags))];
  if (tags.length === 0) {
    return { ok: false, message: `${specialties.length === 1 ? 'La especialidad no define' : 'Las especialidades no definen'} ninguna tag: el diccionario está vacío` };
  }
  return { ok: true, dictionary: { tags, specialties: specialties.map((specialty) => ({ id: specialty.id, title: specialty.title, tags: specialty.tags })) } };
}

/** Evidencia de una etiqueta, calculada por código: en el propio texto, en el contexto del contenedor o solo inferida por el modelo. */
export type TagEvidence = 'literal' | 'contexto' | 'inferida';

export type TagViolationCode = 'VIOLATION_CLOSED_DICTIONARY' | 'VIOLATION_RESERVED_TAG' | 'VIOLATION_MAX_TAGS';

export interface AcceptedTag {
  /** Grafía canónica del diccionario. */
  readonly tag: string;
  readonly reason: string;
  readonly evidence: TagEvidence;
  /** No estaba ya entre las tags actuales del ítem. */
  readonly isNew: boolean;
}

export interface RejectedTag {
  readonly tag: string;
  readonly code: TagViolationCode;
}

export interface TagVerdict {
  readonly accepted: readonly AcceptedTag[];
  readonly rejected: readonly RejectedTag[];
}

/** `#PHP ` → `php`: la comparación con el diccionario es tolerante; la salida usa la grafía del diccionario. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, '').trim().toLowerCase();
}

/** Términos que dan evidencia de una tag: la propia tag y todo término del vocabulario del perfil que apunte a ella. */
export function evidenceTerms(tag: string, vocabulary: Vocabulary): string[] {
  const terms = new Set<string>([normalizeLine(tag)]);
  for (const [term, tags] of vocabulary) {
    if (tags.has(tag)) {
      terms.add(term);
    }
  }
  return [...terms].filter((term) => term !== '');
}

export function tagEvidence(tag: string, text: string, contextText: string, vocabulary: Vocabulary): TagEvidence {
  const terms = evidenceTerms(tag, vocabulary);
  const body = normalizeLine(text);
  if (terms.some((term) => containsTerm(body, term))) {
    return 'literal';
  }
  const context = normalizeLine(contextText);
  return terms.some((term) => containsTerm(context, term)) ? 'contexto' : 'inferida';
}

export interface VerifyTagsOptions {
  readonly dictionary: readonly string[];
  readonly text: string;
  readonly vocabulary: Vocabulary;
  readonly currentTags?: readonly string[] | undefined;
  readonly contextText?: string | undefined;
  readonly maxTags?: number | undefined;
}

export interface TagSuggestion {
  readonly tag: string;
  readonly reason: string;
}

/**
 * Política de verificación de `suggest tags` (C10): diccionario cerrado (toda etiqueta fuera de
 * él se rechaza con `VIOLATION_CLOSED_DICTIONARY`), `pin` reservada, sin duplicados, máximo de
 * etiquetas y evidencia calculada por código. Nunca falla entera: devuelve aceptadas y rechazadas.
 */
export function verifyTagSuggestions(suggestions: readonly TagSuggestion[], options: VerifyTagsOptions): TagVerdict {
  const canonical = new Map(options.dictionary.map((tag) => [normalizeTag(tag), tag] as const));
  const current = new Set((options.currentTags ?? []).map(normalizeTag));
  const accepted: AcceptedTag[] = [];
  const rejected: RejectedTag[] = [];
  const seen = new Set<string>();
  for (const suggestion of suggestions) {
    const normalized = normalizeTag(suggestion.tag);
    if (normalized === PIN_TAG) {
      rejected.push({ tag: suggestion.tag, code: 'VIOLATION_RESERVED_TAG' });
      continue;
    }
    const tag = canonical.get(normalized);
    if (tag === undefined) {
      rejected.push({ tag: suggestion.tag, code: 'VIOLATION_CLOSED_DICTIONARY' });
      continue;
    }
    if (seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    if (options.maxTags !== undefined && accepted.length >= options.maxTags) {
      rejected.push({ tag, code: 'VIOLATION_MAX_TAGS' });
      continue;
    }
    accepted.push({ tag, reason: suggestion.reason.trim(), evidence: tagEvidence(tag, options.text, options.contextText ?? '', options.vocabulary), isNew: !current.has(tag) });
  }
  return { accepted, rejected };
}

/** Sintaxis de las fuentes: `#tag1 #tag2` al final de la viñeta del logro. */
export function formatHashtags(tags: readonly string[]): string {
  return tags.map((tag) => `#${tag}`).join(' ');
}
