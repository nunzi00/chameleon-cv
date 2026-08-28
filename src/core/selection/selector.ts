/**
 * SelectorEngine (T-1.5, `docs/selector-engine.md`): reduce un `MasterProfile` a lo relevante
 * para una especialidad y explica cada decisión.
 *
 * Regla: **sin tags, siempre; con tags, solo si alguna coincide** con el vocabulario de la
 * especialidad (`tags ∪ {id}`). Un contenedor (experiencia, proyecto) se conserva si es
 * relevante o si alguno de sus logros coincide explícitamente; dentro de un contenedor
 * conservado se filtran los logros con la misma regla. La tag reservada `#pin` (T-2.9) cuenta
 * como coincidencia explícita con cualquier especialidad: ancla el ítem y arrastra su contenedor.
 *
 * Invariantes canónicos: pura y determinista, conserva el contrato, conserva el orden,
 * idempotente, monótona respecto al etiquetado y explicable (una decisión por ítem evaluado).
 */
import { isPinned, type Achievement, type MasterProfile, type Specialty } from '../schema';

export type SelectionReason = 'universal' | 'matched' | 'pinned' | 'via-achievements' | 'no-match';

export type SelectionSection = 'experience' | 'projects' | 'education' | 'skills' | 'certifications' | 'achievements';

export interface ItemDecision {
  readonly section: SelectionSection;
  readonly id: string;
  /** Solo en logros anidados: id de la experiencia o proyecto que los contiene. */
  readonly parentId?: string;
  readonly included: boolean;
  readonly reason: SelectionReason;
  /** Tags del ítem presentes en el vocabulario (vacío si es universal o no coincide). */
  readonly matchedTags: readonly string[];
}

export interface SelectionReport {
  readonly specialtyId: string;
  readonly vocabulary: readonly string[];
  readonly decisions: readonly ItemDecision[];
}

export interface Selection {
  readonly specialty: Specialty;
  /** `MasterProfile` reducido: mismo tipo y mismo contrato que la entrada. */
  readonly profile: MasterProfile;
  readonly report: SelectionReport;
}

export interface SelectionError {
  readonly code: 'UNKNOWN_SPECIALTY';
  readonly message: string;
  readonly available: readonly string[];
}

export type SelectionResult =
  | { readonly ok: true; readonly selection: Selection }
  | { readonly ok: false; readonly error: SelectionError };

export interface Relevance {
  readonly relevant: boolean;
  /** Coincidencia explícita: alguna tag en el vocabulario, o la tag de anclaje `#pin`. */
  readonly explicit: boolean;
  readonly pinned: boolean;
  readonly matchedTags: readonly string[];
}

/** Vocabulario de la especialidad: sus tags más su propio id (permite fijar ítems con `#<id>`). */
export function specialtyVocabulary(specialty: Specialty): ReadonlySet<string> {
  return new Set([specialty.id, ...specialty.tags]);
}

/** Relevancia de unas tags: universal (sin tags), anclada (`#pin`) o con coincidencia explícita. */
export function relevanceOf(tags: readonly string[], vocabulary: ReadonlySet<string>): Relevance {
  const matchedTags = tags.filter((tag) => vocabulary.has(tag));
  const pinned = isPinned(tags);
  const explicit = pinned || matchedTags.length > 0;
  return { relevant: tags.length === 0 || explicit, explicit, pinned, matchedTags };
}

function reasonFor(tags: readonly string[], relevance: Relevance): SelectionReason {
  if (relevance.pinned) {
    return 'pinned';
  }
  if (tags.length === 0) {
    return 'universal';
  }
  return relevance.explicit ? 'matched' : 'no-match';
}

interface Taggable {
  readonly id: string;
  readonly tags: readonly string[];
}

interface Container extends Taggable {
  readonly achievements: readonly Achievement[];
}

class Selector {
  readonly decisions: ItemDecision[] = [];
  private readonly vocabulary: ReadonlySet<string>;

  constructor(vocabulary: ReadonlySet<string>) {
    this.vocabulary = vocabulary;
  }

  /** Secciones planas: se conserva cada ítem relevante. */
  selectFlat<T extends Taggable>(section: SelectionSection, items: readonly T[]): T[] {
    return items.filter((item) => {
      const relevance = relevanceOf(item.tags, this.vocabulary);
      this.decisions.push({
        section,
        id: item.id,
        included: relevance.relevant,
        reason: reasonFor(item.tags, relevance),
        matchedTags: relevance.matchedTags,
      });
      return relevance.relevant;
    });
  }

  /** Contenedores: relevantes por sí mismos o arrastrados por un logro con coincidencia explícita. */
  selectContainers<T extends Container>(section: SelectionSection, items: readonly T[]): T[] {
    const kept: T[] = [];
    for (const item of items) {
      const own = relevanceOf(item.tags, this.vocabulary);
      const achievements = item.achievements.map((achievement) => ({
        achievement,
        relevance: relevanceOf(achievement.tags, this.vocabulary),
      }));
      const pulled = !own.relevant && achievements.some(({ relevance }) => relevance.explicit);
      const included = own.relevant || pulled;
      this.decisions.push({
        section,
        id: item.id,
        included,
        reason: own.relevant ? reasonFor(item.tags, own) : pulled ? 'via-achievements' : 'no-match',
        matchedTags: own.matchedTags,
      });
      if (!included) {
        continue;
      }
      const keptAchievements: Achievement[] = [];
      for (const { achievement, relevance } of achievements) {
        this.decisions.push({
          section,
          id: achievement.id,
          parentId: item.id,
          included: relevance.relevant,
          reason: reasonFor(achievement.tags, relevance),
          matchedTags: relevance.matchedTags,
        });
        if (relevance.relevant) {
          keptAchievements.push(achievement);
        }
      }
      kept.push({ ...item, achievements: keptAchievements });
    }
    return kept;
  }
}

/**
 * Selecciona el contenido relevante para la especialidad `specialtyId`. No muta la entrada;
 * los ítems conservados se comparten por referencia.
 */
export function selectForSpecialty(profile: MasterProfile, specialtyId: string): SelectionResult {
  const specialty = profile.specialties.find((candidate) => candidate.id === specialtyId);
  if (specialty === undefined) {
    const available = profile.specialties.map((candidate) => candidate.id);
    const hint = available.length === 0 ? 'no hay especialidades definidas' : `disponibles: ${available.join(', ')}`;
    return {
      ok: false,
      error: { code: 'UNKNOWN_SPECIALTY', message: `Especialidad desconocida: «${specialtyId}» (${hint})`, available },
    };
  }

  const vocabulary = specialtyVocabulary(specialty);
  const selector = new Selector(vocabulary);
  const experience = selector.selectContainers('experience', profile.experience);
  const projects = selector.selectContainers('projects', profile.projects);
  const education = selector.selectFlat('education', profile.education);
  const skills = selector.selectFlat('skills', profile.skills);
  const certifications = selector.selectFlat('certifications', profile.certifications);
  const achievements = selector.selectFlat('achievements', profile.achievements);

  const personal = {
    ...profile.personal,
    headline: specialty.title,
    ...(specialty.summary === undefined ? {} : { summary: specialty.summary }),
  };

  const selected: MasterProfile = {
    meta: profile.meta,
    personal,
    specialties: [specialty],
    experience,
    projects,
    education,
    skills,
    achievements,
    certifications,
    languages: profile.languages,
  };

  return {
    ok: true,
    selection: {
      specialty,
      profile: selected,
      report: { specialtyId: specialty.id, vocabulary: [...vocabulary], decisions: selector.decisions },
    },
  };
}
