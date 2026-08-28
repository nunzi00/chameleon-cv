/**
 * Contrato de los requisitos de una oferta (`docs/scoring.md` §3). Una sola fuente de verdad:
 * el esquema zod, del que se derivan los tipos. Lo cumple el extractor determinista (T-2.1) y
 * lo cumplirá la salida del LLM (Hito 3).
 */
import { z } from 'zod';

import { TagSchema } from '../schema';

export const EmphasisSchema = z.enum(['required', 'desirable', 'unknown']);

export const RequirementTermSchema = z.strictObject({
  /** Término tal como está en el vocabulario (normalizado: minúsculas, sin acentos). */
  term: z.string().trim().min(1).max(80),
  /** Tags del perfil a las que da evidencia. */
  tags: z.array(TagSchema).min(1).max(50),
  occurrences: z.number().int().min(1),
  /** Énfasis más fuerte entre las líneas donde aparece. */
  emphasis: EmphasisSchema,
  /** Peso final del término. */
  weight: z.number().min(0),
  /** Líneas originales donde aparece (para `--explain`). */
  contexts: z.array(z.string().max(200)).max(5),
});

export const JobRequirementsSchema = z.strictObject({
  /** Términos del vocabulario hallados, de mayor a menor peso (empate: orden de aparición). */
  terms: z.array(RequirementTermSchema).max(500),
  /** Peso por tag: máximo de los pesos de los términos que la evidencian. */
  tagWeights: z.record(z.string(), z.number().min(0)),
  /** Mínimo de años exigido, si la oferta lo dice. */
  experienceYears: z.number().int().min(0).max(60).optional(),
  /** Términos del diccionario presentes en la oferta y ausentes del vocabulario: carencias. */
  gaps: z.array(z.string().trim().min(1).max(80)).max(200),
});

export type Emphasis = z.output<typeof EmphasisSchema>;
export type RequirementTerm = z.output<typeof RequirementTermSchema>;
export type JobRequirements = z.output<typeof JobRequirementsSchema>;

/** Vocabulario del perfil: término normalizado → tags a las que da evidencia. */
export type Vocabulary = ReadonlyMap<string, ReadonlySet<string>>;
