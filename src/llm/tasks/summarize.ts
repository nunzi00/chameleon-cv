/**
 * Tarea `summarize` (T-4.4): el resumen profesional a partir del perfil **ya filtrado** por el
 * motor determinista. El fragmento es una representación textual y seudonimizada del perfil
 * (canon C4: sin contacto), con los hechos derivables calculados por código (años de
 * experiencia) para que el modelo no tenga que inventarlos. La verificación (C2) rechaza toda
 * invención y mide la cobertura de los hechos clave (tags de la especialidad y términos de la
 * oferta demostrados).
 */
import { z } from 'zod';

import { createRedaction, type Redaction } from '../../core/llm/redact';
import { containsTerm, normalizeLine } from '../../core/keywords';
import { expandIsoDate, type MasterProfile } from '../../core/schema';
import { buildStructuredView, type Block, type Run } from '../../renderers/structured';
import type { LlmCompletion, LlmErrorCode, LlmProvider, LlmUsage } from '../provider';
import { loadPrompt } from './improve';

export const SUMMARIZE_PROMPT_VERSION = 'summarize.v1';
export const SUMMARIZE_LIMITS = { paragraphs: 2, maxLength: 900, proposals: 2, maxTokens: 1200 } as const;

const ExperienceSchema = z.strictObject({
  role: z.string(),
  company: z.string(),
  period: z.string(),
  /** Tecnologías tal como las muestra el CV («PHP 8.3, Symfony 6.4»); vacío si no hay. */
  technologies: z.string(),
  achievements: z.array(z.string()),
});
const ProjectSchema = z.strictObject({
  name: z.string(),
  role: z.string().optional(),
  technologies: z.string(),
  achievements: z.array(z.string()),
});

/** Representación textual del perfil filtrado: por construcción sin email, teléfono, ubicación ni enlaces. */
export const SummarizeInputSchema = z.strictObject({
  locale: z.string(),
  paragraphs: z.int().min(1).max(3),
  maxLength: z.int().positive(),
  proposals: z.int().min(1).max(3),
  headline: z.string().optional(),
  currentSummary: z.string().optional(),
  yearsOfExperience: z.int().nonnegative().optional(),
  experience: z.array(ExperienceSchema),
  projects: z.array(ProjectSchema),
  skills: z.array(z.strictObject({ category: z.string(), names: z.string() })),
  achievements: z.array(z.string()),
  education: z.array(z.strictObject({ degree: z.string(), field: z.string().optional(), institution: z.string() })),
  certifications: z.array(z.string()),
  languages: z.array(z.strictObject({ name: z.string(), level: z.string() })),
  offerTerms: z.array(z.string()),
});

export const SummarizeOutputSchema = z.strictObject({
  proposals: z.array(z.strictObject({ text: z.string().min(20).max(3000), rationale: z.string().max(200) })).min(1).max(3),
});

export type SummarizeInput = z.output<typeof SummarizeInputSchema>;
export type SummarizeOutput = z.output<typeof SummarizeOutputSchema>;

export function summarizeJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(SummarizeOutputSchema) as Record<string, unknown>;
}

export interface SummarizeFragmentOptions {
  readonly locale?: string | undefined;
  readonly offerTerms?: readonly string[] | undefined;
  readonly proposals?: number | undefined;
  readonly paragraphs?: number | undefined;
  readonly maxLength?: number | undefined;
  readonly redactCompanies?: boolean | undefined;
  /** «Ahora», para los años de experiencia de un puesto en curso (inyectable). */
  readonly now?: Date | undefined;
}

export interface SummarizeFragment {
  readonly input: SummarizeInput;
  readonly redaction: Redaction;
  /** Todo el texto del perfil (sin seudonimizar) contra el que se verifica cada propuesta. */
  readonly corpus: string;
  /** Hechos clave demostrados en el perfil: tags de la especialidad y términos de la oferta. */
  readonly keyFacts: readonly string[];
}

const plainText = (runs: readonly Run[]): string => runs.map((run) => run.text).join('');
const blocksText = (blocks: readonly Block[]): string => blocks.map((block) => plainText(block.runs)).join('\n');
/** Texto de un logro con su impacto entre paréntesis, como lo muestra el CV. */
const achievementText = (achievement: { readonly runs: readonly Run[]; readonly impact?: string | undefined }): string =>
  plainText(achievement.runs) + (achievement.impact === undefined ? '' : ` (${achievement.impact})`);

/** Años completos entre el inicio más antiguo y el fin más reciente (o «ahora» si sigue en curso). */
export function yearsOfExperience(profile: MasterProfile, now: Date): number | undefined {
  if (profile.experience.length === 0) {
    return undefined;
  }
  const starts = profile.experience.map((item) => new Date(`${expandIsoDate(item.dates.start, 'start')}T00:00:00Z`).getTime());
  const ends = profile.experience.map((item) => (item.dates.end === undefined ? now.getTime() : new Date(`${expandIsoDate(item.dates.end, 'end')}T00:00:00Z`).getTime()));
  const months = Math.max(0, Math.round((Math.max(...ends) - Math.min(...starts)) / (1000 * 60 * 60 * 24 * 30.44)));
  return Math.floor(months / 12);
}

export function buildSummarizeFragment(profile: MasterProfile, options: SummarizeFragmentOptions = {}): SummarizeFragment {
  const locale = options.locale ?? profile.meta.locale ?? 'es';
  const view = buildStructuredView(profile, locale);
  const redaction = createRedaction({
    fullName: profile.personal.fullName,
    companies: options.redactCompanies === true ? profile.experience.map((item) => item.company) : [],
  });
  const r = (text: string): string => redaction.redact(text);
  const corpusParts: string[] = [];
  const keep = (text: string): string => {
    corpusParts.push(text);
    return text;
  };

  const headline = profile.specialties[0]?.title ?? profile.personal.headline;
  const currentSummary = view.summary.length === 0 ? undefined : blocksText(view.summary);
  const years = yearsOfExperience(profile, options.now ?? new Date());
  const input: SummarizeInput = SummarizeInputSchema.parse({
    locale,
    paragraphs: options.paragraphs ?? SUMMARIZE_LIMITS.paragraphs,
    maxLength: options.maxLength ?? SUMMARIZE_LIMITS.maxLength,
    proposals: options.proposals ?? SUMMARIZE_LIMITS.proposals,
    ...(headline === undefined ? {} : { headline: r(keep(headline)) }),
    ...(currentSummary === undefined ? {} : { currentSummary: r(keep(currentSummary)) }),
    ...(years === undefined ? {} : { yearsOfExperience: Number(keep(String(years))) }),
    // En el orden de la vista (cronológico inverso, el mismo del CV), con los mismos textos que muestra el CV.
    experience: view.experience.map((item) => ({
      role: r(keep(item.role)),
      company: r(keep(item.company)),
      period: keep(item.period),
      technologies: r(keep(item.technologies)),
      achievements: item.achievements.map((achievement) => r(keep(achievementText(achievement)))),
    })),
    projects: view.projects.map((item) => ({
      name: r(keep(item.name)),
      ...(item.role === undefined ? {} : { role: r(keep(item.role)) }),
      technologies: r(keep(item.technologies)),
      achievements: item.achievements.map((achievement) => r(keep(achievementText(achievement)))),
    })),
    skills: view.skillGroups.map((group) => ({ category: group.label, names: r(keep(group.names)) })),
    achievements: view.achievements.map((achievement) => r(keep(achievementText(achievement)))),
    education: profile.education.map((item) => ({ degree: r(keep(item.degree)), ...(item.field === undefined ? {} : { field: r(keep(item.field)) }), institution: r(keep(item.institution)) })),
    certifications: profile.certifications.map((item) => r(keep(item.name))),
    languages: view.languages.map((language) => ({ name: language.name, level: language.level })),
    offerTerms: [...(options.offerTerms ?? [])],
  });

  const corpus = corpusParts.join('\n');
  const normalizedCorpus = normalizeLine(corpus);
  const candidates = [...new Set([...(profile.specialties[0]?.tags ?? []), ...(options.offerTerms ?? [])].map((term) => normalizeLine(term)))];
  const keyFacts = candidates.filter((term) => term !== '' && containsTerm(normalizedCorpus, term));
  return { input, redaction, corpus, keyFacts };
}

export function loadSummarizePrompt(directory?: string): Promise<string> {
  return loadPrompt(SUMMARIZE_PROMPT_VERSION, directory);
}

export interface SummarizeProposal {
  readonly text: string;
  readonly rationale: string;
}

export type SummarizeErrorCode = LlmErrorCode | 'invalid-output';

export type SummarizeResult =
  | { readonly ok: true; readonly proposals: readonly SummarizeProposal[]; readonly raw: string; readonly json: unknown; readonly model: string; readonly usage: LlmUsage; readonly elapsedMs: number; readonly promptVersion: string }
  | { readonly ok: false; readonly code: SummarizeErrorCode; readonly message: string };

export function interpretSummarize(fragment: SummarizeFragment, completion: LlmCompletion): SummarizeResult {
  if (!completion.ok) {
    return { ok: false, code: completion.code, message: completion.message };
  }
  const output = SummarizeOutputSchema.safeParse(completion.json);
  if (!output.success) {
    return { ok: false, code: 'invalid-output', message: `La respuesta no cumple el esquema de «summarize»: ${output.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}` };
  }
  return {
    ok: true,
    proposals: output.data.proposals.map((proposal) => ({ text: fragment.redaction.restore(proposal.text.trim()), rationale: fragment.redaction.restore(proposal.rationale) })),
    raw: completion.raw,
    json: completion.json,
    model: completion.model,
    usage: completion.usage,
    elapsedMs: completion.elapsedMs,
    promptVersion: SUMMARIZE_PROMPT_VERSION,
  };
}

export async function runSummarize(provider: LlmProvider, fragment: SummarizeFragment, prompt: string, timeoutMs?: number): Promise<SummarizeResult> {
  const completion = await provider.complete({
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: JSON.stringify(fragment.input) },
    ],
    schema: summarizeJsonSchema(),
    schemaName: 'summarize',
    maxTokens: SUMMARIZE_LIMITS.maxTokens,
    timeoutMs,
  });
  return interpretSummarize(fragment, completion);
}
