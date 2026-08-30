/**
 * Cliente tipado de /api/v1 (docs/gui-mvp.md §4.1): `fetch` inyectable, `Authorization: Bearer` en cada petición,
 * identificadores relativos codificados por segmento, `If-Match` en las escrituras y la envoltura de error del
 * servidor convertida en `ApiError`. Sin caché ni estado: la verdad está en el servidor.
 */
import type {
  ImportCvResponse,
  AnalyzeRequest,
  AnalyzeResponse,
  ApplyRequest,
  ApplyResponse,
  BuildResponse,
  ErrorResponse,
  ExportResponse,
  ExtractResponse,
  GenerateRequest,
  GenerateResponse,
  ImportRequest,
  ImportResponse,
  ImproveJobRequest,
  JobCreatedResponse,
  JobResponse,
  JobsResponse,
  LlmCheckRequest,
  LlmRuntimeActionRequest,
  LlmRuntimeActionResponse,
  LlmRuntimeResponse,
  LlmModelsResponse,
  HistoryVersionRequest,
  SourceHistoryResponse,
  SourceRestoreResponse,
  SourceVersionResponse,
  LlmCheckResponse,
  LlmConfigResponse,
  LlmConfigWriteResponse,
  LlmSettingsWriteRequest,
  OutputListResponse,
  ProfileResponse,
  ReviewDeleteResponse,
  ReviewResponse,
  ReviewWriteResponse,
  ReviewsResponse,
  ShutdownResponse,
  SourceResponse,
  SourceWriteResponse,
  SourcesResponse,
  StatusResponse,
  SuggestTagsJobRequest,
  SummarizeJobRequest,
  ThemeCreateRequest,
  ThemeCreateResponse,
  ThemeInstallRequest,
  ThemeInstallResponse,
  ThemeVerifyResponse,
  ThemesResponse,
  ValidateResponse,
  HistoryLookupRequest,
  HistoryLookupResponse,
} from './types';
import { bodyChunks, sseEvents, type SseEvent } from './sse';

/** El cuerpo de un error: el del contrato o, sin envoltura, uno sintético (`http`). */
export interface ErrorBody {
  readonly code: string;
  readonly message: string;
  readonly lines?: readonly string[] | undefined;
  readonly [detail: string]: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly lines: readonly string[];
  readonly details: Readonly<Record<string, unknown>>;

  constructor(status: number, error: ErrorBody) {
    super(error.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = error.code;
    const { code: _code, message: _message, lines, ...details } = error;
    this.lines = Array.isArray(lines) ? lines.map(String) : [];
    this.details = details;
  }
}

/** No hubo respuesta: cv serve no está en marcha o la red local falló. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super(`No se pudo conectar con cv serve: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'NetworkError';
  }
}

export interface ApiClientOptions {
  readonly fetch: typeof fetch;
  /** El token de sesión vigente; sin él las peticiones salen sin cabecera y el servidor responde 401. */
  readonly token: () => string | undefined;
  readonly base?: string | undefined;
}

export interface ApiClient {
  status(): Promise<StatusResponse>;
  validate(): Promise<ValidateResponse>;
  build(): Promise<BuildResponse>;
  profile(): Promise<ProfileResponse>;
  sources(): Promise<SourcesResponse>;
  source(path: string): Promise<SourceResponse>;
  /** `ifMatch`: la huella leída, o «*» para crear. */
  writeSource(path: string, content: string, ifMatch: string): Promise<SourceWriteResponse>;
  generate(body: GenerateRequest): Promise<GenerateResponse>;
  analyze(body: AnalyzeRequest): Promise<AnalyzeResponse>;
  /** Historial de una oferta (solo lectura): procesamientos previos por la huella de su texto. */
  offerHistory(body: HistoryLookupRequest): Promise<HistoryLookupResponse>;
  /** Un PDF (bytes) → su texto, extraído en el worker aislado del servidor. */
  extractOffer(pdf: Blob): Promise<ExtractResponse>;
  /** POST /import-cv (T-8.4b): el CV (PDF/DOCX) como borrador en import/<nombre>/; 409 conflict si ya existe sin replace. */
  importCv(file: Blob, options?: { readonly name?: string; readonly replace?: boolean }): Promise<ImportCvResponse>;
  themes(): Promise<ThemesResponse>;
  createTheme(body: ThemeCreateRequest): Promise<ThemeCreateResponse>;
  /** 200 plan (dryRun) o 201 instalado; 403 remote-disabled y 409 consent-required llegan como ApiError con sus detalles. */
  installTheme(body: ThemeInstallRequest): Promise<ThemeInstallResponse>;
  verifyTheme(name: string): Promise<ThemeVerifyResponse>;
  outputs(): Promise<OutputListResponse>;
  /** Un fichero de output/ tal cual (PDF o Markdown), con su tipo. */
  output(name: string): Promise<OutputFile>;
  jobs(): Promise<JobsResponse>;
  job(id: string): Promise<JobResponse>;
  /** 202 con el trabajo encolado; 403 remote-disabled y 409 consent-required llegan como ApiError con sus detalles. */
  startJob(request: JobRequest): Promise<JobCreatedResponse>;
  cancelJob(id: string): Promise<JobResponse>;
  /** Los eventos del trabajo (status, line) hasta que termina; `signal` deja de escuchar (no cancela el trabajo). */
  jobEvents(id: string, signal?: AbortSignal): AsyncIterable<SseEvent>;
  reviews(): Promise<ReviewsResponse>;
  review(name: string): Promise<ReviewResponse>;
  /** Guarda la revisión editada (marcas) con la huella leída en If-Match. */
  writeReview(name: string, content: string, ifMatch: string): Promise<ReviewWriteResponse>;
  deleteReview(name: string): Promise<ReviewDeleteResponse>;
  /** Sin `dryRun: false` solo devuelve el plan; con él escribe en las fuentes (C9). */
  applyReview(name: string, body: ApplyRequest): Promise<ApplyResponse>;
  /** El perfil canónico desde las fuentes (cv export). */
  exportProfile(): Promise<ExportResponse>;
  /** Sin `dryRun: false` solo el plan y el auto-chequeo; con él regenera las fuentes (C9). */
  importProfile(body: ImportRequest): Promise<ImportResponse>;
  /** La configuración del co-piloto: efectiva, cv.toml con huella, proveedores del registro (sin claves) y cuota viva. */
  llmConfig(): Promise<LlmConfigResponse>;
  /** Guarda la tabla [llm] de cv.toml con la huella leída (o «*» si no existe). */
  writeLlmConfig(body: LlmSettingsWriteRequest, ifMatch: string): Promise<LlmConfigWriteResponse>;
  /** Una llamada de salud explícita a un proveedor (los remotos exigen --allow-remote en el servidor). */
  checkLlm(body: LlmCheckRequest): Promise<LlmCheckResponse>;
  /** El Ollama local: si responde, si lo arrancó cv, si el modelo está descargado y con qué runner arrancaría (T-8.8). */
  llmRuntime(): Promise<LlmRuntimeResponse>;
  /** El catálogo de modelos locales con lo descargado (T-8.13). */
  llmModels(): Promise<LlmModelsResponse>;
  /** «up» devuelve el trabajo `ollama-up` (202); «down» para lo que arrancó cv y devuelve el estado. */
  llmRuntimeAction(body: LlmRuntimeActionRequest): Promise<LlmRuntimeActionResponse>;
  /** El histórico de versiones de las fuentes (T-8.10), de la más reciente a la más antigua. */
  sourceHistory(): Promise<SourceHistoryResponse>;
  /** Una versión guardada (`entry` = id o «latest»). */
  sourceVersion(body: HistoryVersionRequest): Promise<SourceVersionResponse>;
  /** Escribe la versión guardada sobre la fuente; la actual queda en el histórico (C9: acción explícita). */
  restoreSourceVersion(body: HistoryVersionRequest): Promise<SourceRestoreResponse>;
  shutdown(): Promise<ShutdownResponse>;
}

export type JobKind = 'improve' | 'summarize' | 'suggest-tags' | 'ollama-up';

export type JobRequest =
  | { readonly kind: 'improve'; readonly body: ImproveJobRequest }
  | { readonly kind: 'summarize'; readonly body: SummarizeJobRequest }
  | { readonly kind: 'suggest-tags'; readonly body: SuggestTagsJobRequest };

export interface OutputFile {
  readonly name: string;
  readonly contentType: string;
  readonly blob: Blob;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface RequestInit {
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>> | undefined;
}

interface RawInit {
  readonly body?: Blob | undefined;
  readonly contentType?: string | undefined;
  readonly accept?: string | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly signal?: AbortSignal | undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  return typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'object' && value.error !== null && 'code' in value.error && 'message' in value.error;
}

/** Cada segmento del identificador se codifica por separado: la barra es parte de la ruta de la API. */
export function encodeId(id: string): string {
  return id.split('/').map(encodeURIComponent).join('/');
}

/** La cabecera If-Match: la huella entrecomillada, o «*» tal cual. */
export function ifMatchHeader(value: string): string {
  return value === '*' ? '*' : `"${value}"`;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const base = options.base ?? '/api/v1';
  /** Una petición cruda: cabeceras comunes, cuerpo opcional y el error del servidor convertido si lo hay. */
  async function raw(method: Method, path: string, init: RawInit = {}): Promise<Response> {
    const headers: Record<string, string> = { Accept: init.accept ?? 'application/json', ...(init.headers ?? {}) };
    const token = options.token();
    if (token !== undefined) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (init.contentType !== undefined) {
      headers['Content-Type'] = init.contentType;
    }
    let response: Response;
    try {
      response = await options.fetch(`${base}${path}`, { method, headers, body: init.body ?? null, ...(init.signal === undefined ? {} : { signal: init.signal }) });
    } catch (error) {
      throw new NetworkError(error);
    }
    if (!response.ok) {
      const json = parseJson(await response.text());
      throw new ApiError(response.status, isErrorResponse(json) ? json.error : { code: 'http', message: `HTTP ${response.status}` });
    }
    return response;
  }
  async function request<T>(method: Method, path: string, init: RequestInit = {}): Promise<T> {
    const response = await raw(method, path, { body: init.body === undefined ? undefined : new Blob([JSON.stringify(init.body)], { type: 'application/json' }), contentType: init.body === undefined ? undefined : 'application/json', headers: init.headers });
    const text = await response.text();
    return (text === '' ? undefined : parseJson(text)) as T;
  }
  const requestWithHeaders = <T>(method: Method, path: string, body: unknown, headers: Readonly<Record<string, string>>): Promise<T> => request<T>(method, path, { body, headers });
  return {
    status: () => request('GET', '/status'),
    validate: () => request('POST', '/validate', { body: {} }),
    build: () => request('POST', '/build', { body: {} }),
    profile: () => request('GET', '/profile'),
    sources: () => request('GET', '/sources'),
    source: (path) => request('GET', `/sources/${encodeId(path)}`),
    writeSource: (path, content, ifMatch) => requestWithHeaders('PUT', `/sources/${encodeId(path)}`, { content }, { 'If-Match': ifMatchHeader(ifMatch) }),
    generate: (body) => request('POST', '/generate', { body }),
    analyze: (body) => request('POST', '/analyze-offer', { body }),
    offerHistory: (body) => request('POST', '/offers/history', { body }),
    extractOffer: async (pdf) => {
      const response = await raw('POST', '/offers/extract', { body: pdf, contentType: 'application/pdf' });
      return parseJson(await response.text()) as ExtractResponse;
    },
    importCv: async (file, options = {}) => {
      const headers: Record<string, string> = { ...(options.name === undefined ? {} : { 'x-cv-import-name': options.name }), ...(options.replace === true ? { 'x-cv-import-replace': '1' } : {}) };
      const response = await raw('POST', '/import-cv', { body: file, contentType: 'application/pdf', headers });
      return (await response.json()) as ImportCvResponse;
    },
    themes: () => request('GET', '/themes'),
    createTheme: (body) => request('POST', '/themes', { body }),
    installTheme: (body) => request('POST', '/themes/install', { body }),
    verifyTheme: (name) => request('POST', `/themes/${encodeId(name)}/verify`, { body: {} }),
    outputs: () => request('GET', '/output'),
    output: async (name) => {
      const response = await raw('GET', `/output/${encodeId(name)}`, { accept: '*/*' });
      return { name, contentType: response.headers.get('content-type') ?? 'application/octet-stream', blob: await response.blob() };
    },
    jobs: () => request('GET', '/jobs'),
    job: (id) => request('GET', `/jobs/${encodeId(id)}`),
    startJob: (job) => request('POST', `/jobs/${job.kind}`, { body: job.body }),
    cancelJob: (id) => request('DELETE', `/jobs/${encodeId(id)}`),
    jobEvents: (id, signal) =>
      (async function* events(): AsyncGenerator<SseEvent, void, undefined> {
        const response = await raw('GET', `/jobs/${encodeId(id)}/events`, { accept: 'text/event-stream', signal });
        yield* sseEvents(bodyChunks(response));
      })(),
    reviews: () => request('GET', '/reviews'),
    review: (name) => request('GET', `/reviews/${encodeId(name)}`),
    writeReview: (name, content, ifMatch) => requestWithHeaders('PUT', `/reviews/${encodeId(name)}`, { content }, { 'If-Match': ifMatchHeader(ifMatch) }),
    deleteReview: (name) => request('DELETE', `/reviews/${encodeId(name)}`),
    applyReview: (name, body) => request('POST', `/reviews/${encodeId(name)}/apply`, { body }),
    exportProfile: () => request('GET', '/export'),
    importProfile: (body) => request('POST', '/import', { body }),
    llmConfig: () => request('GET', '/config/llm'),
    writeLlmConfig: (body, ifMatch) => requestWithHeaders('PUT', '/config/llm', body, { 'If-Match': ifMatchHeader(ifMatch) }),
    checkLlm: (body) => request('POST', '/config/llm/check', { body }),
    llmRuntime: () => request('GET', '/llm/runtime'),
    llmModels: () => request('GET', '/llm/models'),
    llmRuntimeAction: (body) => request('POST', '/llm/runtime', { body }),
    sourceHistory: () => request('GET', '/history'),
    sourceVersion: (body) => request('POST', '/history/version', { body }),
    restoreSourceVersion: (body) => request('POST', '/history/restore', { body }),
    shutdown: () => request('POST', '/shutdown', { body: {} }),
  };
}
