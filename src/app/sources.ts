/**
 * Las fuentes del usuario para los clientes que las exploran y editan (docs/api-headless.md §5 y §6):
 * identificadores relativos y contenidos (nunca rutas del cliente), huella SHA-256 de cada fichero y
 * escritura solo por acción explícita del usuario con concurrencia optimista (`If-Match`): la
 * clarificación del canon C9 para la GUI. La IA nunca pasa por aquí.
 */
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

import { isMissingFile } from '../artifact';
import { planDataset, type DatasetError } from '../parsers';
import { describeError } from '../shared/errors';
import type { AppContext } from './context';
import { conflictError, dataError, environmentError, notFoundError, unsafePathError, type AppError } from './errors';
import { isSafeSourcePath } from './paths';
import { formatDatasetError, pluralize } from './text';

/** Los ficheros de fuentes contienen datos personales: solo el propietario puede leerlos. */
export const SOURCE_FILE_MODE = 0o600;

/** Huella que identifica el contenido exacto de un fichero (`ETag`/`If-Match`). */
export function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export interface SourceEntry {
  /** Ruta relativa a la raíz de las fuentes (`experience/acme.md`). */
  readonly path: string;
  readonly bytes: number;
  readonly mtimeMs: number;
  readonly sha256: string;
}

export type SourceListResult =
  | { readonly ok: true; readonly root: string; readonly entries: readonly SourceEntry[] }
  | { readonly ok: false; readonly error: AppError; readonly issues: readonly DatasetError[] };

/** Los ficheros que el cargador reconoce en el dataset, con su tamaño, fecha y huella. */
export async function listSources(context: AppContext, root: string): Promise<SourceListResult> {
  const plan = await planDataset(root, context.datasetFileSystem);
  if (!plan.ok) {
    const lines = [...plan.errors.map(formatDatasetError), `${pluralize(plan.errors.length, 'problema', 'problemas')} en ${root}`];
    return { ok: false, error: dataError(`${pluralize(plan.errors.length, 'problema', 'problemas')} en ${root}`, lines), issues: plan.errors };
  }
  const entries = await Promise.all(
    plan.files.map(async (file) => {
      const info = await context.datasetFileSystem.stat(file.absolutePath);
      return { path: file.path, bytes: info.size, mtimeMs: info.mtimeMs, sha256: contentHash(await context.datasetFileSystem.readTextFile(file.absolutePath)) };
    }),
  );
  return { ok: true, root, entries };
}

export interface SourceFile {
  readonly path: string;
  readonly content: string;
  readonly sha256: string;
}

export type SourceReadResult = { readonly ok: true; readonly file: SourceFile } | { readonly ok: false; readonly error: AppError };

function unsafe(path: string): AppError {
  return unsafePathError(`Identificador de fuente no válido «${path}»: debe ser relativo, sin «..» ni barras invertidas`);
}

export async function readSource(context: AppContext, root: string, path: string): Promise<SourceReadResult> {
  if (!isSafeSourcePath(path)) {
    return { ok: false, error: unsafe(path) };
  }
  try {
    const content = await context.datasetFileSystem.readTextFile(join(root, path));
    return { ok: true, file: { path, content, sha256: contentHash(content) } };
  } catch (error) {
    return { ok: false, error: isMissingFile(error) ? notFoundError(`No existe la fuente «${path}»`) : environmentError(`No se pudo leer la fuente «${path}»: ${describeError(error)}`) };
  }
}

export interface WriteSourceRequest {
  readonly path: string;
  readonly content: string;
  /** Huella del contenido actual (`If-Match`), o `*` para crear un fichero que no existe. */
  readonly expectedSha256: string;
}

export type SourceWriteResult = { readonly ok: true; readonly file: SourceFile } | { readonly ok: false; readonly error: AppError };

/** Escritura atómica (fichero temporal y renombrado, 0600) solo si el original es exactamente el que el cliente vio. */
export async function writeSource(context: AppContext, root: string, request: WriteSourceRequest): Promise<SourceWriteResult> {
  if (!isSafeSourcePath(request.path)) {
    return { ok: false, error: unsafe(request.path) };
  }
  const current = await readSource(context, root, request.path);
  if (current.ok) {
    if (request.expectedSha256 === '*') {
      return { ok: false, error: conflictError(`Ya existe la fuente «${request.path}»: envía su huella actual para sustituirla`) };
    }
    if (current.file.sha256 !== request.expectedSha256) {
      return { ok: false, error: conflictError(`La fuente «${request.path}» cambió desde que se leyó (huella ${current.file.sha256.slice(0, 12)}…): vuelve a cargarla`) };
    }
  } else if (current.error.code !== 'not-found') {
    return current;
  } else if (request.expectedSha256 !== '*') {
    return { ok: false, error: conflictError(`No existe la fuente «${request.path}»: envía «*» como huella para crearla`) };
  }
  const target = join(root, request.path);
  const temporary = `${target}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    await context.artifactFileSystem.mkdir(dirname(target));
    await context.artifactFileSystem.writeFile(temporary, request.content, SOURCE_FILE_MODE);
    await context.artifactFileSystem.rename(temporary, target);
  } catch (error) {
    return { ok: false, error: environmentError(`No se pudo escribir la fuente «${request.path}»: ${describeError(error)}`) };
  }
  return { ok: true, file: { path: request.path, content: request.content, sha256: contentHash(request.content) } };
}
