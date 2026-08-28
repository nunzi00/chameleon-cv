/**
 * Cargador del dataset: planifica la lectura, despacha cada fichero a su parser, fusiona
 * las contribuciones, valida el `MasterProfile` resultante y traduce cualquier error a
 * `fichero:línea` (`docs/arquitectura.md` §2.3).
 */
import { validateMasterProfile, type MasterProfile, type ValidationIssue } from '../../core/schema';
import type { FileSystem } from './file-system';
import { planDataset } from './layout';
import { mergeContributions, type ContributionSource } from './merge';
import { resolveProvenance } from './provenance';
import type { DatasetError, Provenance, SourceParser } from './types';

export interface LoadDatasetOptions {
  readonly fileSystem: FileSystem;
  readonly parsers: readonly SourceParser[];
}

export type DatasetResult =
  | { readonly ok: true; readonly profile: MasterProfile; readonly files: readonly string[]; /** Procedencia (fichero:línea) de cada parte del perfil, para trazar un ítem hasta su fuente. */ readonly provenance: readonly Provenance[] }
  | { readonly ok: false; readonly errors: readonly DatasetError[] };

/** Normaliza el texto leído: BOM fuera y finales de línea `\n`. */
export function normalizeText(raw: string): string {
  const withoutBom = raw.startsWith('﻿') ? raw.slice(1) : raw;
  return withoutBom.replace(/\r\n?/g, '\n');
}

export function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot);
}

/** Ordena por fichero y línea (los errores sin línea van al final de su fichero). */
export function sortErrors(errors: readonly DatasetError[]): DatasetError[] {
  return [...errors].sort((a, b) => {
    if (a.file !== b.file) {
      return a.file < b.file ? -1 : 1;
    }
    return (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER);
  });
}

function locateIssue(issue: ValidationIssue, provenance: readonly Provenance[]): DatasetError {
  const origin = resolveProvenance(issue.segments, provenance);
  const label = issue.path === '' ? '<raíz>' : issue.path;
  if (origin === undefined) {
    return { file: '.', message: `${label}: ${issue.message}` };
  }
  return { file: origin.file, line: origin.line, message: `${label}: ${issue.message}` };
}

export async function loadDataset(root: string, options: LoadDatasetOptions): Promise<DatasetResult> {
  const plan = await planDataset(root, options.fileSystem);
  if (!plan.ok) {
    return { ok: false, errors: sortErrors(plan.errors) };
  }

  const parserByExtension = new Map<string, SourceParser>();
  for (const parser of options.parsers) {
    for (const extension of parser.extensions) {
      parserByExtension.set(extension, parser);
    }
  }

  const sources: ContributionSource[] = [];
  const errors: DatasetError[] = [];
  for (const planned of plan.files) {
    const extension = extensionOf(planned.path);
    const parser = parserByExtension.get(extension);
    if (parser === undefined) {
      errors.push({ file: planned.path, message: `No hay parser para la extensión «${extension}»` });
      continue;
    }
    const content = normalizeText(await options.fileSystem.readTextFile(planned.absolutePath));
    const result = parser.parse({ path: planned.path, content });
    if (result.ok) {
      sources.push({ file: planned.path, contribution: result.contribution, provenance: result.provenance });
    } else {
      errors.push(...result.errors);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors: sortErrors(errors) };
  }

  const merged = mergeContributions(sources);
  if (!merged.ok) {
    return { ok: false, errors: sortErrors(merged.errors) };
  }

  const validation = validateMasterProfile(merged.profile);
  if (validation.ok) {
    return { ok: true, profile: validation.profile, files: plan.files.map((file) => file.path), provenance: merged.provenance };
  }
  return { ok: false, errors: sortErrors(validation.issues.map((issue) => locateIssue(issue, merged.provenance))) };
}
