/**
 * Tarea `import map` (T-8.4b F2, docs/cv-import.md §2.2): el co-piloto propone a qué sección pertenecen las
 * líneas que el importador determinista dejó SIN SITUAR. El modelo solo clasifica dentro de un **vocabulario
 * cerrado**; el código verifica cada propuesta (la línea existe, la sección es del vocabulario, una por línea)
 * y NADA se escribe en el borrador: las propuestas viajan al informe para que quien revisa decida (C2).
 */
import { z } from 'zod';

import { createRedaction, type Redaction } from '../../core/llm/redact';
import type { LlmCompletion, LlmErrorCode, LlmProvider, LlmUsage } from '../provider';
import { loadPrompt, type PromptSource } from './improve';

export const IMPORT_MAP_PROMPT_VERSION = 'import-map.v1';
export const IMPORT_MAP_LIMITS = { maxLines: 40, maxText: 200, maxTokens: 900 } as const;

/** Vocabulario cerrado de secciones; `descartar` es una propuesta legítima (cabeceras, restos de maquetación). */
export const IMPORT_SECTIONS = ['experiencia', 'formacion', 'proyecto', 'certificacion', 'habilidad', 'idioma', 'logro', 'resumen', 'contacto', 'descartar'] as const;
export type ImportSection = (typeof IMPORT_SECTIONS)[number];

/** Lo único que sale hacia el modelo: líneas seudonimizadas con su número, sin fichero ni datos de contacto. */
export const ImportMapInputSchema = z.strictObject({
  locale: z.string(),
  lines: z
    .array(z.strictObject({ n: z.int().min(0), text: z.string().min(1).max(IMPORT_MAP_LIMITS.maxText) }))
    .min(1)
    .max(IMPORT_MAP_LIMITS.maxLines),
});

/** Validación tolerante en `section` (grafía libre): la verificación contra el vocabulario es del código. */
export const ImportMapOutputSchema = z.strictObject({
  proposals: z.array(z.strictObject({ n: z.int(), section: z.string().min(1).max(40), reason: z.string().max(200) })).max(IMPORT_MAP_LIMITS.maxLines * 2),
});

export type ImportMapInput = z.output<typeof ImportMapInputSchema>;
export type ImportMapOutput = z.output<typeof ImportMapOutputSchema>;

export interface ImportMapLine {
  readonly n: number;
  readonly text: string;
}

export interface ImportMapFragment {
  readonly input: ImportMapInput;
  readonly redaction: Redaction;
}

export interface ImportMapProposal {
  readonly n: number;
  readonly section: ImportSection;
  readonly reason: string;
  /** La línea original (sin seudónimos), para que el informe se lea sin volver al PDF. */
  readonly text: string;
}

export type ImportMapErrorCode = LlmErrorCode | 'invalid-output';

export type ImportMapResult =
  | {
      readonly ok: true;
      readonly proposals: readonly ImportMapProposal[];
      /** Propuestas que el código rechazó (línea inexistente, sección desconocida o repetida). */
      readonly rejected: number;
      readonly raw: string;
      readonly json: unknown;
      readonly model: string;
      readonly usage: LlmUsage;
      readonly elapsedMs: number;
      readonly promptVersion: string;
    }
  | { readonly ok: false; readonly code: ImportMapErrorCode; readonly message: string };

/** JSON Schema para el proveedor: `section` restringida al vocabulario (`enum`). */
export function importMapJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['proposals'],
    properties: {
      proposals: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['n', 'section', 'reason'],
          properties: { n: { type: 'integer' }, section: { type: 'string', enum: [...IMPORT_SECTIONS] }, reason: { type: 'string' } },
        },
      },
    },
  };
}

/** Prepara el fragmento: recorta a los límites, seudonimiza (C4) y numera las líneas. */
export function importMapFragment(lines: readonly ImportMapLine[], options: { readonly fullName?: string | undefined; readonly locale?: string | undefined } = {}): ImportMapFragment | undefined {
  const redaction = createRedaction({ fullName: options.fullName ?? '' });
  const usable = lines
    .map((line) => ({ n: line.n, text: redaction.redact(line.text.trim()).slice(0, IMPORT_MAP_LIMITS.maxText) }))
    .filter((line) => line.text !== '')
    .slice(0, IMPORT_MAP_LIMITS.maxLines);
  if (usable.length === 0) {
    return undefined;
  }
  return { input: ImportMapInputSchema.parse({ locale: options.locale ?? 'es', lines: usable }), redaction };
}

function asSection(value: string): ImportSection | undefined {
  const key = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return IMPORT_SECTIONS.find((section) => section === key);
}

/** Valida la respuesta y verifica cada propuesta contra las líneas enviadas (C2): nada se acepta a ciegas. */
export function interpretImportMap(fragment: ImportMapFragment, original: readonly ImportMapLine[], completion: LlmCompletion): ImportMapResult {
  if (!completion.ok) {
    return { ok: false, code: completion.code, message: completion.message };
  }
  const output = ImportMapOutputSchema.safeParse(completion.json);
  if (!output.success) {
    return { ok: false, code: 'invalid-output', message: `La respuesta no cumple el esquema de «import map»: ${output.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}` };
  }
  const sent = new Map(fragment.input.lines.map((line) => [line.n, line.n]));
  const texts = new Map(original.map((line) => [line.n, line.text]));
  const seen = new Set<number>();
  const proposals: ImportMapProposal[] = [];
  let rejected = 0;
  for (const proposal of output.data.proposals) {
    const section = asSection(proposal.section);
    const text = texts.get(proposal.n);
    if (section === undefined || !sent.has(proposal.n) || text === undefined || seen.has(proposal.n)) {
      rejected += 1;
      continue;
    }
    seen.add(proposal.n);
    proposals.push({ n: proposal.n, section, reason: fragment.redaction.restore(proposal.reason), text });
  }
  return {
    ok: true,
    proposals,
    rejected,
    raw: completion.raw,
    json: completion.json,
    model: completion.model,
    usage: completion.usage,
    elapsedMs: completion.elapsedMs,
    promptVersion: IMPORT_MAP_PROMPT_VERSION,
  };
}

export function loadImportMapPrompt(source?: PromptSource): Promise<string> {
  return loadPrompt(IMPORT_MAP_PROMPT_VERSION, source);
}

export function importMapMessages(fragment: ImportMapFragment, prompt: string): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    { role: 'system', content: prompt },
    { role: 'user', content: JSON.stringify(fragment.input) },
  ];
}

/** Envía el fragmento al proveedor (vocabulario como `enum`) e interpreta la respuesta. */
export async function runImportMap(provider: LlmProvider, fragment: ImportMapFragment, original: readonly ImportMapLine[], prompt: string, timeoutMs?: number, signal?: AbortSignal): Promise<ImportMapResult> {
  const completion = await provider.complete({
    messages: importMapMessages(fragment, prompt),
    schema: importMapJsonSchema(),
    schemaName: 'import-map',
    // Modelos que razonan (p. ej. gpt-oss en Groq): el suelo del registro evita la generación vacía.
    maxTokens: Math.max(IMPORT_MAP_LIMITS.maxTokens, provider.outputTokensFloor ?? 0),
    timeoutMs,
    signal,
  });
  return interpretImportMap(fragment, original, completion);
}
