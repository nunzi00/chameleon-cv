/**
 * El perfil es el diccionario (`docs/scoring.md` §2, §4.2): tags de todos los ítems y nombres y
 * alias de las skills, cada término apuntando a las tags a las que da evidencia. La tag de
 * anclaje `pin` (T-2.9) nunca entra: anclar no es evidencia de nada.
 */
import { PIN_TAG, type MasterProfile } from '../schema';
import { normalizeLine } from './normalize';
import type { Vocabulary } from './types';

export function buildVocabulary(profile: MasterProfile): Vocabulary {
  const vocabulary = new Map<string, Set<string>>();
  const add = (term: string, tags: readonly string[]): void => {
    const evidence = tags.filter((tag) => tag !== PIN_TAG);
    if (evidence.length === 0) {
      return;
    }
    const key = normalizeLine(term);
    const existing = vocabulary.get(key) ?? new Set<string>();
    for (const tag of evidence) {
      existing.add(tag);
    }
    vocabulary.set(key, existing);
  };
  const addTags = (tags: readonly string[]): void => {
    for (const tag of tags) {
      add(tag, [tag]);
    }
  };

  for (const specialty of profile.specialties) {
    addTags(specialty.tags);
  }
  for (const container of [...profile.experience, ...profile.projects]) {
    addTags(container.tags);
    for (const achievement of container.achievements) {
      addTags(achievement.tags);
    }
  }
  for (const item of [...profile.education, ...profile.certifications, ...profile.achievements]) {
    addTags(item.tags);
  }
  for (const skill of profile.skills) {
    addTags(skill.tags);
    add(skill.name, skill.tags);
    for (const alias of skill.aliases) {
      add(alias, skill.tags);
    }
  }
  return vocabulary;
}
