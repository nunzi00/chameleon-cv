/**
 * Tarea `improve` (T-4.2: espina dorsal; T-4.3: comando completo). Construye el fragmento
 * mínimo de un logro (canon C4: solo lo que la tarea necesita, seudonimizado), lo envía con el
 * prompt versionado (C5) y valida la respuesta con zod (C6). El verificador «sin invención» (C2)
 * y el fichero de revisión llegan en T-4.3.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

import { createRedaction, type Redaction } from '../../core/llm/redact';
import type { Achievement, MasterProfile } from '../../core/schema';
import type { AssetStore } from '../../shared/assets';
import type { LlmCompletion, LlmErrorCode, LlmProvider, LlmUsage } from '../provider';

export const PROMPTS_DIRECTORY = resolve(__dirname, '..', '..', '..', 'prompts');
export const IMPROVE_PROMPT_VERSION = 'improve.v1';
export const IMPROVE_LIMITS = { maxLength: 220, proposals: 2, maxTokens: 600 } as const;

export const ImproveContextSchema = z.strictObject({
  role: z.string().optional(),
  company: z.string().optional(),
  technologies: z.array(z.string()),
  specialty: z.string().optional(),
  offerTerms: z.array(z.string()),
});

/** Lo único que sale hacia el modelo: por construcción no hay email, teléfono, ubicación ni enlaces. */
export const ImproveInputSchema = z.strictObject({
  id: z.string(),
  text: z.string().min(1).max(600),
  impact: z.string().optional(),
  locale: z.string(),
  maxLength: z.int().positive(),
  proposals: z.int().min(1).max(3),
  context: ImproveContextSchema,
});

export const ImproveOutputSchema = z.strictObject({
  proposals: z.array(z.strictObject({ text: z.string().min(1).max(400), rationale: z.string().max(200) })).min(1).max(3),
});

export type ImproveInput = z.output<typeof ImproveInputSchema>;
export type ImproveOutput = z.output<typeof ImproveOutputSchema>;

/** JSON Schema de la salida, derivado del mismo esquema zod que la valida. */
export function improveJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ImproveOutputSchema);
}

export interface FragmentOptions {
  readonly locale?: string | undefined;
  readonly offerTerms?: readonly string[] | undefined;
  readonly proposals?: number | undefined;
  readonly maxLength?: number | undefined;
  /** Seudonimizar también la empresa del contenedor (`[EMPRESA-1]`). */
  readonly redactCompanies?: boolean | undefined;
}

export interface ImproveFragment {
  readonly input: ImproveInput;
  readonly redaction: Redaction;
}

export interface LocatedAchievement {
  readonly achievement: Achievement;
  readonly role?: string | undefined;
  readonly company?: string | undefined;
  readonly technologies: readonly string[];
  /** Tags del contenedor (experiencia o proyecto); vacío en los transversales. */
  readonly containerTags: readonly string[];
}

/** Localiza un logro por `id` en experiencias, proyectos y transversales, con el contexto de su contenedor. */
export function locateAchievement(profile: MasterProfile, id: string): LocatedAchievement | undefined {
  for (const item of profile.experience) {
    const achievement = item.achievements.find((candidate) => candidate.id === id);
    if (achievement !== undefined) {
      return { achievement, role: item.role, company: item.company, technologies: item.technologies, containerTags: item.tags };
    }
  }
  for (const item of profile.projects) {
    const achievement = item.achievements.find((candidate) => candidate.id === id);
    if (achievement !== undefined) {
      return { achievement, role: item.role, company: item.name, technologies: item.technologies, containerTags: item.tags };
    }
  }
  const achievement = profile.achievements.find((candidate) => candidate.id === id);
  return achievement === undefined ? undefined : { achievement, technologies: [], containerTags: [] };
}

/** Fragmento seudonimizado de un logro por `id`; `undefined` si no existe. */
export function buildImproveFragment(profile: MasterProfile, id: string, options: FragmentOptions = {}): ImproveFragment | undefined {
  const located = locateAchievement(profile, id);
  if (located === undefined) {
    return undefined;
  }
  const redaction = createRedaction({
    fullName: profile.personal.fullName,
    companies: options.redactCompanies === true && located.company !== undefined ? [located.company] : [],
  });
  const specialty = profile.specialties[0]?.title;
  const input: ImproveInput = ImproveInputSchema.parse({
    id,
    text: redaction.redact(located.achievement.text),
    ...(located.achievement.impact === undefined ? {} : { impact: redaction.redact(located.achievement.impact) }),
    locale: options.locale ?? profile.meta.locale ?? 'es',
    maxLength: options.maxLength ?? IMPROVE_LIMITS.maxLength,
    proposals: options.proposals ?? IMPROVE_LIMITS.proposals,
    context: {
      ...(located.role === undefined ? {} : { role: redaction.redact(located.role) }),
      ...(located.company === undefined ? {} : { company: redaction.redact(located.company) }),
      technologies: located.technologies.map((technology) => redaction.redact(technology)),
      ...(specialty === undefined ? {} : { specialty: redaction.redact(specialty) }),
      offerTerms: [...(options.offerTerms ?? [])],
    },
  });
  return { input, redaction };
}

/** De dónde salen los prompts: un directorio (por defecto `prompts/` del repositorio) o la capa de assets (T-6.2). */
export type PromptSource = string | Pick<AssetStore, 'text'>;

export async function loadPrompt(version: string = IMPROVE_PROMPT_VERSION, source: PromptSource = PROMPTS_DIRECTORY): Promise<string> {
  const text = typeof source === 'string' ? await readFile(resolve(source, `${version}.md`), 'utf8') : await source.text(`prompts/${version}.md`);
  return text.trim();
}

export interface ImproveProposal {
  readonly text: string;
  readonly rationale: string;
}

export type ImproveErrorCode = LlmErrorCode | 'invalid-output';

export type ImproveResult =
  | {
      readonly ok: true;
      readonly proposals: readonly ImproveProposal[];
      readonly raw: string;
      /** JSON tal como lo devolvió el modelo (con seudónimos): lo que se cachea. */
      readonly json: unknown;
      readonly model: string;
      readonly usage: LlmUsage;
      readonly elapsedMs: number;
      readonly promptVersion: string;
    }
  | { readonly ok: false; readonly code: ImproveErrorCode; readonly message: string };

/** Valida una respuesta (del proveedor o de la caché) y deshace los seudónimos en las propuestas. */
export function interpretImprove(fragment: ImproveFragment, completion: LlmCompletion): ImproveResult {
  if (!completion.ok) {
    return { ok: false, code: completion.code, message: completion.message };
  }
  const output = ImproveOutputSchema.safeParse(completion.json);
  if (!output.success) {
    return { ok: false, code: 'invalid-output', message: `La respuesta no cumple el esquema de «improve»: ${output.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}` };
  }
  return {
    ok: true,
    proposals: output.data.proposals.map((proposal) => ({ text: fragment.redaction.restore(proposal.text), rationale: fragment.redaction.restore(proposal.rationale) })),
    raw: completion.raw,
    json: completion.json,
    model: completion.model,
    usage: completion.usage,
    elapsedMs: completion.elapsedMs,
    promptVersion: IMPROVE_PROMPT_VERSION,
  };
}

/** Envía el fragmento al proveedor e interpreta la respuesta. */
export async function runImprove(provider: LlmProvider, fragment: ImproveFragment, prompt: string, timeoutMs?: number, signal?: AbortSignal): Promise<ImproveResult> {
  const completion = await provider.complete({
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: JSON.stringify(fragment.input) },
    ],
    schema: improveJsonSchema(),
    schemaName: 'improve',
    // Modelos que razonan (p. ej. gpt-oss en Groq): el suelo del registro evita la generación vacía.
    maxTokens: Math.max(IMPROVE_LIMITS.maxTokens, provider.outputTokensFloor ?? 0),
    timeoutMs,
    signal,
  });
  return interpretImprove(fragment, completion);
}
