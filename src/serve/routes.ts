/**
 * Contrato `/api/v1` (docs/api-headless.md §5): cada ruta es un cliente de la capa de casos de uso y
 * nunca acepta rutas del sistema de ficheros del cliente: solo identificadores relativos y saneados
 * dentro del espacio de trabajo. Los metadatos del registro alimentan la referencia generada.
 */
import { basename, dirname, extname, resolve, sep } from 'node:path';

import { z } from 'zod';

import { analysisPayload, analyzeOffer } from '../app/analyze';
import { lookupHistory, offerFingerprint, readHistory, recordHistory } from '../app/history';
import type { AppContext } from '../app/context';
import { DEFAULT_MAX_ITEMS, checkLocalProvider, describeProvider, executeImprove, executeSuggestTags, executeSummarize, improveEstimate, planImprove, planSuggestTags, planSummarize, selectCopilotProvider, suggestTagsEstimate, summarizeEstimate, writeReview, type ExecuteOptions, type PlanOutcome, type ReviewOutcome } from '../app/copilot';
import { buildProfile, loadProfile, loadSources } from '../app/dataset';
import { environmentError, notFoundError, unsafePathError, type AppError, type AppErrorCode, conflictError, dataError } from '../app/errors';
import { readSourceHistory, readSourceVersion, restoreSourceVersion } from '../app/source-history';
import { generateCv, writeCvFile } from '../app/generate';
import type { AppWarning } from '../app/freshness';
import { readOffer, type OfferInput } from '../app/offer';
import { isSafeSourcePath } from '../app/paths';
import { REVIEW_NAME, applyReview, listReviews, readReview } from '../app/review';
import { contentHash, listSources, readSource, writeSource } from '../app/sources';
import { describePlan, exportProfile, importProfile } from '../app/portability';
import { applyImportProposal } from '../app/import-apply';
import { executeImportMap, importMapEstimate, planImportMap, type ImportMapPlan } from '../app/import-map';
import { loadServeSettings, readConfigFile, writeLlmSettings, writeServeSettings } from '../app/settings';
import { describeKeys, isRemoteProviderId, removeApiKey, writeApiKey, type LlmStatus, type RuntimeErrorCode } from '../llm';
import { profileSummary } from '../app/text';
import { THEME_DOWNLOAD_LIMITS, classifyInstallSource, createTheme, installTheme, themeInventory, verifyThemes } from '../app/themes';
import { importCvDraft } from '../app/import-cv';
import { listOffers } from '../app/offer';
import { OFFER_URL_LIMITS, fetchOffer, offerFetcher } from '../offers';
import { REMOTE_PROVIDERS, outputTokensFloorFor } from '../llm/registry';
import { inspectWorkspace, type WorkspaceStatus } from '../app/workspace';
import { isMissingFile } from '../artifact';
import { IMPROVE_LIMITS, SUGGEST_TAGS_LIMITS, SUMMARIZE_LIMITS, formatCostWarning, formatTagLine, type CostEstimate } from '../llm';
import { DEFAULT_PDF_LIMITS } from '../pdf';
import { describeError } from '../shared/errors';
import { AnalyzeSchema, type LlmModelsResponse, ApplySchema, EmptySchema, GenerateSchema, ImportSchema, ImproveJobSchema, OUTPUT_NAME, OfferSchema, SourceWriteSchema, SuggestTagsJobSchema, SummarizeJobSchema, ThemeCreateSchema, ThemeInstallSchema, type AnalyzeResponse, type ApplyResponse, type BuildResponse, type ExtractResponse, type GenerateResponse, type JobCreatedResponse, type JobResponse, type JobsResponse, type OutputListResponse, type ProfileResponse, type ReviewDeleteResponse, type ReviewResponse, type ReviewWriteResponse, type ReviewsResponse, type ShutdownResponse, type SourceResponse, type SourceWriteResponse, type SourcesResponse, type StatusResponse, type ThemeCreateResponse, type ThemeInstallResponse, type ThemesResponse, type ValidateResponse, type ExportResponse, type ImportResponse, LlmCheckSchema, LlmRuntimeActionSchema, HistoryVersionSchema, LlmSettingsSchema, ServeSettingsSchema, ImportMapJobSchema, type ImportMapJobResult, ImportApplySchema, type ImportApplyResponse, LlmKeySchema, type LlmKeyResponse, type ServeConfigWriteResponse, type LlmCheckResponse, type LlmRuntimeDownResponse, type SourceHistoryResponse, type SourceRestoreResponse, type SourceVersionResponse, type LlmRuntimeResponse, type LlmConfigResponse, type LlmConfigWriteResponse, HistoryLookupSchema, type HistoryLookupResponse, type ImportCvResponse, OfferFetchSchema, OfferSaveSchema, type OffersListResponse, type OfferFetchResponse, type OfferSaveResponse } from './contract';
import type { ConsentStore } from './consent';
import { appErrorResponse, errorResponse, json, parseJsonBody, headerValue } from './http';
import { JobFailure, isFinished, type JobKind, type JobQueue, type JobReport } from './jobs';
import { Router, type RouteRequest, type RouteResponse } from './router';

export interface ServerState {
  readonly context: AppContext;
  readonly data: string;
  readonly profile: string;
  readonly version: string;
  readonly jobs: JobQueue;
  readonly consents: ConsentStore;
  /** `--allow-remote`. */
  readonly allowRemote: boolean;
  /** Detiene el servidor tras responder. */
  readonly shutdown: () => void;
}

export const API_PREFIX = '/api/v1';
const OUTPUT_DIR = 'output';

type WorkspaceFileResult = { readonly ok: true; readonly path: string } | { readonly ok: false; readonly error: AppError };

/** Un identificador relativo y contenido, resuelto contra el espacio de trabajo. */
function workspaceFile(context: AppContext, id: string): WorkspaceFileResult {
  return isSafeSourcePath(id) ? { ok: true, path: resolve(context.cwd, id) } : { ok: false, error: unsafePathError(`Identificador de fichero no válido «${id}»: debe ser relativo, sin «..» ni barras invertidas`) };
}

function offerInputOf(context: AppContext, offer: z.infer<typeof OfferSchema>): OfferInput | AppError {
  if ('text' in offer) {
    return { kind: 'text', text: offer.text };
  }
  const file = workspaceFile(context, offer.workspaceFile);
  return file.ok ? { kind: 'file', path: file.path } : file.error;
}

/** El estado sin objetos no serializables (las raíces de temas llevan un sistema de ficheros). */
function statusPayload(status: WorkspaceStatus, version: string): StatusResponse {
  return {
    version,
    workspace: status.cwd,
    artifact: status.artifact,
    typst: status.typst,
    llm: status.llm,
    themes: { defaultName: status.themes.defaultName, configWarning: status.themes.configWarning, roots: status.themes.roots.map((root) => root.directory), entries: status.themes.entries },
  };
}

function contentTypeOf(name: string): string {
  const extension = extname(name).toLowerCase();
  return extension === '.pdf' ? 'application/pdf' : extension === '.md' ? 'text/markdown; charset=utf-8' : extension === '.json' ? 'application/json' : 'application/octet-stream';
}


/** El resultado de una comprobación de proveedor (POST /config/llm/check), local o remoto, en una sola forma. */
function checkPayload(status: LlmStatus, requested: string): LlmCheckResponse {
  if (status.remote !== undefined) {
    if ('error' in status.remote) {
      return { provider: requested, kind: 'remote', ok: false, models: [], modelAvailable: false, message: status.remote.error, quota: undefined };
    }
    const { id, health, model } = status.remote;
    const live = status.providers.find((provider) => provider.id === id)?.live;
    if (!health.ok) {
      return { provider: id, kind: 'remote', ok: false, models: [], modelAvailable: false, message: health.message, quota: live };
    }
    return { provider: id, kind: 'remote', ok: health.modelAvailable, models: health.models, modelAvailable: health.modelAvailable, message: health.modelAvailable ? undefined : `el modelo configurado «${model}» no está disponible`, quota: live };
  }
  if (status.config === undefined || status.health === undefined) {
    return { provider: requested === '' ? 'local' : requested, kind: 'local', ok: false, models: [], modelAvailable: false, message: status.configError, quota: undefined };
  }
  const { health, config } = status;
  if (!health.ok) {
    return { provider: config.provider, kind: 'local', ok: false, models: [], modelAvailable: false, message: health.message, quota: undefined };
  }
  return { provider: config.provider, kind: 'local', ok: health.modelAvailable, models: health.models, modelAvailable: health.modelAvailable, message: health.modelAvailable ? undefined : `el modelo configurado «${config.model}» no está disponible`, quota: undefined };
}

export function createRouter(): Router<ServerState> {
  const router = new Router<ServerState>();

  router.add({
    method: 'GET',
    path: `${API_PREFIX}/status`,
    summary: 'Versión, espacio de trabajo, estado del artefacto, especialidades, Typst, proveedor local y temas. Nunca sale a la red.',
    writes: false,
    handler: async (_request, state) => json(200, statusPayload(await inspectWorkspace(state.context, { profile: state.profile, data: state.data }), state.version)),
  });

  router.add({
    method: 'GET',
    path: `${API_PREFIX}/sources`,
    summary: 'Árbol de las fuentes: ruta relativa, tamaño, fecha y huella SHA-256 de cada fichero.',
    writes: false,
    handler: async (_request, state) => {
      const result = await listSources(state.context, resolve(state.context.cwd, state.data));
      return result.ok ? json(200, { root: result.root, entries: result.entries } satisfies SourcesResponse) : appErrorResponse(result.error, { issues: result.issues });
    },
  });

  router.add({
    method: 'GET',
    path: `${API_PREFIX}/sources/{path+}`,
    summary: 'Contenido de un fichero de fuentes con su huella (también en la cabecera ETag).',
    writes: false,
    handler: async (request, state) => {
      const result = await readSource(state.context, resolve(state.context.cwd, state.data), String(request.params['path']));
      return result.ok ? json(200, result.file satisfies SourceResponse, { ETag: `"${result.file.sha256}"` }) : appErrorResponse(result.error);
    },
  });

  router.add({
    method: 'PUT',
    path: `${API_PREFIX}/sources/{path+}`,
    summary: 'Escribe un fichero de fuentes por acción explícita del usuario (C9). Exige If-Match con la huella actual, o «*» para crear. Atómico, 0600.',
    writes: true,
    body: SourceWriteSchema,
    handler: async (request, state) => {
      const ifMatch = request.headers['if-match'];
      if (ifMatch === undefined) {
        return errorResponse('precondition-required', 'Falta la cabecera If-Match: la huella actual del fichero, o «*» para crearlo');
      }
      const parsed = parseJsonBody(request.body, SourceWriteSchema);
      if (!parsed.ok) {
        return parsed.response;
      }
      const result = await writeSource(state.context, resolve(state.context.cwd, state.data), { path: String(request.params['path']), content: parsed.value.content, expectedSha256: ifMatch.trim().replace(/^"|"$/g, '') });
      return result.ok ? json(200, { path: result.file.path, sha256: result.file.sha256 } satisfies SourceWriteResponse, { ETag: `"${result.file.sha256}"` }) : appErrorResponse(result.error);
    },
  });

  router.add({
    method: 'POST',
    path: `${API_PREFIX}/validate`,
    summary: 'Comprueba las fuentes sin escribir nada; con problemas, todos a la vez (fichero, línea, mensaje).',
    writes: false,
    body: EmptySchema,
    handler: async (_request, state) => {
      const result = await loadSources(state.context, { data: state.data });
      return result.ok ? json(200, { root: result.dataset.root, files: result.dataset.files, summary: profileSummary(result.dataset.profile) } satisfies ValidateResponse) : appErrorResponse(result.error, { issues: result.issues });
    },
  });

  router.add({
    method: 'POST',
    path: `${API_PREFIX}/build`,
    summary: 'Compila las fuentes y escribe el artefacto canónico (data/dist/profile.json, 0600).',
    writes: true,
    body: EmptySchema,
    handler: async (_request, state) => {
      const result = await buildProfile(state.context, { data: state.data, out: state.profile, check: false });
      return result.ok ? json(200, { artifactPath: result.artifactPath, files: result.dataset.files, summary: profileSummary(result.dataset.profile) } satisfies BuildResponse) : appErrorResponse(result.error, { issues: result.issues });
    },
  });

  router.add({
    method: 'GET',
    path: `${API_PREFIX}/profile`,
    summary: 'El perfil validado (el artefacto, re-validado al leerlo), con los ids de entidades y logros.',
    writes: false,
    handler: async (_request, state) => {
      const result = await loadProfile(state.context, { profile: state.profile });
      return result.ok ? json(200, result.profile satisfies ProfileResponse) : appErrorResponse(result.error);
    },
  });

  router.add({
    method: 'GET',
    path: `${API_PREFIX}/export`,
    summary: 'El perfil canónico desde las fuentes (cv export), sin pasar por el artefacto; con problemas en las fuentes, 422 con todas las líneas.',
    writes: false,
    handler: async (_request, state) => {
      const result = await exportProfile(state.context, { data: state.data });
      return result.ok ? json(200, result.profile satisfies ExportResponse) : appErrorResponse(result.error);
    },
  });

  router.add({
    method: 'POST',
    path: `${API_PREFIX}/import`,
    summary:
      'Regenera las fuentes desde un perfil canónico (cv import): por defecto solo el plan y el auto-chequeo (dryRun); con dryRun:false escribe en un directorio de fuentes vacío o, con replace, tras apartar el existente como copia. 409 si el destino tiene contenido y no hay replace; 422 si el perfil no es válido o no se puede representar.',
    writes: true,
    body: ImportSchema,
    handler: async (request, state) => {
      const parsed = parseJsonBody(request.body, ImportSchema);
      if (!parsed.ok) {
        return parsed.response;
      }
      const result = await importProfile(state.context, parsed.value.profile, { data: state.data, replace: parsed.value.replace, dryRun: parsed.value.dryRun ?? true });
      if (!result.ok) {
        return appErrorResponse(result.error);
      }
      const { outcome } = result;
      return json(200, { root: outcome.root, dryRun: outcome.dryRun, plan: describePlan(outcome.plan), written: outcome.written, backup: outcome.backup } satisfies ImportResponse);
    },
  });

  router.add({
    method: 'GET',
    path: `${API_PREFIX}/config/llm`,
    summary:
      'La configuración efectiva del co-piloto con el origen de cada valor, cv.toml y su huella (ETag), los proveedores del registro (plan, cuota publicada con fuente y fecha, evidencia C7, procedencia de la clave, cuota viva) y si el servidor admite remotos. Nunca claves.',
    writes: false,
    handler: async (_request, state) => {
      const file = await readConfigFile(state.context);
      if ('error' in file) {
        return appErrorResponse(file.error);
      }
      const llm = await state.context.llmStatus({});
      const configured = (await loadServeSettings(state.context.cwd, state.context.datasetFileSystem)).settings?.allow_remote;
      const payload = {
        llm,
        file: { path: file.path, present: file.present, sha256: file.sha256 },
        // `pending`: cv.toml pide otra cosa que lo vigente; se aplica al reiniciar (la CLI siempre gana, T-8.17).
        remote: { allowed: state.allowRemote, configured, pending: configured !== undefined && configured !== state.allowRemote },
      } satisfies LlmConfigResponse;
      return json(200, payload, file.sha256 === undefined ? undefined : { ETag: `"${file.sha256}"` });
    },
  });

  router.add({
    method: 'PUT',
    path: `${API_PREFIX}/config/llm`,
    summary:
      'Guarda la tabla [llm] de cv.toml —proveedor local, URL loopback, modelo y modelos por defecto de los remotos— con sustitución quirúrgica (el resto del fichero no cambia); exige If-Match con la huella actual del fichero, o «*» si no existe.',
    writes: true,
    body: LlmSettingsSchema,
    handler: async (request, state) => {
      const ifMatch = request.headers['if-match'];
      if (ifMatch === undefined) {
        return errorResponse('precondition-required', 'Falta la cabecera If-Match: la huella actual de cv.toml, o «*» para crearlo');
      }
      const parsed = parseJsonBody(request.body, LlmSettingsSchema);
      if (!parsed.ok) {
        return parsed.response;
      }
      const result = await writeLlmSettings(state.context, { settings: parsed.value, expectedSha256: ifMatch.trim().replace(/^"|"$/g, '') });
      return result.ok
        ? json(200, { path: result.path, sha256: result.sha256, llm: result.settings } satisfies LlmConfigWriteResponse, { ETag: `"${result.sha256}"` })
        : appErrorResponse(result.error);
    },
  });

  router.add({
    method: 'PUT',
    path: `${API_PREFIX}/config/serve`,
    summary:
      'Guarda la tabla [serve] de cv.toml —hoy solo allow_remote, el permiso de salida a proveedores remotos— con sustitución quirúrgica; exige If-Match como /config/llm. NO cambia el proceso en marcha: se aplica al reiniciar (C3).',
    writes: true,
    body: ServeSettingsSchema,
    handler: async (request, state) => {
      const ifMatch = request.headers['if-match'];
      if (ifMatch === undefined) {
        return errorResponse('precondition-required', 'Falta la cabecera If-Match: la huella actual de cv.toml, o «*» para crearlo');
      }
      const parsed = parseJsonBody(request.body, ServeSettingsSchema);
      if (!parsed.ok) {
        return parsed.response;
      }
      const result = await writeServeSettings(state.context, { settings: parsed.value, expectedSha256: ifMatch.trim().replace(/^"|"$/g, '') });
      return result.ok
        ? json(200, { path: result.path, sha256: result.sha256, serve: result.settings } satisfies ServeConfigWriteResponse, { ETag: `"${result.sha256}"` })
        : appErrorResponse(result.error);
    },
  });

  router.add({
    method: 'POST',
    path: `${API_PREFIX}/config/llm/check`,
    summary:
      'Comprueba un proveedor con una única llamada de salud sin datos del usuario (lista de modelos y cuota viva si la devuelve); un remoto exige --allow-remote y su clave. Explícito: nunca en segundo plano.',
    writes: false,
    body: LlmCheckSchema,
    handler: async (request, state) => {
      const parsed = parseJsonBody(request.body, LlmCheckSchema);
      if (!parsed.ok) {
        return parsed.response;
      }
      const requested = parsed.value.provider?.trim().toLowerCase() ?? '';
      if (isRemoteProviderId(requested) && !state.allowRemote) {
        return errorResponse('remote-disabled', 'Este servidor no envía nada a proveedores remotos: arráncalo con «cv serve --allow-remote» para permitirlo');
      }
      const status = await state.context.llmStatus({ provider: requested === '' ? undefined : requested, model: parsed.value.model });
      return json(200, checkPayload(status, requested) satisfies LlmCheckResponse);
    },
  });

  router.add({
    method: 'GET',
    path: `${API_PREFIX}/llm/runtime`,
    summary:
      'El Ollama local (T-8.8): si responde, si lo arrancó cv (native o docker), si el modelo configurado está descargado y con qué runner podría arrancarse; deshabilitado dentro de la imagen de Compose.',
    writes: false,
    handler: async (_request, state) => {
      const runtime = state.context.llmRuntime;
      if (runtime === undefined) {
        return errorResponse('environment', 'El runtime de Ollama no está disponible en este servidor');
      }
      return json(200, { runtime: await runtime.status() } satisfies LlmRuntimeResponse);
    },
  });

  router.add({
    method: 'POST',
    path: `${API_PREFIX}/llm/runtime`,
    summary:
      '«up» arranca el Ollama local y descarga el modelo si falta, como trabajo `ollama-up` seguible por SSE (202); «down» para solo lo que arrancó cv y devuelve el estado (200). Nunca toca un Ollama ajeno.',
    writes: true,
    body: LlmRuntimeActionSchema,
    handler: async (request, state) => {
      const parsed = parseJsonBody(request.body, LlmRuntimeActionSchema);
      if (!parsed.ok) {
        return parsed.response;
      }
      const runtime = state.context.llmRuntime;
      if (runtime === undefined) {
        return errorResponse('environment', 'El runtime de Ollama no está disponible en este servidor');
      }
      if (parsed.value.action === 'down') {
        const result = await runtime.down();
        return result.ok
          ? json(200, { runtime: result.state, lines: result.lines } satisfies LlmRuntimeDownResponse)
          : errorResponse(runtimeErrorCode(result.code), result.message, { lines: result.lines });
      }
      const { model, runner, pull, source } = parsed.value;
      const job = state.jobs.create('ollama-up', async (report) => {
        const result = await runtime.up({ model, runner, pull, source, progress: report.line, signal: report.signal });
        if (!result.ok) {
          const code = runtimeErrorCode(result.code);
          throw new JobFailure({ code, message: result.message, lines: result.lines, exitCode: code === 'invalid-data' ? 1 : 2 });
        }
        return { runtime: result.state, lines: result.lines };
      });
      const sending = { destination: 'ninguno: solo la descarga del modelo desde el registro público de Ollama (o su espejo en Hugging Face si el registro falla), sin datos del usuario' };
      return json(202, { job, sending, warnings: [] } satisfies JobCreatedResponse, { Location: `${API_PREFIX}/jobs/${job.id}` });
    },
  });

  router.add({
    method: 'GET',
    path: `${API_PREFIX}/llm/models`,
    summary: 'El catálogo de modelos locales (T-8.13): familia, razonamiento, tamaño, RAM, licencia, tareas y espejo de cada uno, con lo que hay descargado en el Ollama configurado y los modelos presentes fuera del catálogo.',
    writes: false,
    handler: async (_request, state) => {
      const runtime = state.context.llmRuntime;
      if (runtime === undefined) {
        return errorResponse('environment', 'El runtime de Ollama no está disponible en este servidor');
      }
      return json(200, (await runtime.models()) satisfies LlmModelsResponse);
    },
  });

  router.add({
    method: 'GET',
    path: `${API_PREFIX}/history`,
    summary: 'El histórico de versiones de las fuentes (T-8.10): una entrada por aplicación de revisión o restauración, de la más reciente a la más antigua, con los ficheros guardados enteros y sus huellas.',
    writes: false,
    handler: async (_request, state) => json(200, { entries: await readSourceHistory(state.context) } satisfies SourceHistoryResponse),
  });

  router.add({
    method: 'POST',
    path: `${API_PREFIX}/history/version`,
    summary: 'Lee una versión guardada de una fuente: `{ entry, path }` (entry = id o «latest»). Solo lectura.',
    writes: false,
    body: HistoryVersionSchema,
    handler: async (request, state) => {
      const parsed = parseJsonBody(request.body, HistoryVersionSchema);
      if (!parsed.ok) {
        return parsed.response;
      }
      const version = await readSourceVersion(state.context, parsed.value.entry, parsed.value.path);
      return version.ok ? json(200, { entry: version.entry, file: version.file, content: version.content } satisfies SourceVersionResponse) : appErrorResponse(version.error);
    },
  });

  router.add({
    method: 'POST',
    path: `${API_PREFIX}/history/restore`,
    summary: 'Escribe la versión guardada sobre la fuente (`{ entry, path }`); la versión actual queda a su vez en el histórico. Escribe en data/sources (C9: acción explícita).',
    writes: true,
    body: HistoryVersionSchema,
    handler: async (request, state) => {
      const parsed = parseJsonBody(request.body, HistoryVersionSchema);
      if (!parsed.ok) {
        return parsed.response;
      }
      const restored = await restoreSourceVersion(state.context, parsed.value.entry, parsed.value.path, state.context.now?.());
      return restored.ok ? json(200, { path: restored.path, entry: restored.entry } satisfies SourceRestoreResponse) : appErrorResponse(restored.error);
    },
  });

  router.add({
    method: 'POST',
    path: `${API_PREFIX}/generate`,
    summary: 'Genera el CV (Markdown o PDF) y lo escribe en output/. El Markdown va en la respuesta; el PDF se sirve en GET /output/{name}.',
    writes: true,
    body: GenerateSchema,
    handler: async (request, state): Promise<RouteResponse> => {
      const parsed = parseJsonBody(request.body, GenerateSchema);
      if (!parsed.ok) {
        return parsed.response;
      }
      const body = parsed.value;
      let offer: OfferInput | undefined;
      if (body.offer !== undefined) {
        const input = offerInputOf(state.context, body.offer);
        if (!('kind' in input)) {
          return appErrorResponse(input);
        }
        offer = input;
      }
      let templatePath: string | undefined;
      if (body.template !== undefined) {
        const file = workspaceFile(state.context, body.template.workspaceFile);
        if (!file.ok) {
          return appErrorResponse(file.error);
        }
        templatePath = file.path;
      }
      const format = body.format ?? 'md';
      const result = await generateCv(state.context, {
        profile: state.profile,
        data: state.data,
        specialty: body.specialty,
        offer,
        output: body.output === undefined ? undefined : `${OUTPUT_DIR}/${body.output}`,
        templatePath,
        locale: body.locale,
        format,
        engine: body.engine ?? 'pdfkit',
        typstAnyVersion: false,
        theme: body.theme,
        build: body.build ?? false,
        topN: body.topN,
        maxSkills: body.maxSkills,
        maxProjects: body.maxProjects,
        maxCertifications: body.maxCertifications,
        compact: body.compact ?? false,
        skills: body.skills,
        keepEvidence: body.keepEvidence,
        projects: body.projects,
      });
      const report = result.report === undefined ? undefined : { selection: result.report.selection, match: result.report.match, limits: result.report.limits, removed: result.report.removed, kept: result.report.kept, theme: result.report.theme };
      if (!result.ok) {
        return appErrorResponse(result.error, { report, warnings: result.warnings });
      }
      const failure = await writeCvFile(state.context, result.cv);
      if (failure !== undefined) {
        return appErrorResponse(failure, { warnings: result.warnings });
      }
      const name = result.cv.outputPath.slice(resolve(state.context.cwd, OUTPUT_DIR).length + 1);
      const historyWarnings: AppWarning[] = [];
      if (result.history.entry !== undefined) {
        const unwritable = await recordHistory(state.context, result.history.entry);
        if (unwritable !== undefined) {
          historyWarnings.push({ kind: 'history-unwritable', message: unwritable });
        }
      }
      return json(200, { output: { name, kind: result.cv.kind, path: `${OUTPUT_DIR}/${name}`, ...(result.cv.kind === 'md' ? { markdown: result.cv.markdown } : { bytes: result.cv.pdf.byteLength }) }, report, history: result.history.previous, warnings: [...result.warnings, ...historyWarnings] } satisfies GenerateResponse);
    },
  });

  router.add({
    method: 'GET',
    path: `${API_PREFIX}/output`,
    summary: 'Los ficheros de output/ (nombre y tamaño).',
    writes: false,
    handler: async (_request, state) => {
      const directory = resolve(state.context.cwd, OUTPUT_DIR);
      try {
        const entries = await state.context.datasetFileSystem.readDirectory(directory);
        const files = await Promise.all(entries.filter((entry) => entry.kind === 'file').map(async (entry) => ({ name: entry.name, bytes: (await state.context.datasetFileSystem.stat(resolve(directory, entry.name))).size })));
        return json(200, { files: files.sort((a, b) => a.name.localeCompare(b.name, 'en')) } satisfies OutputListResponse);
      } catch (error) {
        return isMissingFile(error) ? json(200, { files: [] } satisfies OutputListResponse) : appErrorResponse(environmentError(`No se pudo leer ${directory}: ${describeError(error)}`));
      }
    },
  });

  router.add({
    method: 'GET',
    path: `${API_PREFIX}/output/{name}`,
    summary: 'Sirve un fichero de output/ (PDF o Markdown) por su nombre.',
    writes: false,
    handler: async (request, state) => {
      const name = String(request.params['name']);
      if (!OUTPUT_NAME.test(name)) {
        return appErrorResponse(unsafePathError(`Nombre de fichero no válido «${name}»`));
      }
      try {
        const bytes = Buffer.from(await state.context.datasetFileSystem.readBinaryFile(resolve(state.context.cwd, OUTPUT_DIR, name)));
        return { status: 200, bytes, contentType: contentTypeOf(name) };
      } catch (error) {
        return isMissingFile(error) ? appErrorResponse(notFoundError(`No existe output/${name}`)) : appErrorResponse(environmentError(`No se pudo leer output/${name}: ${describeError(error)}`));
      }
    },
  });

  router.add({
    method: 'POST',
    path: `${API_PREFIX}/analyze-offer`,
    summary: 'Analiza una oferta (texto o fichero del espacio de trabajo) contra el perfil: la misma estructura que cv analyze-offer --json, más la selección.',
    writes: false,
    body: AnalyzeSchema,
    handler: async (request, state) => {
      const parsed = parseJsonBody(request.body, AnalyzeSchema);
      if (!parsed.ok) {
        return parsed.response;
      }
      const input = offerInputOf(state.context, parsed.value.offer);
      if (!('kind' in input)) {
        return appErrorResponse(input);
      }
      const result = await analyzeOffer(state.context, { profile: state.profile, data: state.data, specialty: parsed.value.specialty, offer: input, build: parsed.value.build ?? false });
      return result.ok ? json(200, { ...analysisPayload(result.analysis, result.history), selection: result.analysis.scored.selection.report, warnings: result.warnings } satisfies AnalyzeResponse) : appErrorResponse(result.error, { warnings: result.warnings });
    },
  });

  router.add({
    method: 'POST',
    path: `${API_PREFIX}/offers/history`,
    summary: 'Historial de una oferta: si ya se procesó (analyze-offer o generate-cv), cuándo y con qué CV; solo lectura, por la huella del texto (output/historial-ofertas.json)',
    writes: false,
    body: HistoryLookupSchema,
    handler: async (request, state) => {
      const parsed = parseJsonBody(request.body, HistoryLookupSchema);
      if (!parsed.ok) {
        return parsed.response;
      }
      const input = offerInputOf(state.context, parsed.value.offer);
      if (!('kind' in input)) {
        return appErrorResponse(input);
      }
      const read = await readOffer(state.context, input);
      if (!read.ok) {
        return appErrorResponse(read.error);
      }
      const entries = lookupHistory(await readHistory(state.context), offerFingerprint(read.offer.text));
      return json(200, { entries } satisfies HistoryLookupResponse);
    },
  });

  router.add({
    method: 'POST',
    path: `${API_PREFIX}/offers/extract`,
    summary: 'Extrae el texto de una oferta en PDF (cuerpo application/pdf, hasta 10 MiB) en el worker aislado.',
    writes: false,
    accepts: 'application/pdf',
    handler: async (request, state) => {
      if (String((request.headers['content-type'] ?? '').split(';')[0]).trim() !== 'application/pdf') {
        return errorResponse('bad-request', 'El cuerpo debe ser application/pdf');
      }
      const extracted = await state.context.pdfExtractor(request.body);
      return extracted.ok ? json(200, { text: extracted.text } satisfies ExtractResponse) : appErrorResponse(extracted.code === 'timeout' || extracted.code === 'failed' ? environmentError(extracted.message) : { code: 'invalid-data', message: extracted.message, exitCode: 1 });
    },
  });

  router.add({
    method: 'GET',
    path: `${API_PREFIX}/offers`,
    summary: 'Lista offers/ del espacio de trabajo (≤ 3 niveles, ≤ 500 entradas), de la más reciente a la más antigua, con tipo (text | markdown | pdf).',
    writes: false,
    handler: async (_request, state) => json(200, { files: await listOffers(state.context) } satisfies OffersListResponse),
  });

  router.add({
    method: 'POST',
    path: `${API_PREFIX}/offers/fetch`,
    summary: 'Descarga una oferta por URL https (T-8.5 S2): 403 remote-disabled sin --allow-remote; 409 consent-required con estimateId (un solo uso, 10 min); con consent.estimateId, UNA petición sin cookies (2 MiB, 15 s, guardia SSRF) y el texto extraído con su procedencia. Sin efectos en disco.',
    writes: false,
    body: OfferFetchSchema,
    handler: async (request, state) => {
      const parsed = parseJsonBody(request.body, OfferFetchSchema);
      if (!parsed.ok) {
        return parsed.response;
      }
      if (!state.allowRemote) {
        return errorResponse('remote-disabled', 'Este servidor no descarga nada: arráncalo con «cv serve --allow-remote» para traer ofertas desde una URL');
      }
      let host: string;
      try {
        host = new URL(parsed.value.url).host;
      } catch {
        return appErrorResponse(dataError(`«${parsed.value.url}» no es una URL válida`));
      }
      if (parsed.value.consent === undefined || !state.consents.redeem(parsed.value.consent.estimateId, 'offer-fetch')) {
        return errorResponse('consent-required', `Se descargará «${parsed.value.url}» (host ${host}, máximo ${Math.round(OFFER_URL_LIMITS.maxBytes / 1024 / 1024)} MB, sin cookies ni datos tuyos); repite la petición con consent.estimateId para confirmar`, {
          estimateId: state.consents.issue('offer-fetch'),
          host,
          limitBytes: OFFER_URL_LIMITS.maxBytes,
        });
      }
      const result = await fetchOffer(parsed.value.url, {
        fetcher: state.context.fetcher ?? offerFetcher('es, en;q=0.8'),
        pdfExtractor: async (content) => {
          const extracted = await state.context.pdfExtractor(content);
          return extracted.ok ? { ok: true, text: extracted.text } : { ok: false, message: extracted.message };
        },
      });
      if (!result.ok) {
        return appErrorResponse(dataError(result.message));
      }
      const { offer } = result;
      return json(200, {
        text: offer.text,
        title: offer.title,
        company: offer.company,
        location: offer.location,
        source: offer.source,
        warnings: offer.warnings,
        origin: { url: offer.url, fetchedAt: (state.context.now?.() ?? new Date()).toISOString(), kind: offer.kind, bytes: offer.bytes },
      } satisfies OfferFetchResponse);
    },
  });

  router.add({
    method: 'POST',
    path: `${API_PREFIX}/offers`,
    summary: 'Guarda el texto de una oferta en offers/ (ruta saneada, .txt o .md; cabecera de origen si se da origin.url); 409 si existe salvo replace: true. Escribe en offers/ (C9: acción explícita).',
    writes: true,
    body: OfferSaveSchema,
    handler: async (request, state) => {
      const parsed = parseJsonBody(request.body, OfferSaveSchema);
      if (!parsed.ok) {
        return parsed.response;
      }
      const raw = parsed.value.path.replace(/^offers\//, '');
      // El charset lo vigila la expresión; contra «a/../..» la barrera real es el resolve de abajo.
      if (!/^[a-z0-9][a-z0-9/_.-]*\.(txt|md)$/i.test(raw)) {
        return appErrorResponse(dataError(`La ruta «${parsed.value.path}» no vale: minúsculas/dígitos/guiones dentro de offers/, con extensión .txt o .md`));
      }
      const target = resolve(state.context.cwd, 'offers', raw);
      if (!target.startsWith(resolve(state.context.cwd, 'offers') + sep)) {
        return appErrorResponse(dataError(`La ruta «${parsed.value.path}» sale de offers/`));
      }
      let exists = false;
      try {
        await state.context.datasetFileSystem.stat(target);
        exists = true;
      } catch {
        exists = false;
      }
      if (exists && parsed.value.replace !== true) {
        return appErrorResponse(conflictError(`Ya existe offers/${raw}; repite con replace: true para sustituirla`));
      }
      const header = parsed.value.origin === undefined ? '' : `# Origen: ${parsed.value.origin.url}\n# Descargada: ${(state.context.now?.() ?? new Date()).toISOString()}\n\n`;
      await state.context.artifactFileSystem.mkdir(dirname(target));
      await state.context.artifactFileSystem.writeFile(target, header + parsed.value.text + '\n', 0o600);
      return json(201, { path: `offers/${raw}` } satisfies OfferSaveResponse);
    },
  });

  router.add({
    method: 'PUT',
    path: `${API_PREFIX}/config/llm/keys/{provider}`,
    summary:
      'Guarda la clave de un proveedor remoto en el fichero de claves (0600), igual que «cv llm key set». La clave viaja SOLO en este cuerpo: la respuesta devuelve su procedencia, nunca su valor, y ninguna otra ruta la expone.',
    writes: true,
    body: LlmKeySchema,
    handler: async (request) => {
      const provider = String(request.params['provider']);
      if (!isRemoteProviderId(provider)) {
        return appErrorResponse(dataError(`«${provider}» no es un proveedor remoto conocido`));
      }
      const parsed = parseJsonBody(request.body, LlmKeySchema);
      if (!parsed.ok) {
        return parsed.response;
      }
      const written = await writeApiKey(provider, parsed.value.key);
      if (!written.ok) {
        return appErrorResponse(dataError(written.message));
      }
      const sources = await describeKeys();
      return json(200, { provider, source: sources[provider], keysFile: written.file } satisfies LlmKeyResponse);
    },
  });

  router.add({
    method: 'DELETE',
    path: `${API_PREFIX}/config/llm/keys/{provider}`,
    summary: 'Elimina la clave de un proveedor remoto del fichero de claves; dice si había algo que borrar y de dónde sale la clave a partir de ahora.',
    writes: true,
    handler: async (request) => {
      const provider = String(request.params['provider']);
      if (!isRemoteProviderId(provider)) {
        return appErrorResponse(dataError(`«${provider}» no es un proveedor remoto conocido`));
      }
      const result = await removeApiKey(provider);
      if (!result.ok) {
        return appErrorResponse(dataError(result.message));
      }
      const sources = await describeKeys();
      return json(200, { provider, source: sources[provider], keysFile: result.file, removed: result.removed } satisfies LlmKeyResponse);
    },
  });

  router.add({
    method: 'POST',
    path: `${API_PREFIX}/import/apply`,
    summary:
      'Mueve una línea sin situar del borrador a la sección que se le indique y lo registra en su README. Síncrona y sin modelo: el co-piloto propone, aquí aplica la persona. Escribe en import/, nunca en data/sources.',
    writes: true,
    body: ImportApplySchema,
    handler: async (request, state) => {
      const parsed = parseJsonBody(request.body, ImportApplySchema);
      if (!parsed.ok) {
        return parsed.response;
      }
      const body = parsed.value;
      const result = await applyImportProposal(state.context, { name: body.name, line: body.line, section: body.section, fields: body.fields });
      if (!result.ok) {
        return appErrorResponse(result.error);
      }
      return json(200, result.outcome satisfies ImportApplyResponse);
    },
  });

  router.add({
    method: 'POST',
    path: `${API_PREFIX}/import-cv`,
    summary: 'Importa un CV maquetado (cuerpo binario PDF o DOCX, hasta 10 MiB) como borrador en import/<nombre>/ con su README; nunca escribe en data/sources. Cabeceras opcionales x-cv-import-name y x-cv-import-replace: 1.',
    writes: true,
    accepts: 'application/pdf',
    handler: async (request, state) => {
      const nameHeader = headerValue(request.headers['x-cv-import-name']);
      const result = await importCvDraft(state.context, request.body, nameHeader ?? 'cv-importado', {
        name: nameHeader,
        replace: headerValue(request.headers['x-cv-import-replace']) === '1',
      });
      if (!result.ok) {
        return appErrorResponse(result.error);
      }
      const { draft } = result;
      const { profile } = draft;
      return json(201, {
        name: draft.name,
        files: draft.files,
        counts: {
          experience: profile.experience.length,
          projects: profile.projects.length,
          education: profile.education.length,
          certifications: profile.certifications.length,
          skills: profile.skills.length,
          achievements: profile.achievements.length,
          languages: profile.languages.length,
        },
        issues: draft.issues.map((issue) => ({ reason: issue.reason, line: issue.provenance?.line })),
        unparsed: draft.unparsed.map((item) => ({ line: item.line, text: item.text })),
        readme: draft.readme,
      } satisfies ImportCvResponse);
    },
  });

  router.add({
    method: 'GET',
    path: `${API_PREFIX}/themes`,
    summary: 'Inventario de temas: origen, descripción, validez, cuál es el tema por defecto.',
    writes: false,
    handler: async (_request, state) => {
      const inventory = await themeInventory(state.context);
      return json(200, { defaultName: inventory.defaultName, configWarning: inventory.configWarning, roots: inventory.roots.map((root) => root.directory), entries: inventory.entries } satisfies ThemesResponse);
    },
  });

  router.add({
    method: 'POST',
    path: `${API_PREFIX}/themes`,
    summary: 'Crea themes/<name>/ en el proyecto a partir de un tema existente; nunca sobrescribe.',
    writes: true,
    body: ThemeCreateSchema,
    handler: async (request, state) => {
      const parsed = parseJsonBody(request.body, ThemeCreateSchema);
      if (!parsed.ok) {
        return parsed.response;
      }
      const result = await createTheme(state.context, parsed.value.name, parsed.value.from ?? 'default');
      return result.ok ? json(201, result.created satisfies ThemeCreateResponse) : appErrorResponse(result.error);
    },
  });

  router.add({
    method: 'POST',
    path: `${API_PREFIX}/themes/install`,
    summary:
      'Instala un tema de la comunidad en themes/<nombre>/ desde un archivo o directorio del espacio de trabajo, o desde una URL https (T-8.3): con URL exige --allow-remote y consentimiento en dos pasos (409 consent-required con estimateId, host y límite; repetir con consent.estimateId); dryRun devuelve el plan sin escribir (200); instalado, 201; nunca sobrescribe (replace aparta el anterior a una copia .bak).',
    writes: true,
    body: ThemeInstallSchema,
    handler: async (request, state) => {
      const parsed = parseJsonBody(request.body, ThemeInstallSchema);
      if (!parsed.ok) {
        return parsed.response;
      }
      const body = parsed.value;
      const classified = classifyInstallSource(state.context.cwd, body.source);
      if (!classified.ok) {
        return appErrorResponse(classified.error);
      }
      if (classified.source.kind === 'url') {
        if (!state.allowRemote) {
          return errorResponse('remote-disabled', 'Este servidor no descarga nada: arráncalo con «cv serve --allow-remote» para instalar temas desde una URL');
        }
        if (body.consent === undefined || !state.consents.redeem(body.consent.estimateId, 'theme-install')) {
          const { url } = classified.source;
          return errorResponse('consent-required', `Se descargará «${url.href}» (host ${url.host}, máximo ${THEME_DOWNLOAD_LIMITS.maxBytes} bytes); repite la petición con consent.estimateId para confirmar`, {
            estimateId: state.consents.issue('theme-install'),
            source: url.href,
            host: url.host,
            limitBytes: THEME_DOWNLOAD_LIMITS.maxBytes,
          });
        }
      }
      const result = await installTheme(state.context, { source: body.source, as: body.name, sha256: body.sha256, dryRun: body.dryRun, replace: body.replace }, { toolVersion: state.version });
      return result.ok ? json(result.installed.written ? 201 : 200, result.installed satisfies ThemeInstallResponse) : appErrorResponse(result.error);
    },
  });

  router.add({
    method: 'POST',
    path: `${API_PREFIX}/themes/{name}/verify`,
    summary: 'Recalcula las huellas de un tema instalado y las compara con su .origin.json: intacto, modificado localmente (con cada fichero) o sin origen (T-8.3).',
    writes: false,
    handler: async (request, state) => {
      const result = await verifyThemes(state.context, String(request.params['name']));
      if (!result.ok) {
        return appErrorResponse(result.error);
      }
      // Con nombre, verifyThemes devuelve exactamente la verificación de ese tema.
      const [verification] = result.verifications;
      return json(200, verification);
    },
  });

  addCopilotRoutes(router);

  router.add({
    method: 'POST',
    path: `${API_PREFIX}/shutdown`,
    summary: 'Detiene el servidor (la GUI lo usa al cerrar).',
    writes: false,
    body: EmptySchema,
    handler: async (_request, state) => {
      state.shutdown();
      return json(202, { ok: true } satisfies ShutdownResponse);
    },
  });

  return router;
}

/** Límite del cuerpo según la ruta: PDF hasta el máximo del worker; JSON, 1 MiB. */
export function bodyLimitFor(accepts: string | undefined): number {
  return accepts === 'application/pdf' ? DEFAULT_PDF_LIMITS.maxBytes : 1024 * 1024;
}

export type { RouteRequest };

/* ---------- Co-piloto: trabajos y revisiones ---------- */

type CopilotBody = z.infer<typeof ImproveJobSchema> | z.infer<typeof SummarizeJobSchema> | z.infer<typeof SuggestTagsJobSchema>;

interface Launch<P> {
  readonly kind: JobKind;
  readonly planned: PlanOutcome<P>;
  /** Qué saldría hacia el modelo (C3), para la respuesta. */
  readonly sending: (plan: P) => Record<string, unknown>;
  readonly estimate: (plan: P) => Promise<CostEstimate>;
  readonly run: (plan: P, options: ExecuteOptions, report: JobReport) => Promise<unknown>;
}

/** Planificado → proveedor → (remoto: permiso y consentimiento) → salud → trabajo encolado (202). */
async function launchJob<P>(state: ServerState, body: CopilotBody, launch: Launch<P>): Promise<RouteResponse> {
  const { planned } = launch;
  if (!planned.ok) {
    return appErrorResponse(planned.error, { warnings: planned.warnings });
  }
  const selected = await selectCopilotProvider(state.context, { provider: body.provider, model: body.model });
  if (!selected.ok) {
    return appErrorResponse(selected.error, { warnings: planned.warnings });
  }
  const { provider } = selected;
  const sending = { destination: describeProvider(provider), redactCompanies: body.redactCompanies ?? false, ...launch.sending(planned.plan) };
  if (provider.kind === 'remote') {
    if (!state.allowRemote) {
      return errorResponse('remote-disabled', 'Este servidor no envía nada a proveedores remotos: arráncalo con «cv serve --allow-remote» para permitirlo', { sending });
    }
    if (body.consent === undefined || !state.consents.redeem(body.consent.estimateId, launch.kind)) {
      const estimate = await launch.estimate(planned.plan);
      const estimateId = state.consents.issue(launch.kind);
      const dataNote = REMOTE_PROVIDERS.find((entry) => entry.id === body.provider)?.dataNote;
      return errorResponse('consent-required', 'Proveedor remoto: revisa el coste estimado y repite la petición con consent.estimateId para confirmar', {
        estimateId,
        estimate,
        ...(dataNote === undefined ? {} : { dataNote }),
        warning: formatCostWarning(`${provider.id} (${provider.baseUrl}; modelo ${provider.model})`, estimate),
        sending,
        warnings: planned.warnings,
      });
    }
  }
  const health = await checkLocalProvider(provider);
  if (!health.ok) {
    const message = health.reason === 'unreachable' ? `${health.message}; comprueba el proveedor con «cv llm status»` : `El modelo «${provider.model}» no está disponible en ${provider.baseUrl} (${health.models.length === 0 ? 'no sirve ningún modelo' : `sirve: ${health.models.join(', ')}`}); comprueba «cv llm status»`;
    return appErrorResponse(environmentError(message), { sending });
  }
  const job = state.jobs.create(launch.kind, (report) => launch.run(planned.plan, { provider, cache: body.cache ?? true, progress: report.line, signal: report.signal }, report));
  return json(202, { job, sending, warnings: planned.warnings } satisfies JobCreatedResponse, { Location: `${API_PREFIX}/jobs/${job.id}` });
}

/** Resultado de improve/summarize: la revisión escrita (o nada si se canceló). */
async function reviewResult(context: AppContext, outcome: ReviewOutcome, report: JobReport): Promise<unknown> {
  for (const note of outcome.notes) {
    report.line(note);
  }
  if (outcome.cancelled) {
    return { cancelled: true, processed: outcome.items.length };
  }
  const failure = await writeReview(context, outcome.outputPath, outcome.text);
  if (failure !== undefined) {
    throw new JobFailure(failure);
  }
  const name = basename(outcome.outputPath);
  return { review: { name, path: `${OUTPUT_DIR}/${name}`, sha256: contentHash(outcome.text) }, stats: outcome.stats, cancelled: false };
}

function offerOf(state: ServerState, offer: z.infer<typeof OfferSchema> | undefined): { readonly ok: true; readonly offer: OfferInput | undefined } | { readonly ok: false; readonly error: AppError } {
  if (offer === undefined) {
    return { ok: true, offer: undefined };
  }
  const input = offerInputOf(state.context, offer);
  return 'kind' in input ? { ok: true, offer: input } : { ok: false, error: input };
}

function reviewName(name: string): AppError | undefined {
  return REVIEW_NAME.test(name) ? undefined : unsafePathError(`Nombre de revisión no válido «${name}»: se espera revision-<…>.md, sin directorios`);
}

function addCopilotRoutes(router: Router<ServerState>): void {
  router.add({
    method: 'GET',
    path: `${API_PREFIX}/jobs`,
    summary: 'Trabajos del co-piloto de esta sesión (en cola, en marcha y terminados), con su progreso y resultado.',
    writes: false,
    handler: async (_request, state) => json(200, { jobs: state.jobs.list() } satisfies JobsResponse),
  });

  router.add({
    method: 'POST',
    path: `${API_PREFIX}/jobs/improve`,
    summary: 'Encola cv improve: propuestas verificadas (C2) para los logros de la selección; escribe output/revision-improve-….md. Un remoto exige --allow-remote y consentimiento (409).',
    writes: true,
    body: ImproveJobSchema,
    handler: async (request, state) => {
      const parsed = parseJsonBody(request.body, ImproveJobSchema);
      if (!parsed.ok) {
        return parsed.response;
      }
      const body = parsed.value;
      const offer = offerOf(state, body.offer);
      if (!offer.ok) {
        return appErrorResponse(offer.error);
      }
      const planned = await planImprove(state.context, {
        profile: state.profile,
        data: state.data,
        build: body.build ?? false,
        specialty: body.specialty,
        offer: offer.offer,
        topN: body.topN,
        maxSkills: body.maxSkills,
        maxProjects: body.maxProjects,
        maxCertifications: body.maxCertifications,
        compact: body.compact ?? false,
        only: body.only,
        proposals: body.proposals ?? IMPROVE_LIMITS.proposals,
        maxLength: body.maxLength ?? IMPROVE_LIMITS.maxLength,
        maxItems: body.maxItems ?? DEFAULT_MAX_ITEMS,
        redactCompanies: body.redactCompanies ?? false,
        locale: body.locale,
        output: body.output === undefined ? undefined : `${OUTPUT_DIR}/${body.output}`,
      });
      return launchJob(state, body, {
        kind: 'improve',
        planned,
        sending: (plan) => ({ items: plan.fragments.length, words: plan.words, ids: plan.ids }),
        estimate: (plan) => improveEstimate(state.context, plan, outputTokensFloorFor(body.provider, body.model)),
        run: async (plan, options, report) => reviewResult(state.context, await executeImprove(state.context, plan, options), report),
      });
    },
  });

  router.add({
    method: 'POST',
    path: `${API_PREFIX}/jobs/summarize`,
    summary: 'Encola cv summarize: resumen profesional del perfil filtrado; escribe output/revision-summarize-….md.',
    writes: true,
    body: SummarizeJobSchema,
    handler: async (request, state) => {
      const parsed = parseJsonBody(request.body, SummarizeJobSchema);
      if (!parsed.ok) {
        return parsed.response;
      }
      const body = parsed.value;
      const offer = offerOf(state, body.offer);
      if (!offer.ok) {
        return appErrorResponse(offer.error);
      }
      const planned = await planSummarize(state.context, {
        profile: state.profile,
        data: state.data,
        build: body.build ?? false,
        specialty: body.specialty,
        offer: offer.offer,
        topN: body.topN,
        maxSkills: body.maxSkills,
        maxProjects: body.maxProjects,
        maxCertifications: body.maxCertifications,
        compact: body.compact ?? false,
        paragraphs: body.paragraphs ?? SUMMARIZE_LIMITS.paragraphs,
        proposals: body.proposals ?? SUMMARIZE_LIMITS.proposals,
        maxLength: body.maxLength ?? SUMMARIZE_LIMITS.maxLength,
        redactCompanies: body.redactCompanies ?? false,
        locale: body.locale,
        output: body.output === undefined ? undefined : `${OUTPUT_DIR}/${body.output}`,
      });
      return launchJob(state, body, {
        kind: 'summarize',
        planned,
        sending: (plan) => ({ experience: plan.fragment.input.experience.length, projects: plan.fragment.input.projects.length, skills: plan.fragment.input.skills.length, words: plan.words }),
        estimate: (plan) => summarizeEstimate(state.context, plan, outputTokensFloorFor(body.provider, body.model)),
        run: async (plan, options, report) => reviewResult(state.context, await executeSummarize(state.context, plan, options), report),
      });
    },
  });

  router.add({
    method: 'POST',
    path: `${API_PREFIX}/jobs/suggest-tags`,
    summary: 'Encola cv suggest tags: etiquetas del diccionario cerrado para un texto o para los logros del perfil; el resultado va en el trabajo (no escribe nada).',
    writes: false,
    body: SuggestTagsJobSchema,
    handler: async (request, state) => {
      const parsed = parseJsonBody(request.body, SuggestTagsJobSchema);
      if (!parsed.ok) {
        return parsed.response;
      }
      const body = parsed.value;
      const planned = await planSuggestTags(state.context, {
        profile: state.profile,
        data: state.data,
        build: body.build ?? false,
        text: body.text,
        specialty: body.specialty,
        only: body.only,
        untagged: body.untagged ?? false,
        maxTags: body.maxTags ?? SUGGEST_TAGS_LIMITS.maxTags,
        maxItems: body.maxItems ?? DEFAULT_MAX_ITEMS,
        redactCompanies: body.redactCompanies ?? false,
        locale: body.locale,
      });
      return launchJob(state, body, {
        kind: 'suggest-tags',
        planned,
        sending: (plan) => ({ items: plan.fragments.length, words: plan.words, scope: plan.scope }),
        estimate: (plan) => suggestTagsEstimate(state.context, plan, outputTokensFloorFor(body.provider, body.model)),
        run: async (plan, options) => {
          const outcome = await executeSuggestTags(state.context, plan, options);
          return {
            items: outcome.items.map((item) => ({ id: item.id, location: item.location, line: formatTagLine(item), accepted: item.accepted, rejected: item.rejected, error: item.error, fromCache: item.fromCache, elapsedMs: item.elapsedMs })),
            stats: outcome.stats,
            cancelled: outcome.cancelled,
          };
        },
      });
    },
  });

  router.add({
    method: 'POST',
    path: `${API_PREFIX}/jobs/import-map`,
    summary:
      'Encola el refinado de un borrador de import/ con el co-piloto: envía solo sus líneas sin situar (seudonimizadas, vocabulario cerrado) y deja las propuestas verificadas en el README del borrador. No toca data/sources/ ni aplica nada.',
    writes: true,
    body: ImportMapJobSchema,
    handler: async (request, state) => {
      const parsed = parseJsonBody(request.body, ImportMapJobSchema);
      if (!parsed.ok) {
        return parsed.response;
      }
      const body = parsed.value;
      const planned = await planImportMap(state.context, { name: body.name, locale: body.locale });
      if (!planned.ok) {
        return appErrorResponse(planned.error);
      }
      return launchJob(state, body, {
        kind: 'import-map',
        planned: { ok: true, plan: planned.plan, warnings: [] },
        sending: (plan: ImportMapPlan) => ({ items: plan.lines.length, words: plan.lines.reduce((total, line) => total + line.text.split(/\s+/).length, 0), skipped: plan.skipped }),
        estimate: (plan) => importMapEstimate(state.context, plan, outputTokensFloorFor(body.provider, body.model)),
        run: async (plan, options) => {
          const result = await executeImportMap(state.context, plan, options);
          if (!result.ok) {
            throw new JobFailure(result.error);
          }
          return result.outcome satisfies ImportMapJobResult;
        },
      });
    },
  });

  router.add({
    method: 'GET',
    path: `${API_PREFIX}/jobs/{id}`,
    summary: 'Estado de un trabajo: progreso (líneas), resultado o error.',
    writes: false,
    handler: async (request, state) => {
      const job = state.jobs.get(String(request.params['id']));
      return job === undefined ? appErrorResponse(notFoundError(`No existe el trabajo «${String(request.params['id'])}»`)) : json(200, { job } satisfies JobResponse);
    },
  });

  router.add({
    method: 'DELETE',
    path: `${API_PREFIX}/jobs/{id}`,
    summary: 'Cancela un trabajo: en cola termina ya; en marcha aborta la petición en curso y el lote para (sin efecto si ya terminó).',
    writes: false,
    handler: async (request, state) => {
      const job = state.jobs.cancel(String(request.params['id']));
      return job === undefined ? appErrorResponse(notFoundError(`No existe el trabajo «${String(request.params['id'])}»`)) : json(200, { job } satisfies JobResponse);
    },
  });

  router.add({
    method: 'GET',
    path: `${API_PREFIX}/jobs/{id}/events`,
    summary: 'Eventos del trabajo (text/event-stream): «status» con el estado completo al conectar y en cada cambio, «line» por cada línea de progreso; se cierra al terminar.',
    writes: false,
    handler: async (request, state) => {
      const id = String(request.params['id']);
      if (state.jobs.get(id) === undefined) {
        return appErrorResponse(notFoundError(`No existe el trabajo «${id}»`));
      }
      return {
        status: 200,
        contentType: 'text/event-stream; charset=utf-8',
        stream: (sink) =>
          state.jobs.subscribe(id, (event) => {
            sink.send(event.event, event.data);
            if (event.event === 'status' && isFinished(event.data.status)) {
              sink.end();
            }
          }),
      };
    },
  });

  router.add({
    method: 'GET',
    path: `${API_PREFIX}/reviews`,
    summary: 'Revisiones del co-piloto en output/ (revision-*.md): tarea, ítems, propuestas marcadas y huella.',
    writes: false,
    handler: async (_request, state) => json(200, { reviews: await listReviews(state.context, OUTPUT_DIR) } satisfies ReviewsResponse),
  });

  router.add({
    method: 'GET',
    path: `${API_PREFIX}/reviews/{name}`,
    summary: 'Una revisión: texto Markdown, huella (ETag) y estructura interpretada (ítems y propuestas).',
    writes: false,
    handler: async (request, state) => {
      const result = await readReview(state.context, OUTPUT_DIR, String(request.params['name']));
      return result.ok ? json(200, { review: result.file } satisfies ReviewResponse, { ETag: `"${result.file.sha256}"` }) : appErrorResponse(result.error);
    },
  });

  router.add({
    method: 'PUT',
    path: `${API_PREFIX}/reviews/{name}`,
    summary: 'Guarda la revisión editada (marcas [x], textos). Exige If-Match con la huella actual, o «*» para crear.',
    writes: true,
    body: SourceWriteSchema,
    handler: async (request, state) => {
      const name = String(request.params['name']);
      const invalid = reviewName(name);
      if (invalid !== undefined) {
        return appErrorResponse(invalid);
      }
      const ifMatch = request.headers['if-match'];
      if (ifMatch === undefined) {
        return errorResponse('precondition-required', 'Falta la cabecera If-Match: la huella actual de la revisión, o «*» para crearla');
      }
      const parsed = parseJsonBody(request.body, SourceWriteSchema);
      if (!parsed.ok) {
        return parsed.response;
      }
      const result = await writeSource(state.context, resolve(state.context.cwd, OUTPUT_DIR), { path: name, content: parsed.value.content, expectedSha256: ifMatch.trim().replace(/^"|"$/g, '') });
      return result.ok ? json(200, { name, sha256: result.file.sha256 } satisfies ReviewWriteResponse, { ETag: `"${result.file.sha256}"` }) : appErrorResponse(result.error);
    },
  });

  router.add({
    method: 'DELETE',
    path: `${API_PREFIX}/reviews/{name}`,
    summary: 'Elimina una revisión de output/.',
    writes: true,
    handler: async (request, state) => {
      const name = String(request.params['name']);
      const invalid = reviewName(name);
      if (invalid !== undefined) {
        return appErrorResponse(invalid);
      }
      const path = resolve(state.context.cwd, OUTPUT_DIR, name);
      try {
        await state.context.datasetFileSystem.stat(path);
        await state.context.artifactFileSystem.remove(path);
      } catch (error) {
        return appErrorResponse(isMissingFile(error) ? notFoundError(`No existe la revisión «${name}»`) : environmentError(`No se pudo eliminar la revisión «${name}»: ${describeError(error)}`));
      }
      return json(200, { deleted: name } satisfies ReviewDeleteResponse);
    },
  });

  router.add({
    method: 'POST',
    path: `${API_PREFIX}/reviews/{name}/apply`,
    summary: 'Aplica a las fuentes las propuestas marcadas [x] (cv improve apply): por defecto solo el plan (dryRun); con dryRun:false escribe con copia .bak y huella comprobada (C9).',
    writes: true,
    body: ApplySchema,
    handler: async (request, state) => {
      const name = String(request.params['name']);
      const invalid = reviewName(name);
      if (invalid !== undefined) {
        return appErrorResponse(invalid);
      }
      const parsed = parseJsonBody(request.body, ApplySchema);
      if (!parsed.ok) {
        return parsed.response;
      }
      const result = await applyReview(state.context, { review: `${OUTPUT_DIR}/${name}`, data: state.data, dryRun: parsed.value.dryRun ?? true, deleteReview: parsed.value.deleteReview ?? false });
      return result.ok ? json(200, result.outcome satisfies ApplyResponse) : appErrorResponse(result.error, { written: result.written });
    },
  });
}

/** Los fallos del runtime en el vocabulario de errores del servidor (estado HTTP según ERROR_STATUS). */
function runtimeErrorCode(code: RuntimeErrorCode): AppErrorCode {
  switch (code) {
    case 'invalid-model':
      return 'invalid-data';
    case 'not-managed':
      return 'conflict';
    default:
      return 'environment';
  }
}
