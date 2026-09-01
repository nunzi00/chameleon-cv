/**
 * El contrato de la API para sus clientes (T-7.5, docs/gui-mvp.md §4.1): los esquemas zod de cada cuerpo (de
 * ellos salen los tipos de petición) y los tipos de respuesta de cada ruta, que los manejadores de routes.ts
 * comprueban con `satisfies`. La GUI importa este módulo solo como tipos: si el contrato cambia, su compilador
 * se entera; en el servidor los esquemas validan cada cuerpo.
 */
import { z } from 'zod';

import type { AliasPlanEntry } from '../app/aliases';
import type { AnalysisPayload, OfferAnalysis } from '../app/analyze';
import type { DatasetLoadResult } from '../app/dataset';
import { CV_ENGINES, CV_FORMATS } from '../app/format';
import type { AppWarning } from '../app/freshness';
import type { HistoryEntry } from '../app/history';

export type { HistoryEntry } from '../app/history';
import type { GenerateReport } from '../app/generate';
import type { ApplyOutcome, ReviewFile, ReviewSummary, WrittenFile } from '../app/review';
import type { SourceEntry, SourceFile } from '../app/sources';
import type { OfferListEntry } from '../app/offer';
import type { CreatedTheme, InstalledTheme, ThemeInventory, ThemeVerification } from '../app/themes';
import type { WorkspaceStatus } from '../app/workspace';
import type { MasterProfile } from '../core/schema';
import { SUGGEST_TAGS_LIMITS } from '../llm';
import type { PlanDescription } from '../app/portability';
import type { LlmStatus, QuotaSnapshot } from '../llm';
import type { LocalModelsState, RuntimeState } from '../llm/runtime';
import type { SourceHistoryEntry, SourceHistoryFile } from '../app/source-history';

export type { SourceHistoryEntry, SourceHistoryFile };

export type { LocalModelsState, RuntimeState };
import { LlmSettingsSchema, ServeSettingsSchema, type LlmSettings, type ServeSettings } from '../llm/settings';
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
  /** Y su contrario: todo MENOS estos, tras la selección explícita y antes de los límites por cantidad. */
  excludeSkills: z.array(z.string().min(1).max(160)).max(300).optional(),
  excludeProjects: z.array(z.string().min(1).max(160)).max(100).optional(),
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
  /** Con oferta, conservar las evidencias que demuestran requisitos frente a los límites (T-8.9); por defecto `true`. */
  keepEvidence: z.boolean().optional(),
  ...LimitsSchema,
});
/** El co-piloto como segunda lectura de la oferta (T-9.10): opcional; sin él, cero red y el análisis de siempre. */
export const OfferMapSchema = z.object({
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  /** Confirmación del coste con un proveedor remoto: el estimateId del 409 anterior. */
  consent: z.object({ estimateId: z.string().min(1) }).optional(),
});
export const AnalyzeSchema = z.object({ offer: OfferSchema, specialty: z.string().min(1).optional(), build: z.boolean().optional(), copilot: OfferMapSchema.optional() });
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
/** `POST /jobs/import-map` (T-8.18): refina un borrador de `import/` con el co-piloto; no toca las fuentes. */
export const ImportMapJobSchema = z.object({
  ...ProviderSchema,
  /** Carpeta del borrador dentro de `import/`. */
  name: z.string().trim().min(1).max(120),
});
export type ImportMapJobRequest = z.infer<typeof ImportMapJobSchema>;

/** El resultado del trabajo `import-map`: propuestas verificadas por código y el informe ya actualizado. */
export interface ImportMapJobResult {
  readonly name: string;
  readonly proposals: ReadonlyArray<{ readonly n: number; readonly section: string; readonly reason: string; readonly text: string }>;
  readonly rejected: number;
  readonly skipped: number;
  readonly report: string;
}

/**
 * `PUT /config/llm/keys/{provider}`: guarda la clave de un proveedor remoto en el fichero de claves (0600), el
 * mismo que escribe `cv llm key set`. La clave **solo viaja en este cuerpo**: ninguna respuesta la devuelve, ni
 * siquiera enmascarada, y `GET /config/llm` sigue dando únicamente su procedencia.
 */
export const LlmKeySchema = z.object({ key: z.string().min(1).max(500) });
export type LlmKeyRequest = z.infer<typeof LlmKeySchema>;

/** Lo que se responde tras guardar o borrar: de dónde sale ahora la clave, nunca su valor. */
export interface LlmKeyResponse {
  readonly provider: string;
  /** «env», «file» o «none»; «env» significa que una variable de entorno sigue teniendo precedencia. */
  readonly source: string;
  readonly keysFile: string;
  /** Solo al borrar: si había algo que borrar. */
  readonly removed?: boolean | undefined;
}

/**
 * `POST /import/apply` (T-9.5): mueve UNA línea sin situar del borrador a la sección propuesta. Síncrona y sin
 * modelo: el co-piloto ya propuso, aquí decide y aplica la persona (C2). `fields` trae lo que el esquema exige y
 * la línea no puede dar (empresa, puesto, nivel de idioma…): nada se rellena por defecto.
 */
export const ImportApplySchema = z.object({
  /** Carpeta del borrador dentro de `import/`. */
  name: z.string().trim().min(1).max(120),
  /** Número de línea tal como aparece en «Sin situar» del informe. */
  line: z.int().min(0),
  section: z.string().trim().min(1).max(40),
  fields: z
    .strictObject({
      company: z.string().max(160).optional(),
      role: z.string().max(160).optional(),
      institution: z.string().max(160).optional(),
      degree: z.string().max(160).optional(),
      start: z.string().max(20).optional(),
      end: z.string().max(20).optional(),
      level: z.string().max(20).optional(),
      contact: z.string().max(20).optional(),
      label: z.string().max(60).optional(),
    })
    .optional(),
});
export type ImportApplyRequestBody = z.infer<typeof ImportApplySchema>;

/** El resultado de aplicar: qué se movió, a qué ficheros y el informe ya actualizado. */
/**
 * Guardar como alias lo que el co-piloto tendió (T-9.12): la etiqueta y la frase literal de la oferta, tal como
 * salieron verificadas del análisis. Escribe en `data/sources/skills.csv`, así que es el usuario quien pulsa (C9).
 */
export const AliasesSchema = z.object({
  proposals: z
    .array(z.strictObject({ tag: z.string().min(1).max(80), evidence: z.string().min(1).max(300) }))
    .min(1)
    .max(50),
});
export type AliasesRequest = z.infer<typeof AliasesSchema>;

export interface AliasesResponse {
  /** Qué se decidió con cada propuesta, guardada o no, con su motivo. */
  readonly plan: readonly AliasPlanEntry[];
  /** Las que llegaron al fichero. */
  readonly written: readonly AliasPlanEntry[];
  /** El fichero tocado, relativo al espacio de trabajo. */
  readonly path: string;
}

export interface ImportApplyResponse {
  readonly name: string;
  readonly section: string;
  readonly line: number;
  readonly text: string;
  /** Ficheros del borrador que cambiaron; vacío al descartar. */
  readonly written: readonly string[];
  readonly report: string;
}

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
export { LlmSettingsSchema, ServeSettingsSchema };
export type LlmSettingsWriteRequest = LlmSettings;
export type ServeSettingsWriteRequest = ServeSettings;

export const LlmCheckSchema = z.object({
  /** Proveedor a comprobar (local o del registro); sin él, el local efectivo. */
  provider: z.string().trim().min(1).max(40).optional(),
  model: z.string().trim().min(1).max(120).optional(),
});

export type LlmCheckRequest = z.infer<typeof LlmCheckSchema>;

/** POST /llm/runtime (T-8.8): arrancar (como trabajo `ollama-up`) o parar el Ollama local. */
export const LlmRuntimeActionSchema = z.object({
  action: z.enum(['up', 'down']),
  /** Modelo solo para este arranque; por defecto, el configurado. */
  model: z.string().trim().min(1).max(128).optional(),
  runner: z.enum(['native', 'docker']).optional(),
  /** `false`: no descargar el modelo si falta. */
  pull: z.boolean().optional(),
  /** De dónde descargar (T-8.13): el registro de Ollama (con el espejo como reserva) o directamente Hugging Face. */
  source: z.enum(['ollama', 'huggingface']).optional(),
});
export type LlmRuntimeActionRequest = z.infer<typeof LlmRuntimeActionSchema>;
/** GET /llm/models (T-8.13): el catálogo de modelos locales con lo descargado. */
export type LlmModelsResponse = LocalModelsState;
export interface LlmRuntimeResponse {
  readonly runtime: RuntimeState;
}
/** `down`: el estado tras parar y lo que se hizo. (`up` responde 202 con `JobCreatedResponse`.) */
export interface LlmRuntimeDownResponse {
  readonly runtime: RuntimeState;
  readonly lines: readonly string[];
}
export type LlmRuntimeActionResponse = JobCreatedResponse | LlmRuntimeDownResponse;
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
  /**
   * `allowed`: lo que rige AHORA en el proceso. `configured`: lo que dice `[serve] allow_remote` de cv.toml
   * (`undefined` si no está). `pending`: la configuración difiere de lo vigente y hace falta reiniciar (T-8.17).
   */
  readonly remote: { readonly allowed: boolean; readonly configured: boolean | undefined; readonly pending: boolean };
}
export interface LlmConfigWriteResponse {
  readonly path: string;
  readonly sha256: string;
  readonly llm: LlmSettings;
}
/** PUT /config/serve: la tabla `[serve]` de cv.toml (T-8.17); se aplica al reiniciar el servidor. */
export interface ServeConfigWriteResponse {
  readonly path: string;
  readonly sha256: string;
  readonly serve: ServeSettings;
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
export type GenerateReportPayload = Pick<GenerateReport, 'selection' | 'match' | 'limits' | 'removed' | 'kept' | 'theme'>;
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
  /** Procesamientos previos de la oferta (huella del texto), del más reciente al más antiguo; vacío sin oferta. */
  readonly history: readonly HistoryEntry[];
  readonly warnings: readonly AppWarning[];
}
/** `GET /offers` (T-8.5 S2): el listado de offers/ (≤ 3 niveles, ≤ 500), de la más reciente a la más antigua. */
export interface OffersListResponse {
  readonly files: readonly OfferListEntry[];
}

/** `POST /offers/fetch` (T-8.5 S2): sin consent, 409 consent-required con estimateId; con él, la descarga única. */
export const OfferFetchSchema = z.object({
  url: z.string().trim().min(1),
  consent: z.object({ estimateId: z.string() }).optional(),
});
export type OfferFetchRequest = z.infer<typeof OfferFetchSchema>;
export interface OfferFetchResponse {
  readonly text: string;
  readonly title?: string | undefined;
  readonly company?: string | undefined;
  readonly location?: string | undefined;
  /** Procedencia de la extracción: json-ld, json-ld+cuerpo, contenido o página. */
  readonly source: string;
  readonly warnings: readonly string[];
  readonly origin: { readonly url: string; readonly fetchedAt: string; readonly kind: 'html' | 'pdf' | 'texto'; readonly bytes: number };
}

/** `POST /offers` (T-8.5 S2): guarda el texto en offers/ (ruta saneada); 409 si existe salvo replace. */
export const OfferSaveSchema = z.object({
  path: z.string().trim().min(1),
  text: z.string().min(1),
  origin: z.object({ url: z.string().trim().min(1) }).optional(),
  replace: z.boolean().optional(),
});
export type OfferSaveRequest = z.infer<typeof OfferSaveSchema>;
export interface OfferSaveResponse {
  readonly path: string;
}

/** `POST /import-cv` (T-8.4b): el CV maquetado (cuerpo binario PDF/DOCX) importado como borrador en import/<nombre>/. */
export interface ImportCvResponse {
  /** Carpeta del borrador (`import/<nombre>`). */
  readonly name: string;
  /** Ficheros escritos (README incluido). */
  readonly files: number;
  readonly counts: {
    readonly experience: number;
    readonly projects: number;
    readonly education: number;
    readonly certifications: number;
    readonly skills: number;
    readonly achievements: number;
    readonly languages: number;
  };
  readonly issues: ReadonlyArray<{ readonly reason: string; readonly line?: number | undefined }>;
  readonly unparsed: ReadonlyArray<{ readonly line: number; readonly text: string }>;
  /** El informe (README.md del borrador), para mostrarlo tal cual. */
  readonly readme: string;
}

/** `POST /offers/history`: consulta de solo lectura del historial de una oferta. */
export const HistoryLookupSchema = z.object({ offer: OfferSchema });
export type HistoryLookupRequest = z.infer<typeof HistoryLookupSchema>;
export interface HistoryLookupResponse {
  readonly entries: readonly HistoryEntry[];
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
/** Histórico de versiones de las fuentes (T-8.10). */
export const HistoryVersionSchema = z.object({
  /** Id de la entrada o `latest` (la más reciente que guarde la ruta). */
  entry: z.string().trim().min(1).max(200),
  /** Ruta relativa al directorio de fuentes. */
  path: z.string().trim().min(1).max(300),
});
export type HistoryVersionRequest = z.infer<typeof HistoryVersionSchema>;
export interface SourceHistoryResponse {
  readonly entries: readonly SourceHistoryEntry[];
}
export interface SourceVersionResponse {
  readonly entry: SourceHistoryEntry;
  readonly file: SourceHistoryFile;
  readonly content: string;
}
export interface SourceRestoreResponse {
  readonly path: string;
  readonly entry: SourceHistoryEntry;
}
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
