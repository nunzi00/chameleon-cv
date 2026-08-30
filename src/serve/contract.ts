/**
 * El contrato de la API para sus clientes (T-7.5, docs/gui-mvp.md §4.1): los esquemas zod de cada cuerpo (de
 * ellos salen los tipos de petición) y los tipos de respuesta de cada ruta, que los manejadores de routes.ts
 * comprueban con `satisfies`. La GUI importa este módulo solo como tipos: si el contrato cambia, su compilador
 * se entera; en el servidor los esquemas validan cada cuerpo.
 */
import { z } from 'zod';

import type { AnalysisPayload, OfferAnalysis } from '../app/analyze';
import type { DatasetLoadResult } from '../app/dataset';
import { CV_ENGINES, CV_FORMATS } from '../app/format';
import type { AppWarning } from '../app/freshness';
import type { GenerateReport } from '../app/generate';
import type { ApplyOutcome, ReviewFile, ReviewSummary, WrittenFile } from '../app/review';
import type { SourceEntry, SourceFile } from '../app/sources';
import type { CreatedTheme, InstalledTheme, ThemeInventory, ThemeVerification } from '../app/themes';
import type { WorkspaceStatus } from '../app/workspace';
import type { MasterProfile } from '../core/schema';
import { SUGGEST_TAGS_LIMITS } from '../llm';
import type { PlanDescription } from '../app/portability';
import type { LlmStatus, QuotaSnapshot } from '../llm';
import { LlmSettingsSchema, type LlmSettings } from '../llm/settings';
import type { ServerErrorCode } from './http';
import type { JobSnapshot } from './jobs';

/* ---------- Peticiones: esquemas y tipos ---------- */

export const OUTPUT_NAME = /^[\w.-]+$/;

export const OfferSchema = z.union([z.object({ text: z.string().min(1) }), z.object({ workspaceFile: z.string().min(1) })]);
export const LimitsSchema = {
  topN: z.number().int().min(0).optional(),
  maxSkills: z.number().int().min(0).optional(),
  maxProjects: z.number().int().min(0).optional(),
  maxCertifications: z.number().int().min(0).optional(),
  compact: z.boolean().optional(),
};
/** Selección explícita de skills y proyectos (ids o nombres); se aplica antes de los límites por cantidad. */
export const IncludeSchema = {
  skills: z.array(z.string().min(1).max(160)).max(300).optional(),
  projects: z.array(z.string().min(1).max(160)).max(100).optional(),
};
export const GenerateSchema = z.object({
  ...IncludeSchema,
  specialty: z.string().min(1).optional(),
  offer: OfferSchema.optional(),
  format: z.enum(CV_FORMATS).optional(),
  engine: z.enum(CV_ENGINES).optional(),
  theme: z.string().min(1).optional(),
  locale: z.string().min(1).optional(),
  template: z.object({ workspaceFile: z.string().min(1) }).optional(),
  /** Nombre del fichero en `output/` (sin directorios); por defecto el de la CLI. */
  output: z.string().regex(OUTPUT_NAME).optional(),
  build: z.boolean().optional(),
  ...LimitsSchema,
});
export const AnalyzeSchema = z.object({ offer: OfferSchema, specialty: z.string().min(1).optional(), build: z.boolean().optional() });
export const SourceWriteSchema = z.object({ content: z.string() });
export const ThemeCreateSchema = z.object({ name: z.string().min(1), from: z.string().min(1).optional() });
/** `cv theme install` por la API (T-8.3): un `source` https exige --allow-remote y el consentimiento en dos pasos. */
export const ThemeInstallSchema = z.object({
  source: z.string().min(1),
  name: z.string().min(1).optional(),
  sha256: z.string().min(1).optional(),
  dryRun: z.boolean().optional(),
  replace: z.boolean().optional(),
  /** Confirmación de la descarga: el estimateId del 409 anterior. */
  consent: z.object({ estimateId: z.string().min(1) }).optional(),
});
export const EmptySchema = z.object({});
export const ProviderSchema = {
  /** Proveedor configurado (`cv llm status`); un remoto exige --allow-remote y consentimiento. */
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  /** Confirmación del coste de un remoto: el estimateId del 409 anterior. */
  consent: z.object({ estimateId: z.string().min(1) }).optional(),
  /** Leer y guardar la caché local de respuestas (por defecto sí). */
  cache: z.boolean().optional(),
  build: z.boolean().optional(),
  redactCompanies: z.boolean().optional(),
  locale: z.string().min(1).optional(),
};
export const SelectionSchema = { specialty: z.string().min(1).optional(), offer: OfferSchema.optional(), ...LimitsSchema };
export const ImproveJobSchema = z.object({
  ...SelectionSchema,
  ...ProviderSchema,
  only: z.array(z.string().min(1)).min(1).optional(),
  proposals: z.number().int().min(1).max(3).optional(),
  maxLength: z.number().int().min(40).max(1000).optional(),
  maxItems: z.number().int().min(1).max(500).optional(),
  /** Nombre del fichero de revisión en `output/` (sin directorios). */
  output: z.string().regex(OUTPUT_NAME).optional(),
});
export const SummarizeJobSchema = z.object({
  ...SelectionSchema,
  ...ProviderSchema,
  paragraphs: z.number().int().min(1).max(3).optional(),
  proposals: z.number().int().min(1).max(3).optional(),
  maxLength: z.number().int().min(100).max(5000).optional(),
  output: z.string().regex(OUTPUT_NAME).optional(),
});
export const SuggestTagsJobSchema = z.object({
  ...ProviderSchema,
  /** Texto suelto; sin él se etiquetan logros del perfil. */
  text: z.string().min(1).optional(),
  specialty: z.string().min(1).optional(),
  only: z.array(z.string().min(1)).min(1).optional(),
  untagged: z.boolean().optional(),
  maxTags: z.number().int().min(1).max(SUGGEST_TAGS_LIMITS.maxTagsCeiling).optional(),
  maxItems: z.number().int().min(1).max(500).optional(),
});
export const ApplySchema = z.object({
  /** Por defecto solo se muestra el plan; `false` escribe en las fuentes (C9). */
  dryRun: z.boolean().optional(),
  deleteReview: z.boolean().optional(),
});

export const ImportSchema = z.object({
  /** El perfil canónico (profile.json) tal cual. */
  profile: z.record(z.string(), z.unknown()),
  /** Sustituir un directorio de fuentes con contenido, apartándolo entero como copia. */
  replace: z.boolean().optional(),
  /** Por defecto solo el plan y el auto-chequeo; `false` escribe en las fuentes (C9). */
  dryRun: z.boolean().optional(),
});

export type ImportRequest = z.infer<typeof ImportSchema>;

/** PUT /config/llm: la tabla `[llm]` de cv.toml (solo local; los remotos solo como modelo por defecto). */
export { LlmSettingsSchema };
export type LlmSettingsWriteRequest = LlmSettings;

export const LlmCheckSchema = z.object({
  /** Proveedor a comprobar (local o del registro); sin él, el local efectivo. */
  provider: z.string().trim().min(1).max(40).optional(),
  model: z.string().trim().min(1).max(120).optional(),
});

export type LlmCheckRequest = z.infer<typeof LlmCheckSchema>;
export type OfferInputBody = z.infer<typeof OfferSchema>;
export type GenerateRequest = z.infer<typeof GenerateSchema>;
export type AnalyzeRequest = z.infer<typeof AnalyzeSchema>;
export type SourceWriteRequest = z.infer<typeof SourceWriteSchema>;
export type ThemeCreateRequest = z.infer<typeof ThemeCreateSchema>;
export type ThemeInstallRequest = z.infer<typeof ThemeInstallSchema>;
export type ImproveJobRequest = z.infer<typeof ImproveJobSchema>;
export type SummarizeJobRequest = z.infer<typeof SummarizeJobSchema>;
export type SuggestTagsJobRequest = z.infer<typeof SuggestTagsJobSchema>;
export type ApplyRequest = z.infer<typeof ApplySchema>;

/* ---------- Respuestas ---------- */

type LoadedDataset = Extract<DatasetLoadResult, { readonly ok: true }>['dataset'];
/** Un problema de las fuentes, tal como lo devuelven 422 de /validate y /build en `issues`. */
export type DatasetIssue = Extract<DatasetLoadResult, { readonly ok: false }>['issues'][number];

export interface StatusResponse {
  readonly version: string;
  readonly workspace: string;
  readonly artifact: WorkspaceStatus['artifact'];
  readonly typst: WorkspaceStatus['typst'];
  readonly llm: WorkspaceStatus['llm'];
  readonly themes: {
    readonly defaultName: ThemeInventory['defaultName'];
    readonly configWarning: ThemeInventory['configWarning'];
    readonly roots: readonly string[];
    readonly entries: ThemeInventory['entries'];
  };
}
export interface SourcesResponse {
  readonly root: string;
  readonly entries: readonly SourceEntry[];
}
export type SourceResponse = SourceFile;
export interface SourceWriteResponse {
  readonly path: string;
  readonly sha256: string;
}
export interface ValidateResponse {
  readonly root: string;
  readonly files: LoadedDataset['files'];
  readonly summary: string;
}
export interface BuildResponse {
  readonly artifactPath: string;
  readonly files: LoadedDataset['files'];
  readonly summary: string;
}
export type ProfileResponse = MasterProfile;
/** GET /export: el perfil canónico desde las fuentes. */
export type ExportResponse = MasterProfile;
/** GET /config/llm: nunca claves, solo procedencias. */
export interface LlmConfigResponse {
  readonly llm: LlmStatus;
  readonly file: { readonly path: string; readonly present: boolean; readonly sha256: string | undefined };
  readonly remote: { readonly allowed: boolean };
}
export interface LlmConfigWriteResponse {
  readonly path: string;
  readonly sha256: string;
  readonly llm: LlmSettings;
}
/** POST /config/llm/check: una llamada de salud, sin datos del usuario. */
export interface LlmCheckResponse {
  readonly provider: string;
  readonly kind: 'local' | 'remote';
  readonly ok: boolean;
  readonly models: readonly string[];
  readonly modelAvailable: boolean;
  readonly message: string | undefined;
  readonly quota: QuotaSnapshot | undefined;
}
export interface ImportResponse {
  readonly root: string;
  readonly dryRun: boolean;
  readonly plan: PlanDescription;
  /** Rutas relativas escritas (vacío con `dryRun`). */
  readonly written: readonly string[];
  /** Directorio al que se apartaron las fuentes anteriores, si las había (ausente si no). */
  readonly backup?: string | undefined;
}
export type GenerateReportPayload = Pick<GenerateReport, 'selection' | 'match' | 'limits' | 'removed' | 'theme'>;
export interface GenerateResponse {
  readonly output: {
    readonly name: string;
    readonly kind: 'md' | 'pdf';
    /** Identificador para GET /output/{name}. */
    readonly path: string;
    readonly markdown?: string | undefined;
    readonly bytes?: number | undefined;
  };
  readonly report: GenerateReportPayload | undefined;
  readonly warnings: readonly AppWarning[];
}
export interface OutputEntry {
  readonly name: string;
  readonly bytes: number;
}
export interface OutputListResponse {
  readonly files: readonly OutputEntry[];
}
export interface AnalyzeResponse extends AnalysisPayload {
  readonly selection: OfferAnalysis['scored']['selection']['report'];
  readonly warnings: readonly AppWarning[];
}
export interface ExtractResponse {
  readonly text: string;
}
export interface ThemesResponse {
  readonly defaultName: ThemeInventory['defaultName'];
  readonly configWarning: ThemeInventory['configWarning'];
  readonly roots: readonly string[];
  readonly entries: ThemeInventory['entries'];
}
export type ThemeCreateResponse = CreatedTheme;
/** 200 con `--dry-run` (nada escrito), 201 instalado. */
export type ThemeInstallResponse = InstalledTheme;
export type ThemeVerifyResponse = ThemeVerification;
export interface ShutdownResponse {
  readonly ok: true;
}
export interface JobCreatedResponse {
  readonly job: JobSnapshot;
  /** Qué sale y a dónde (C3): destino, redacción de empresas y los recuentos de la tarea. */
  readonly sending: Readonly<Record<string, unknown>>;
  readonly warnings: readonly AppWarning[];
}
export interface JobsResponse {
  readonly jobs: readonly JobSnapshot[];
}
export interface JobResponse {
  readonly job: JobSnapshot;
}
export interface ReviewsResponse {
  readonly reviews: readonly ReviewSummary[];
}
export interface ReviewResponse {
  readonly review: ReviewFile;
}
export interface ReviewWriteResponse {
  readonly name: string;
  readonly sha256: string;
}
export interface ReviewDeleteResponse {
  readonly deleted: string;
}
export type ApplyResponse = ApplyOutcome;
export type ApplyErrorDetails = { readonly written: readonly WrittenFile[] };
/** Toda respuesta de error: `{ error: { code, message, lines?, … } }`. */
export interface ErrorResponse {
  readonly error: {
    readonly code: ServerErrorCode;
    readonly message: string;
    readonly lines?: readonly string[] | undefined;
    readonly [detail: string]: unknown;
  };
}
/** Eventos de GET /jobs/{id}/events. */
export type JobEventName = 'status' | 'line';
