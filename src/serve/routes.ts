/**
 * Contrato `/api/v1` (docs/api-headless.md §5): cada ruta es un cliente de la capa de casos de uso y
 * nunca acepta rutas del sistema de ficheros del cliente: solo identificadores relativos y saneados
 * dentro del espacio de trabajo. Los metadatos del registro alimentan la referencia generada.
 */
import { extname, resolve } from 'node:path';

import { z } from 'zod';

import { analysisPayload, analyzeOffer } from '../app/analyze';
import type { AppContext } from '../app/context';
import { buildProfile, loadProfile, loadSources } from '../app/dataset';
import { environmentError, notFoundError, unsafePathError, type AppError } from '../app/errors';
import { CV_ENGINES, CV_FORMATS } from '../app/format';
import { generateCv, writeCvFile } from '../app/generate';
import type { OfferInput } from '../app/offer';
import { isSafeSourcePath } from '../app/paths';
import { listSources, readSource, writeSource } from '../app/sources';
import { profileSummary } from '../app/text';
import { createTheme, themeInventory } from '../app/themes';
import { inspectWorkspace, type WorkspaceStatus } from '../app/workspace';
import { isMissingFile } from '../artifact';
import { DEFAULT_PDF_LIMITS } from '../pdf';
import { describeError } from '../shared/errors';
import { appErrorResponse, errorResponse, json, parseJsonBody } from './http';
import { Router, type RouteRequest, type RouteResponse } from './router';

export interface ServerState {
  readonly context: AppContext;
  readonly data: string;
  readonly profile: string;
  readonly version: string;
  /** Detiene el servidor tras responder. */
  readonly shutdown: () => void;
}

export const API_PREFIX = '/api/v1';
const OUTPUT_DIR = 'output';
const OUTPUT_NAME = /^[\w.-]+$/;

const OfferSchema = z.union([z.object({ text: z.string().min(1) }), z.object({ workspaceFile: z.string().min(1) })]);
const LimitsSchema = {
  topN: z.number().int().min(0).optional(),
  maxSkills: z.number().int().min(0).optional(),
  maxProjects: z.number().int().min(0).optional(),
  maxCertifications: z.number().int().min(0).optional(),
  compact: z.boolean().optional(),
};
const GenerateSchema = z.object({
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
const AnalyzeSchema = z.object({ offer: OfferSchema, specialty: z.string().min(1).optional(), build: z.boolean().optional() });
const SourceWriteSchema = z.object({ content: z.string() });
const ThemeCreateSchema = z.object({ name: z.string().min(1), from: z.string().min(1).optional() });
const EmptySchema = z.object({});

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
function statusPayload(status: WorkspaceStatus, version: string): Record<string, unknown> {
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
      return result.ok ? json(200, { root: result.root, entries: result.entries }) : appErrorResponse(result.error, { issues: result.issues });
    },
  });

  router.add({
    method: 'GET',
    path: `${API_PREFIX}/sources/{path+}`,
    summary: 'Contenido de un fichero de fuentes con su huella (también en la cabecera ETag).',
    writes: false,
    handler: async (request, state) => {
      const result = await readSource(state.context, resolve(state.context.cwd, state.data), String(request.params['path']));
      return result.ok ? json(200, result.file, { ETag: `"${result.file.sha256}"` }) : appErrorResponse(result.error);
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
      return result.ok ? json(200, { path: result.file.path, sha256: result.file.sha256 }, { ETag: `"${result.file.sha256}"` }) : appErrorResponse(result.error);
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
      return result.ok ? json(200, { root: result.dataset.root, files: result.dataset.files, summary: profileSummary(result.dataset.profile) }) : appErrorResponse(result.error, { issues: result.issues });
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
      return result.ok ? json(200, { artifactPath: result.artifactPath, files: result.dataset.files, summary: profileSummary(result.dataset.profile) }) : appErrorResponse(result.error, { issues: result.issues });
    },
  });

  router.add({
    method: 'GET',
    path: `${API_PREFIX}/profile`,
    summary: 'El perfil validado (el artefacto, re-validado al leerlo), con los ids de entidades y logros.',
    writes: false,
    handler: async (_request, state) => {
      const result = await loadProfile(state.context, { profile: state.profile });
      return result.ok ? json(200, result.profile) : appErrorResponse(result.error);
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
      });
      const report = result.report === undefined ? undefined : { selection: result.report.selection, match: result.report.match, limits: result.report.limits, removed: result.report.removed, theme: result.report.theme };
      if (!result.ok) {
        return appErrorResponse(result.error, { report, warnings: result.warnings });
      }
      const failure = await writeCvFile(state.context, result.cv);
      if (failure !== undefined) {
        return appErrorResponse(failure, { warnings: result.warnings });
      }
      const name = result.cv.outputPath.slice(resolve(state.context.cwd, OUTPUT_DIR).length + 1);
      return json(200, { output: { name, kind: result.cv.kind, path: `${OUTPUT_DIR}/${name}`, ...(result.cv.kind === 'md' ? { markdown: result.cv.markdown } : { bytes: result.cv.pdf.byteLength }) }, report, warnings: result.warnings });
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
        return json(200, { files: files.sort((a, b) => a.name.localeCompare(b.name, 'en')) });
      } catch (error) {
        return isMissingFile(error) ? json(200, { files: [] }) : appErrorResponse(environmentError(`No se pudo leer ${directory}: ${describeError(error)}`));
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
      return result.ok ? json(200, { ...analysisPayload(result.analysis), selection: result.analysis.scored.selection.report, warnings: result.warnings }) : appErrorResponse(result.error, { warnings: result.warnings });
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
      return extracted.ok ? json(200, { text: extracted.text }) : appErrorResponse(extracted.code === 'timeout' || extracted.code === 'failed' ? environmentError(extracted.message) : { code: 'invalid-data', message: extracted.message, exitCode: 1 });
    },
  });

  router.add({
    method: 'GET',
    path: `${API_PREFIX}/themes`,
    summary: 'Inventario de temas: origen, descripción, validez, cuál es el tema por defecto.',
    writes: false,
    handler: async (_request, state) => {
      const inventory = await themeInventory(state.context);
      return json(200, { defaultName: inventory.defaultName, configWarning: inventory.configWarning, roots: inventory.roots.map((root) => root.directory), entries: inventory.entries });
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
      return result.ok ? json(201, result.created) : appErrorResponse(result.error);
    },
  });

  router.add({
    method: 'POST',
    path: `${API_PREFIX}/shutdown`,
    summary: 'Detiene el servidor (la GUI lo usa al cerrar).',
    writes: false,
    body: EmptySchema,
    handler: async (_request, state) => {
      state.shutdown();
      return json(202, { ok: true });
    },
  });

  return router;
}

/** Límite del cuerpo según la ruta: PDF hasta el máximo del worker; JSON, 1 MiB. */
export function bodyLimitFor(accepts: string | undefined): number {
  return accepts === 'application/pdf' ? DEFAULT_PDF_LIMITS.maxBytes : 1024 * 1024;
}

export type { RouteRequest };
