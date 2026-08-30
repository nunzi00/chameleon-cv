/**
 * Métricas del spike (T-8.4, docs/pdf-import-spike.md §4.3): compara un borrador (P1/P2/P3) con la verdad conocida
 * —el `MasterProfile` del que salió el PDF— campo a campo, y mide el texto extraído (P0). Todo lo que la tabla
 * muestra sale de aquí; nada a mano.
 */
import type { MasterProfile } from '../../../src/core/schema';
import type { DraftAchievement, DraftEntry, DraftProfile } from './structure';
import { contains, normalize, similarity } from './text';

/** Umbrales de emparejamiento (§4.3): entradas por título ≥ 0,75; textos de logros ≥ 0,9. */
export const THRESHOLDS = { entry: 0.75, achievement: 0.9, text: 0.8 } as const;

export interface Ratio {
  readonly hit: number;
  readonly total: number;
}

export interface SectionScore {
  /** Entradas de la verdad emparejadas con una del borrador. */
  readonly recall: Ratio;
  /** Entradas del borrador que corresponden a una de la verdad (el resto, inventadas o mal cortadas). */
  readonly precision: Ratio;
  /** Entradas emparejadas con inicio y fin (o «actualidad») exactos. */
  readonly dates: Ratio;
  /** Logros de la verdad recuperados (texto ≥ 0,9). */
  readonly achievements: Ratio;
  /** Logros del borrador sin correspondencia (falsos positivos). */
  readonly inventedAchievements: number;
  readonly impacts: Ratio;
  readonly technologies: Ratio;
  readonly locations: Ratio;
}

export interface ContactScore {
  readonly fullName: boolean;
  readonly headline: boolean;
  readonly email: boolean;
  readonly phone: boolean;
  readonly city: boolean;
}

export interface Scorecard {
  readonly contact: ContactScore;
  readonly experience: SectionScore;
  readonly projects: SectionScore;
  readonly education: SectionScore;
  readonly certifications: { readonly recall: Ratio; readonly precision: Ratio; readonly dates: Ratio };
  readonly skills: Ratio;
  readonly languages: Ratio;
  /** Campos de la verdad que el borrador prefija correctamente (lo que el usuario no tendría que escribir). */
  readonly prefilled: Ratio;
  readonly unparsedLines: number;
}

function ratio(hit: number, total: number): Ratio {
  return { hit, total };
}

function percent(value: Ratio): string {
  return value.total === 0 ? 'n/a' : `${Math.round((100 * value.hit) / value.total)} % (${value.hit}/${value.total})`;
}

function sameDates(truth: { readonly start: string; readonly end?: string | undefined }, draft: DraftEntry): boolean {
  return draft.start === truth.start && (truth.end === undefined ? draft.end === undefined && draft.current === true : draft.end === truth.end);
}

interface TruthEntry {
  readonly title: string;
  readonly subtitle: string | undefined;
  readonly location: string | undefined;
  readonly dates: { readonly start: string; readonly end?: string | undefined } | undefined;
  readonly achievements: ReadonlyArray<{ readonly text: string; readonly impact: string | undefined }>;
  readonly technologies: readonly string[];
}

function entryKey(title: string, subtitle: string | undefined): string {
  return `${title} ${subtitle ?? ''}`;
}

/** Empareja cada entrada de la verdad con la del borrador más parecida (título + subtítulo), sin repetir. */
function matchEntries(truth: readonly TruthEntry[], draft: readonly DraftEntry[]): Array<{ readonly truth: TruthEntry; readonly draft: DraftEntry | undefined }> {
  const taken = new Set<number>();
  return truth.map((entry) => {
    let best: { index: number; score: number } | undefined;
    draft.forEach((candidate, index) => {
      if (taken.has(index)) {
        return;
      }
      const score = Math.max(
        similarity(entryKey(entry.title, entry.subtitle), entryKey(candidate.title, candidate.subtitle)),
        similarity(entryKey(entry.title, entry.subtitle), entryKey(candidate.subtitle ?? '', candidate.title)),
      );
      if (score >= THRESHOLDS.entry && (best === undefined || score > best.score)) {
        best = { index, score };
      }
    });
    if (best === undefined) {
      return { truth: entry, draft: undefined };
    }
    taken.add(best.index);
    return { truth: entry, draft: draft[best.index] };
  });
}

function matchAchievements(truth: readonly TruthEntry['achievements'][number][], draft: readonly DraftAchievement[]): { readonly hits: number; readonly impacts: Ratio; readonly invented: number } {
  const taken = new Set<number>();
  let hits = 0;
  let impactHits = 0;
  let impactTotal = 0;
  for (const achievement of truth) {
    let best: { index: number; score: number } | undefined;
    draft.forEach((candidate, index) => {
      if (taken.has(index)) {
        return;
      }
      const score = similarity(achievement.text, candidate.text);
      if (score >= THRESHOLDS.achievement && (best === undefined || score > best.score)) {
        best = { index, score };
      }
    });
    if (achievement.impact !== undefined) {
      impactTotal += 1;
    }
    if (best === undefined) {
      continue;
    }
    taken.add(best.index);
    hits += 1;
    if (achievement.impact !== undefined && draft[best.index]?.impact !== undefined && similarity(achievement.impact, draft[best.index]!.impact!) >= THRESHOLDS.text) {
      impactHits += 1;
    }
  }
  return { hits, impacts: ratio(impactHits, impactTotal), invented: draft.length - taken.size };
}

function scoreSection(truth: readonly TruthEntry[], draft: readonly DraftEntry[]): SectionScore {
  const matches = matchEntries(truth, draft);
  const matched = matches.filter((match): match is { truth: TruthEntry; draft: DraftEntry } => match.draft !== undefined);
  const withDates = matched.filter((match) => match.truth.dates !== undefined);
  let achievementHits = 0;
  let achievementTotal = 0;
  let invented = 0;
  let impactHits = 0;
  let impactTotal = 0;
  let technologyHits = 0;
  let technologyTotal = 0;
  let locationHits = 0;
  let locationTotal = 0;
  for (const match of matches) {
    achievementTotal += match.truth.achievements.length;
    technologyTotal += match.truth.technologies.length;
    if (match.truth.location !== undefined) {
      locationTotal += 1;
    }
    if (match.draft === undefined) {
      impactTotal += match.truth.achievements.filter((achievement) => achievement.impact !== undefined).length;
      continue;
    }
    const achievements = matchAchievements(match.truth.achievements, match.draft.achievements);
    achievementHits += achievements.hits;
    invented += achievements.invented;
    impactHits += achievements.impacts.hit;
    impactTotal += achievements.impacts.total;
    const draftTechnologies = new Set(match.draft.technologies.map(normalize));
    technologyHits += match.truth.technologies.filter((name) => draftTechnologies.has(normalize(name))).length;
    if (match.truth.location !== undefined && match.draft.location !== undefined && similarity(match.truth.location, match.draft.location) >= THRESHOLDS.text) {
      locationHits += 1;
    }
  }
  // Los logros de entradas del borrador que no corresponden a ninguna de la verdad también son inventados.
  const unmatchedDraft = draft.filter((entry) => !matched.some((match) => match.draft === entry));
  invented += unmatchedDraft.reduce((sum, entry) => sum + entry.achievements.length, 0);
  return {
    recall: ratio(matched.length, truth.length),
    precision: ratio(matched.length, draft.length),
    dates: ratio(withDates.filter((match) => sameDates(match.truth.dates!, match.draft)).length, withDates.length),
    achievements: ratio(achievementHits, achievementTotal),
    inventedAchievements: invented,
    impacts: ratio(impactHits, impactTotal),
    technologies: ratio(technologyHits, technologyTotal),
    locations: ratio(locationHits, locationTotal),
  };
}

function truthExperience(profile: MasterProfile): TruthEntry[] {
  return profile.experience.map((item) => ({
    title: item.role,
    subtitle: item.company,
    location: item.location,
    dates: item.dates,
    achievements: item.achievements.map((achievement) => ({ text: achievement.text, impact: achievement.impact })),
    technologies: item.technologies,
  }));
}

function truthProjects(profile: MasterProfile): TruthEntry[] {
  return profile.projects.map((item) => ({
    title: item.name,
    subtitle: item.role,
    location: undefined,
    dates: item.dates,
    achievements: item.achievements.map((achievement) => ({ text: achievement.text, impact: achievement.impact })),
    technologies: item.technologies,
  }));
}

function truthEducation(profile: MasterProfile): TruthEntry[] {
  return profile.education.map((item) => ({ title: item.degree, subtitle: item.institution, location: undefined, dates: item.dates, achievements: [], technologies: [] }));
}

/** La tarjeta completa de un borrador frente a la verdad. */
export function score(truth: MasterProfile, draft: DraftProfile): Scorecard {
  const experience = scoreSection(truthExperience(truth), draft.experience);
  const projects = scoreSection(truthProjects(truth), draft.projects);
  const education = scoreSection(truthEducation(truth), draft.education);
  const certificationMatches = matchEntries(
    truth.certifications.map((item) => ({ title: item.name, subtitle: item.issuer, location: undefined, dates: undefined, achievements: [], technologies: [] })),
    draft.certifications,
  );
  const certificationsMatched = certificationMatches.filter((match) => match.draft !== undefined);
  const certificationDates = truth.certifications.map((item, index) => [item.date, certificationMatches[index]?.draft?.date] as const).filter(([expected]) => expected !== undefined);
  const truthSkills = truth.skills.map((skill) => normalize(skill.name));
  const draftSkills = new Set(draft.skills.flatMap((group) => group.names.map(normalize)));
  const truthLanguages = truth.languages.map((language) => normalize(language.name));
  const draftLanguages = new Set(draft.languages.map((language) => normalize(language.name)));
  const contact: ContactScore = {
    fullName: draft.fullName !== undefined && similarity(draft.fullName, truth.personal.fullName) >= THRESHOLDS.text,
    headline: truth.personal.headline === undefined || (draft.headline !== undefined && similarity(draft.headline, truth.personal.headline) >= THRESHOLDS.text),
    email: truth.personal.email === undefined || draft.email === truth.personal.email,
    phone: truth.personal.phone === undefined || (draft.phone !== undefined && normalize(draft.phone).replace(/\s/g, '') === normalize(truth.personal.phone).replace(/\s/g, '')),
    city: truth.personal.location === undefined || (draft.location !== undefined && contains(draft.location, truth.personal.location.city)),
  };
  const contactFields = [contact.fullName, contact.headline, contact.email, contact.phone, contact.city];
  const sectionFields = (section: SectionScore): Ratio => ({
    hit: section.recall.hit + section.dates.hit + section.achievements.hit + section.impacts.hit + section.technologies.hit + section.locations.hit,
    total: section.recall.total + section.dates.total + section.achievements.total + section.impacts.total + section.technologies.total + section.locations.total,
  });
  const parts = [sectionFields(experience), sectionFields(projects), sectionFields(education)];
  const prefilled: Ratio = {
    hit: contactFields.filter(Boolean).length + parts.reduce((sum, part) => sum + part.hit, 0) + certificationsMatched.length + truthSkills.filter((name) => draftSkills.has(name)).length + truthLanguages.filter((name) => draftLanguages.has(name)).length,
    total: contactFields.length + parts.reduce((sum, part) => sum + part.total, 0) + truth.certifications.length + truthSkills.length + truthLanguages.length,
  };
  return {
    contact,
    experience,
    projects,
    education,
    certifications: {
      recall: ratio(certificationsMatched.length, truth.certifications.length),
      precision: ratio(certificationsMatched.length, draft.certifications.length),
      dates: ratio(certificationDates.filter(([expected, actual]) => expected === actual).length, certificationDates.length),
    },
    skills: ratio(truthSkills.filter((name) => draftSkills.has(name)).length, truthSkills.length),
    languages: ratio(truthLanguages.filter((name) => draftLanguages.has(name)).length, truthLanguages.length),
    prefilled,
    unparsedLines: draft.unparsed.length,
  };
}

/** P0: qué parte de los textos de la verdad (logros, títulos, habilidades) aparece en el texto extraído. */
export function textCoverage(truth: MasterProfile, text: string): Ratio {
  const needles = [
    truth.personal.fullName,
    ...truth.experience.flatMap((item) => [item.role, item.company, ...item.achievements.map((achievement) => achievement.text)]),
    ...truth.projects.flatMap((item) => [item.name, ...item.achievements.map((achievement) => achievement.text)]),
    ...truth.education.flatMap((item) => [item.degree, item.institution]),
    ...truth.certifications.map((item) => item.name),
    ...truth.skills.map((skill) => skill.name),
  ];
  return ratio(needles.filter((needle) => contains(text, needle)).length, needles.length);
}

export interface Row {
  readonly name: string;
  readonly candidate: string;
  readonly coverage: Ratio;
  readonly card: Scorecard;
  readonly milliseconds: number;
}

/** Tabla Markdown con las columnas de §4.3; una fila por PDF y candidato. */
export function markdownTable(rows: readonly Row[]): string {
  const header = '| PDF | Candidato | P0 texto | Contacto | Exp. entradas | Exp. fechas | Exp. logros | Logros inventados | Proyectos | Formación | Certif. | Habilidades | Idiomas | Prefijado | Sin asignar | ms |';
  const separator = '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const lines = rows.map((row) => {
    const { card } = row;
    const contact = [card.contact.fullName, card.contact.headline, card.contact.email, card.contact.phone, card.contact.city].filter(Boolean).length;
    const invented = card.experience.inventedAchievements + card.projects.inventedAchievements;
    return `| ${row.name} | ${row.candidate} | ${percent(row.coverage)} | ${contact}/5 | ${percent(card.experience.recall)} | ${percent(card.experience.dates)} | ${percent(card.experience.achievements)} | ${invented} | ${percent(card.projects.recall)} | ${percent(card.education.recall)} | ${percent(card.certifications.recall)} | ${percent(card.skills)} | ${percent(card.languages)} | ${percent(card.prefilled)} | ${card.unparsedLines} | ${row.milliseconds} |`;
  });
  return [header, separator, ...lines].join('\n');
}

export { percent };
