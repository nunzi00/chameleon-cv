/**
 * Portabilidad del perfil (T-8.1, `docs/portability.md`): `exportProfile` produce el perfil canónico desde
 * las fuentes; `planImport` valida un perfil, genera las fuentes canónicas que lo representan y **se
 * comprueba a sí mismo** volviéndolas a leer con el cargador real antes de que nada toque el disco;
 * `importProfile` escribe el plan solo en un directorio vacío o inexistente, o sustituye uno existente
 * (`replace`) tras renombrarlo entero como copia de seguridad. Segunda orden que escribe fuentes bajo el
 * canon C9, por la misma vía que `improve apply`: a petición explícita, sin IA, con copia.
 */
import { basename, dirname, join, resolve } from 'node:path';

import { serializeProfile } from '../artifact';
import { validateMasterProfile, type MasterProfile } from '../core/schema';
import {
  MemorySourceTree,
  achievementProblem,
  assignFileNames,
  loadDataset,
  serializeAchievementsFile,
  serializeCertifications,
  serializeEducation,
  serializeExperience,
  serializeProfileFile,
  serializeProject,
  serializeSkills,
  serializeSpecialty,
  type DatasetError,
  type EntityNaming,
  type EntitySection,
} from '../parsers';
import { describeError } from '../shared/errors';
import type { AppContext } from './context';
import { loadSources } from './dataset';
import { conflictError, dataError, environmentError, unsafePathError, type AppError } from './errors';
import { writeSource } from './sources';
import { formatDatasetError, pluralize } from './text';

/* ───────────────────────────────── export ───────────────────────────────── */

export type ExportResult =
  | { readonly ok: true; readonly profile: MasterProfile; readonly json: string; readonly root: string }
  | { readonly ok: false; readonly error: AppError; readonly issues: readonly DatasetError[] };

/** El perfil canónico desde las fuentes (misma serialización que el artefacto de `cv build`). */
export async function exportProfile(context: AppContext, options: { readonly data: string }): Promise<ExportResult> {
  const loaded = await loadSources(context, options);
  if (!loaded.ok) {
    return loaded;
  }
  return { ok: true, profile: loaded.dataset.profile, json: serializeProfile(loaded.dataset.profile), root: loaded.dataset.root };
}

/* ───────────────────────────────── plan ───────────────────────────────── */

export interface PlannedFile {
  /** Ruta relativa al directorio de fuentes. */
  readonly path: string;
  readonly content: string;
}

export interface ImportCounts {
  readonly specialties: number;
  readonly experience: number;
  readonly projects: number;
  readonly education: number;
  readonly achievements: number;
  readonly skills: number;
  readonly certifications: number;
}

export interface ImportPlan {
  readonly files: readonly PlannedFile[];
  readonly counts: ImportCounts;
  readonly warnings: readonly string[];
  /** El perfil validado, con las entidades en el orden en que quedarán tras leer las fuentes. */
  readonly profile: MasterProfile;
}

export type PlanResult = { readonly ok: true; readonly plan: ImportPlan } | { readonly ok: false; readonly error: AppError };

const ENTITY_SECTIONS: readonly EntitySection[] = ['specialties', 'experience', 'projects', 'education'];

export function parseProfileJson(text: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: AppError } {
  try {
    return { ok: true, value: JSON.parse(text.startsWith('﻿') ? text.slice(1) : text) as unknown };
  } catch (error) {
    return { ok: false, error: dataError(`El perfil no es JSON válido: ${describeError(error)}`) };
  }
}

/** Nombre de fichero (con `id:` explícito o no) de cada entidad, por sección. */
export type SectionNaming = Readonly<Record<EntitySection, ReadonlyMap<string, EntityNaming>>>;

export interface CanonicalProfile {
  readonly profile: MasterProfile;
  readonly reordered: readonly EntitySection[];
  readonly naming: SectionNaming;
}

/**
 * Las entidades como quedarán al leer las fuentes: en el orden en que el cargador lee los ficheros de un
 * directorio (`layout.ts`, nombre con extensión, comparación de código); los nombres se asignan una sola
 * vez, en el orden del perfil de entrada, y se reutilizan al planificar.
 */
export function canonicalOrder(profile: MasterProfile): CanonicalProfile {
  const reordered: EntitySection[] = [];
  const sorted: Partial<Record<EntitySection, readonly { readonly id: string }[]>> = {};
  const naming: Partial<Record<EntitySection, ReadonlyMap<string, EntityNaming>>> = {};
  for (const section of ENTITY_SECTIONS) {
    const items: readonly { readonly id: string }[] = profile[section];
    const names = assignFileNames(section, items.map((item) => item.id));
    const fileOf = (id: string): string => `${(names.get(id) as EntityNaming).fileName}.md`;
    const ordered = [...items].sort((a, b) => (fileOf(a.id) < fileOf(b.id) ? -1 : 1));
    if (ordered.some((item, index) => item.id !== items[index]?.id)) {
      reordered.push(section);
    }
    sorted[section] = ordered;
    naming[section] = names;
  }
  return { profile: { ...profile, ...sorted } as MasterProfile, reordered, naming: naming as SectionNaming };
}

function unrepresentable(profile: MasterProfile): string[] {
  const problems: string[] = [];
  const check = (path: string, items: readonly MasterProfile['achievements'][number][]): void => {
    items.forEach((item, index) => {
      const problem = achievementProblem(item);
      if (problem !== undefined) {
        problems.push(`${path}[${index}].text («${item.id}»): ${problem}`);
      }
    });
  };
  profile.experience.forEach((item, index) => check(`experience[${index}].achievements`, item.achievements));
  profile.projects.forEach((item, index) => check(`projects[${index}].achievements`, item.achievements));
  check('achievements', profile.achievements);
  return problems;
}

/** Los ficheros que representan el perfil (ya en orden canónico), según `docs/portability.md` §4.4. */
export function planFiles(profile: MasterProfile, sectionNaming: SectionNaming = canonicalOrder(profile).naming): PlannedFile[] {
  const files: PlannedFile[] = [{ path: 'profile.md', content: serializeProfileFile(profile) }];
  const entity = (section: EntitySection, serialized: { readonly fileName: string; readonly content: string }): void => {
    files.push({ path: `${section}/${serialized.fileName}.md`, content: serialized.content });
  };
  const naming = (section: EntitySection): ((id: string) => EntityNaming) => {
    const names = sectionNaming[section];
    return (id) => names.get(id) as EntityNaming;
  };
  const specialty = naming('specialties');
  for (const item of profile.specialties) {
    entity('specialties', serializeSpecialty(item, specialty(item.id)));
  }
  const experience = naming('experience');
  for (const item of profile.experience) {
    entity('experience', serializeExperience(item, experience(item.id)));
  }
  const project = naming('projects');
  for (const item of profile.projects) {
    entity('projects', serializeProject(item, project(item.id)));
  }
  const education = naming('education');
  for (const item of profile.education) {
    entity('education', serializeEducation(item, education(item.id)));
  }
  if (profile.achievements.length > 0) {
    files.push({ path: 'achievements.md', content: serializeAchievementsFile(profile.achievements) });
  }
  if (profile.skills.length > 0) {
    files.push({ path: 'skills.csv', content: serializeSkills(profile.skills) });
  }
  if (profile.certifications.length > 0) {
    files.push({ path: 'certifications.csv', content: serializeCertifications(profile.certifications) });
  }
  return files;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Rutas JSON en las que dos valores difieren (las primeras `limit`), sin depender del orden de las claves. */
export function diffPaths(expected: unknown, actual: unknown, path = '', limit = 20): string[] {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      return [`${path === '' ? '<raíz>' : path}: ${expected.length} elementos frente a ${actual.length}`];
    }
    const differences: string[] = [];
    expected.forEach((item, index) => {
      if (differences.length < limit) {
        differences.push(...diffPaths(item, actual[index], `${path}[${index}]`, limit - differences.length));
      }
    });
    return differences;
  }
  if (isRecord(expected) && isRecord(actual)) {
    const differences: string[] = [];
    for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      if (differences.length < limit) {
        differences.push(...diffPaths(expected[key], actual[key], path === '' ? key : `${path}.${key}`, limit - differences.length));
      }
    }
    return differences;
  }
  return expected === actual ? [] : [`${path === '' ? '<raíz>' : path}: ${JSON.stringify(expected)} frente a ${JSON.stringify(actual)}`];
}

const PLAN_ROOT = '/plan';

/**
 * Valida el perfil, genera las fuentes y las vuelve a leer con el cargador real: si el perfil que sale
 * no es el que entró, el plan no vale y se explica dónde difiere. Nada se escribe aquí.
 */
export async function planImport(context: Pick<AppContext, 'parsers'>, input: unknown): Promise<PlanResult> {
  const validation = validateMasterProfile(input);
  if (!validation.ok) {
    const lines = validation.issues.map((issue) => `${issue.path === '' ? '<raíz>' : issue.path}: ${issue.message}`);
    return { ok: false, error: dataError(`El perfil no es válido (${pluralize(lines.length, 'problema', 'problemas')})`, lines) };
  }
  const problems = unrepresentable(validation.profile);
  if (problems.length > 0) {
    return { ok: false, error: dataError('Hay logros que las fuentes Markdown no pueden representar tal cual', problems) };
  }
  const { profile, reordered, naming } = canonicalOrder(validation.profile);
  const warnings = reordered.map(
    (section) => `El orden de ${section} pasa a ser el de sus ficheros: ${profile[section].map((item) => item.id).join(', ')}`,
  );
  if (profile.personal.email !== undefined || profile.personal.phone !== undefined) {
    warnings.push('profile.md contendrá datos de contacto (email, teléfono); las fuentes se escriben con permisos 0600');
  }
  const files = planFiles(profile, naming);
  const reread = await loadDataset(PLAN_ROOT, {
    fileSystem: new MemorySourceTree(PLAN_ROOT, new Map(files.map((file) => [file.path, file.content]))),
    parsers: context.parsers,
  });
  if (!reread.ok) {
    return {
      ok: false,
      error: dataError('Las fuentes regeneradas no se pueden volver a leer; no se escribe nada', reread.errors.map(formatDatasetError)),
    };
  }
  const differences = diffPaths(profile, reread.profile);
  if (differences.length > 0) {
    return { ok: false, error: dataError('El perfil regenerado no coincide con el importado; no se escribe nada', differences) };
  }
  const counts: ImportCounts = {
    specialties: profile.specialties.length,
    experience: profile.experience.length,
    projects: profile.projects.length,
    education: profile.education.length,
    achievements: profile.achievements.length,
    skills: profile.skills.length,
    certifications: profile.certifications.length,
  };
  return { ok: true, plan: { files, counts, warnings, profile } };
}

/* ───────────────────────────────── import ───────────────────────────────── */

export interface ImportOptions {
  readonly data: string;
  /** Sustituir un directorio de fuentes con contenido, renombrándolo entero como copia. */
  readonly replace?: boolean | undefined;
  /** Solo planificar y comprobar; no escribir. */
  readonly dryRun?: boolean | undefined;
}

export interface ImportOutcome {
  readonly plan: ImportPlan;
  readonly root: string;
  readonly dryRun: boolean;
  /** Rutas relativas escritas (vacío en `dryRun`). */
  readonly written: readonly string[];
  /** Directorio al que se renombraron las fuentes anteriores, si las había. */
  readonly backup: string | undefined;
}

export type ImportResult = { readonly ok: true; readonly outcome: ImportOutcome } | { readonly ok: false; readonly error: AppError };

type TargetState = { readonly ok: true; readonly state: 'missing' | 'empty' | 'occupied'; readonly entries: readonly string[] } | { readonly ok: false; readonly error: AppError };

/** Qué hay en el destino: nada, un directorio vacío (los ficheros ocultos no cuentan) o contenido; un enlace simbólico se rechaza. */
async function inspectTarget(context: Pick<AppContext, 'datasetFileSystem'>, root: string): Promise<TargetState> {
  let siblings: readonly { readonly name: string; readonly kind: string }[];
  try {
    siblings = await context.datasetFileSystem.readDirectory(dirname(root));
  } catch {
    return { ok: true, state: 'missing', entries: [] };
  }
  const entry = siblings.find((candidate) => candidate.name === basename(root));
  if (entry === undefined) {
    return { ok: true, state: 'missing', entries: [] };
  }
  if (entry.kind === 'symlink') {
    return { ok: false, error: unsafePathError(`El directorio de fuentes «${root}» es un enlace simbólico: no se escribe a través de enlaces`) };
  }
  if (entry.kind !== 'directory') {
    return { ok: false, error: environmentError(`La ruta de fuentes «${root}» no es un directorio`) };
  }
  const entries = (await context.datasetFileSystem.readDirectory(root)).map((child) => child.name).filter((name) => !name.startsWith('.')).sort();
  return { ok: true, state: entries.length === 0 ? 'empty' : 'occupied', entries };
}

function stamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** `<root>.<AAAAMMDD-HHMMSS>.bak`; si ya existe, `.1`, `.2`…: una copia anterior nunca se pisa. */
export async function backupDirectory(context: Pick<AppContext, 'datasetFileSystem' | 'now'>, root: string): Promise<string> {
  const base = `${root}.${stamp(context.now?.() ?? new Date())}.bak`;
  let candidate = base;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await context.datasetFileSystem.stat(candidate);
    } catch {
      return candidate;
    }
    candidate = `${base}.${attempt}`;
  }
}

export async function importProfile(context: AppContext, input: unknown, options: ImportOptions): Promise<ImportResult> {
  const planned = await planImport(context, input);
  if (!planned.ok) {
    return planned;
  }
  const root = resolve(context.cwd, options.data);
  const target = await inspectTarget(context, root);
  if (!target.ok) {
    return target;
  }
  if (target.state === 'occupied' && options.replace !== true) {
    const sample = target.entries.slice(0, 5).join(', ');
    return {
      ok: false,
      error: conflictError(
        `El directorio de fuentes «${root}» no está vacío (${sample}${target.entries.length > 5 ? ', …' : ''}): use --replace para sustituirlo con copia de seguridad, o --data con otro directorio`,
      ),
    };
  }
  if (options.dryRun === true) {
    return { ok: true, outcome: { plan: planned.plan, root, dryRun: true, written: [], backup: undefined } };
  }
  let backup: string | undefined;
  if (target.state === 'occupied') {
    backup = await backupDirectory(context, root);
    try {
      await context.artifactFileSystem.rename(root, backup);
    } catch (error) {
      return { ok: false, error: environmentError(`No se pudo apartar «${root}» como «${backup}»: ${describeError(error)}`) };
    }
  }
  const written: string[] = [];
  for (const file of planned.plan.files) {
    const result = await writeSource(context, root, { path: file.path, content: file.content, expectedSha256: '*' });
    if (!result.ok) {
      const lines = [
        ...written.map((path) => `escrito: ${join(root, path)}`),
        ...(backup === undefined ? [] : [`las fuentes anteriores siguen en ${backup}`]),
      ];
      return { ok: false, error: { ...result.error, message: `Importación interrumpida en «${file.path}»: ${result.error.message}`, lines } };
    }
    written.push(file.path);
  }
  return { ok: true, outcome: { plan: planned.plan, root, dryRun: false, written, backup } };
}
