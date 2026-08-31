/**
 * Del borrador estructurado al árbol de fuentes (T-8.4b, docs/cv-import.md §2.1): convierte el `DraftProfile`
 * del estructurador en un `MasterProfile` parcial validado ENTIDAD A ENTIDAD —lo que no cumple el esquema se
 * degrada al informe con su motivo y su procedencia, nunca se inventa ni se recorta en silencio— y produce los
 * ficheros del borrador con los MISMOS serializadores que `cv import` (formato idéntico a `data/sources/`),
 * más un `INFORME.md` con lo reconocido, lo degradado y lo que quedó sin situar.
 */
import { AchievementSchema, CertificationSchema, EducationSchema, ExperienceSchema, LanguageSchema, PersonalSchema, ProjectSchema, SkillSchema, parseMasterProfile, type MasterProfile } from '../core/schema';
import { canonicalOrder, planFiles } from '../app/portability';
import { slugify } from '../app/slug';
import type { DraftAchievement, DraftEntry, DraftProfile, Provenance } from './structure';

/** Un problema del borrador: qué se degradó (o avisó) y por qué, con su línea de origen. */
export interface DraftIssue {
  readonly reason: string;
  readonly provenance?: Provenance | undefined;
}

export interface DraftFiles {
  /** Ficheros relativos (mismo plan que `cv import`): `profile.md`, `experience/….md`, `skills.csv`… */
  readonly files: ReadonlyArray<{ readonly path: string; readonly content: string }>;
  /** El perfil parcial ya canónico (para contar y para las pruebas). */
  readonly profile: MasterProfile;
  readonly issues: readonly DraftIssue[];
  /** Líneas del texto de origen que el estructurador no supo situar. */
  readonly unparsed: readonly Provenance[];
}

/** Niveles de idioma libres → MCER del esquema; lo que no se entiende se degrada. */
const LANGUAGE_LEVELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(nativ|native|biling|mother|lengua materna)/i, 'native'],
  [/^(a1|a2|b1|b2|c1|c2)\b/i, 'upper'],
  [/^(fluido|fluent|avanzado|advanced|profesional|professional)/i, 'C1'],
  [/^(intermedio|intermediate)/i, 'B1'],
  [/^(b[aá]sico|basic)/i, 'A2'],
];

export function mapLanguageLevel(level: string | undefined): string | undefined {
  if (level === undefined) {
    return undefined;
  }
  for (const [pattern, target] of LANGUAGE_LEVELS) {
    if (pattern.test(level)) {
      return target === 'upper' ? level.slice(0, 2).toUpperCase() : target;
    }
  }
  return undefined;
}

/** Identificador estable y único: `exp-<slug>`, `exp-<slug>-2`… (el slug puede quedar vacío con títulos no latinos). */
function identifier(prefix: string, text: string, used: Set<string>): string {
  const base = `${prefix}-${slugify(text).slice(0, 48)}`.replace(/-+$/, '');
  let candidate = base === prefix ? `${prefix}-1` : base;
  for (let n = 2; used.has(candidate); n += 1) {
    candidate = `${base}-${n}`;
  }
  used.add(candidate);
  return candidate;
}

function achievementInput(item: DraftAchievement, id: string): Record<string, unknown> {
  return { id, text: item.text, ...(item.impact === undefined ? {} : { impact: item.impact }) };
}

type Section = 'experience' | 'projects' | 'education' | 'certifications';

const SECTION_LABEL: Readonly<Record<Section, string>> = { experience: 'experiencia', projects: 'proyecto', education: 'formación', certifications: 'certificación' };

/** El primer error de Zod, en una frase corta para el informe (Zod garantiza al menos un issue). */
export function firstIssue(error: { readonly issues: ReadonlyArray<{ readonly path: ReadonlyArray<PropertyKey>; readonly message: string }> }): string {
  const issue = error.issues[0]!;
  const path = issue.path.join('.');
  return `${path === '' ? 'entrada' : path}: ${issue.message}`;
}

/** Etiqueta humana de un enlace a partir de su host («github.com» → «Github»); sin host útil, «Enlace». */
export function linkLabel(host: string): string {
  // `split` nunca devuelve una lista vacía: el primer elemento existe siempre (es '' para un host vacío).
  const first = host.replace(/^www\./, '').split('.')[0]!;
  return first === '' ? 'Enlace' : first.charAt(0).toUpperCase() + first.slice(1);
}

/** Construye el `MasterProfile` parcial y los ficheros del borrador (limpios: la procedencia va en el README). */
export function draftFiles(draft: DraftProfile): DraftFiles {
  const issues: DraftIssue[] = [];
  const used = new Set<string>();

  const personalInput = {
    fullName: draft.fullName ?? 'Nombre pendiente',
    ...(draft.headline === undefined ? {} : { headline: draft.headline }),
    ...(draft.summary === undefined ? {} : { summary: draft.summary }),
    ...(draft.email === undefined ? {} : { email: draft.email }),
    ...(draft.phone === undefined ? {} : { phone: draft.phone }),
    ...(draft.location === undefined ? {} : { location: { city: draft.location } }),
    links: [] as Array<{ label: string; url: string }>,
  };
  if (draft.fullName === undefined) {
    issues.push({ reason: 'no se reconoció el nombre: el borrador lleva «Nombre pendiente»' });
  }
  for (const link of draft.links) {
    const url = link.startsWith('http') ? link : `https://${link}`;
    let label: string;
    try {
      label = linkLabel(new URL(url).hostname);
    } catch {
      issues.push({ reason: `enlace no reconocido: «${link}»` });
      continue;
    }
    personalInput.links.push({ label, url });
  }
  let personal = PersonalSchema.safeParse(personalInput);
  if (!personal.success) {
    // Los campos opcionales que Zod señala como culpables (un teléfono raro, un email roto) se retiran con aviso.
    const removable = new Set(['phone', 'email', 'location', 'headline', 'summary']);
    const relaxed = { ...personalInput } as Record<string, unknown>;
    for (const culprit of new Set(personal.error.issues.map((issue) => issue.path[0]))) {
      if (typeof culprit === 'string' && removable.has(culprit) && culprit in relaxed) {
        delete relaxed[culprit];
        issues.push({ reason: `${culprit} descartado del borrador: ${firstIssue(personal.error)}` });
      }
    }
    personal = PersonalSchema.safeParse(relaxed);
  }
  if (!personal.success) {
    issues.push({ reason: `datos personales reducidos al nombre: ${firstIssue(personal.error)}` });
    personal = PersonalSchema.safeParse({ fullName: personalInput.fullName, links: [] });
  }

  const entries = (section: Section, list: readonly DraftEntry[]): unknown[] => {
    const prefix = { experience: 'exp', projects: 'pro', education: 'edu', certifications: 'cert' }[section];
    const schema = { experience: ExperienceSchema, projects: ProjectSchema, education: EducationSchema, certifications: CertificationSchema }[section];
    const accepted: unknown[] = [];
    for (const entry of list) {
      const id = identifier(prefix, [entry.title, entry.subtitle].filter((part) => part !== undefined).join(' '), used);
      const achievements = entry.achievements.map((item, index) => achievementInput(item, `${id}-l${index + 1}`));
      const dates = entry.start === undefined ? undefined : { start: entry.start, ...(entry.end === undefined ? {} : { end: entry.end }) };
      const base = {
        id,
        ...(entry.location === undefined ? {} : { location: entry.location }),
        ...(entry.summary === undefined ? {} : { summary: entry.summary }),
        ...(entry.url === undefined ? {} : { url: entry.url }),
        technologies: entry.technologies,
        achievements,
      };
      const input: Record<string, unknown> =
        section === 'experience'
          ? { ...base, company: entry.subtitle ?? 'Empresa pendiente', role: entry.title, dates }
          : section === 'projects'
            ? { ...base, name: entry.title, ...(entry.subtitle === undefined ? {} : { role: entry.subtitle }), ...(dates === undefined ? {} : { dates }) }
            : section === 'education'
              ? { id, institution: entry.subtitle ?? 'Centro pendiente', degree: entry.title, ...(entry.field === undefined ? {} : { field: entry.field }), ...(dates === undefined ? {} : { dates }), ...(entry.summary === undefined ? {} : { summary: entry.summary }) }
              : { id, name: entry.title, ...(entry.subtitle === undefined ? {} : { issuer: entry.subtitle }), ...(entry.date === undefined ? {} : { date: entry.date }), ...(entry.url === undefined ? {} : { url: entry.url }) };
      if (section === 'experience' && dates === undefined) {
        issues.push({ reason: `experiencia sin fechas reconocibles: «${entry.title}» va al informe, no al borrador`, provenance: entry.provenance });
        continue;
      }
      if (section === 'experience' && entry.subtitle === undefined) {
        issues.push({ reason: `experiencia sin empresa reconocida: «${entry.title}» lleva «Empresa pendiente»`, provenance: entry.provenance });
      }
      if (section === 'education' && entry.singleDate === true) {
        issues.push({ reason: `formación con una sola fecha: «${entry.title}» la toma como inicio; ajústala si era la de graduación`, provenance: entry.provenance });
      }
      if (section === 'education' && entry.subtitle === undefined) {
        issues.push({ reason: `formación sin centro reconocido: «${entry.title}» lleva «Centro pendiente»`, provenance: entry.provenance });
      }
      const parsed = schema.safeParse(input);
      if (parsed.success) {
        accepted.push(parsed.data);
        continue;
      }
      // El campo opcional que falle (una URL rota, un logro demasiado largo) se retira con aviso; la entrada se conserva.
      const relaxed = { ...input } as Record<string, unknown>;
      const culprit = parsed.error.issues[0]?.path[0];
      if (typeof culprit === 'string' && !['id', 'company', 'role', 'name', 'institution', 'degree', 'dates', 'title'].includes(culprit)) {
        delete relaxed[culprit];
        const retry = schema.safeParse(relaxed);
        if (retry.success) {
          issues.push({ reason: `${SECTION_LABEL[section]} «${entry.title}»: ${culprit} descartado (${firstIssue(parsed.error)})`, provenance: entry.provenance });
          accepted.push(retry.data);
          continue;
        }
      }
      issues.push({ reason: `${SECTION_LABEL[section]} descartada: «${entry.title}» (${firstIssue(parsed.error)})`, provenance: entry.provenance });
    }
    return accepted;
  };

  const skills: unknown[] = [];
  for (const group of draft.skills) {
    for (const name of group.names) {
      const parsed = SkillSchema.safeParse({ id: identifier('skill', name, used), name, ...(group.category === undefined ? {} : { category: group.category }) });
      if (parsed.success) {
        skills.push(parsed.data);
      } else {
        issues.push({ reason: `habilidad descartada: «${name}» (${firstIssue(parsed.error)})`, provenance: group.provenance });
      }
    }
  }

  const achievements: unknown[] = [];
  for (const [index, item] of draft.achievements.entries()) {
    const parsed = AchievementSchema.safeParse(achievementInput(item, identifier('logro', item.text.slice(0, 40) || `general-${index + 1}`, used)));
    if (parsed.success) {
      achievements.push(parsed.data);
    } else {
      issues.push({ reason: `logro descartado (${firstIssue(parsed.error)})`, provenance: item.provenance });
    }
  }

  const languages: unknown[] = [];
  for (const language of draft.languages) {
    const level = mapLanguageLevel(language.level);
    const parsed = LanguageSchema.safeParse({ name: language.name, level: level ?? 'B2' });
    if (level === undefined) {
      issues.push({ reason: `idioma «${language.name}» sin nivel reconocible${language.level === undefined ? '' : ` («${language.level}»)`}: se anota B2 provisional` });
    }
    if (parsed.success) {
      languages.push(parsed.data);
    } else {
      issues.push({ reason: `idioma descartado: «${language.name}» (${firstIssue(parsed.error)})` });
    }
  }

  const profile = parseMasterProfile({
    meta: { schemaVersion: 1, locale: 'es-ES' },
    personal: personal.success ? personal.data : { fullName: 'Nombre pendiente', links: [] },
    specialties: [],
    experience: entries('experience', draft.experience),
    projects: entries('projects', draft.projects),
    education: entries('education', draft.education),
    certifications: entries('certifications', draft.certifications),
    skills,
    achievements,
    languages,
  });

  // Sin banner dentro de los .md: el cuerpo tras el frontmatter ES el resumen para el cargador, y un comentario
  // HTML lo ensuciaría (y puede empujarlo por encima del límite). La procedencia vive en el README del borrador.
  const files = planFiles(profile, canonicalOrder(profile).naming);
  return { files, profile, issues, unparsed: draft.unparsed };
}

/** El informe del borrador: qué se reconoció, qué se degradó y qué quedó sin situar (con líneas del texto). */
export interface ReportProposal {
  readonly n: number;
  readonly section: string;
  readonly reason: string;
  readonly text: string;
}

export function draftReport(result: DraftFiles, origin: string, importedAt: string, proposals: readonly ReportProposal[] = []): string {
  const { profile } = result;
  const lines = [
    `# Informe del borrador importado`,
    '',
    `- Origen: ${origin}`,
    `- Importado: ${importedAt}`,
    `- Reconocido: ${profile.experience.length} experiencias · ${profile.projects.length} proyectos · ${profile.education.length} formaciones · ${profile.certifications.length} certificaciones · ${profile.skills.length} habilidades · ${profile.achievements.length} logros · ${profile.languages.length} idiomas`,
    '',
    'Valida el borrador con `cv build --data <carpeta del borrador>` y muévelo a `data/sources/` cuando lo hayas revisado.',
  ];
  if (result.issues.length > 0) {
    lines.push('', '## Degradado o avisado', '');
    for (const issue of result.issues) {
      lines.push(`- ${issue.reason}${issue.provenance === undefined ? '' : ` (línea ${issue.provenance.line}: «${issue.provenance.text.slice(0, 80)}»)`}`);
    }
  }
  if (proposals.length > 0) {
    lines.push('', '## Propuestas del co-piloto (no aplicadas)', '', 'El co-piloto solo PROPONE dónde iría cada línea sin situar; nada se ha escrito en el borrador. Muévelas tú si estás de acuerdo.', '');
    for (const proposal of proposals) {
      lines.push(`- línea ${proposal.n} → **${proposal.section}**: ${proposal.text.slice(0, 120)}${proposal.reason === '' ? '' : ` _(${proposal.reason})_`}`);
    }
  }
  if (result.unparsed.length > 0) {
    lines.push('', '## Sin situar (revísalo a mano)', '');
    for (const item of result.unparsed) {
      lines.push(`- línea ${item.line}: ${item.text}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
