/**
 * `cv init [dir]` (T-2.8, `docs/consolidacion.md` §3): arranque guiado. Crea `data/sources/`
 * con el dataset de ejemplo distribuido en `templates/dataset/` (perfil sintético, sin datos
 * reales) y un `.gitignore` si no existe. Nunca pisa nada: si algún destino existe, lista los
 * conflictos y no escribe ni un fichero.
 */
import { dirname, join, relative, resolve } from 'node:path';

import { isMissingFile } from '../../artifact';
import type { FileSystem } from '../../parsers';
import { describeError } from '../../shared/errors';
import type { CliContext } from '../context';
import { DEFAULT_ARTIFACT_PATH, DEFAULT_DATA_DIR, DEFAULT_OUTPUT_DIR } from '../defaults';
import { EXIT_FAILURE, EXIT_OK, pluralize } from '../output';

/** Dataset de ejemplo distribuido con el paquete. */
export const TEMPLATE_DATASET_DIR = resolve(__dirname, '..', '..', '..', 'templates', 'dataset');

/** Las fuentes contendrán datos personales en cuanto el usuario las edite. */
export const SOURCE_MODE = 0o600;
const GITIGNORE_MODE = 0o644;

/** Rutas que nunca deben versionarse (datos personales en claro). */
export const GITIGNORE_ENTRIES = [`${dirname(DEFAULT_ARTIFACT_PATH)}/`, `${DEFAULT_OUTPUT_DIR}/`] as const;

export interface InitOptions {
  /** Dataset de ejemplo alternativo; por defecto el distribuido (por la capa de assets). */
  readonly template?: string | undefined;
}

/** Ficheros regulares bajo `root` (recursivo, ordenados, rutas relativas con `/`); ignora ocultos y enlaces. */
export async function listTemplateFiles(fs: FileSystem, root: string, prefix = ''): Promise<string[]> {
  const entries = [...(await fs.readDirectory(root))].sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.kind === 'directory') {
      files.push(...(await listTemplateFiles(fs, join(root, entry.name), path)));
    } else if (entry.kind === 'file') {
      files.push(path);
    }
  }
  return files;
}

async function exists(fs: FileSystem, path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

type GitignoreOutcome = 'created' | 'complete' | 'incomplete' | 'unreadable';

/** Crea `.gitignore` si no existe; si existe, solo comprueba que cubre las rutas sensibles. */
async function ensureGitignore(context: CliContext, root: string): Promise<GitignoreOutcome> {
  const path = join(root, '.gitignore');
  let current: string;
  try {
    current = await context.datasetFileSystem.readTextFile(path);
  } catch (error) {
    if (!isMissingFile(error)) {
      return 'unreadable';
    }
    const content = ['# Chameleon CV: datos personales generados, nunca se versionan', ...GITIGNORE_ENTRIES, ''].join('\n');
    await context.artifactFileSystem.writeFile(path, content, GITIGNORE_MODE);
    return 'created';
  }
  const lines = new Set(current.split('\n').map((line) => line.trim()));
  return GITIGNORE_ENTRIES.every((entry) => lines.has(entry) || lines.has(entry.slice(0, -1))) ? 'complete' : 'incomplete';
}

const GITIGNORE_MESSAGES: Readonly<Record<GitignoreOutcome, string>> = {
  created: `.gitignore creado (${GITIGNORE_ENTRIES.join(' y ')} contienen datos personales)`,
  complete: '.gitignore conservado (ya cubre las rutas sensibles)',
  incomplete: `Aviso: añade ${GITIGNORE_ENTRIES.join(' y ')} a tu .gitignore (contienen datos personales)`,
  unreadable: 'Aviso: no se pudo leer .gitignore; comprueba que excluye data/dist/ y output/',
};

export async function runInit(context: CliContext, directory: string, options: InitOptions): Promise<number> {
  const root = resolve(context.cwd, directory);
  const templateRoot = options.template === undefined ? await context.assets.directory('templates/dataset') : resolve(context.cwd, options.template);
  let files: string[];
  try {
    files = await listTemplateFiles(context.datasetFileSystem, templateRoot);
  } catch (error) {
    context.stderr(`No se pudo leer el dataset de ejemplo «${templateRoot}»: ${describeError(error)}\n`);
    return EXIT_FAILURE;
  }
  if (files.length === 0) {
    context.stderr(`El dataset de ejemplo «${templateRoot}» está vacío\n`);
    return EXIT_FAILURE;
  }

  const sourcesRoot = join(root, DEFAULT_DATA_DIR);
  const plan = files.map((file) => ({ source: join(templateRoot, file), target: join(sourcesRoot, file) }));
  const conflicts: string[] = [];
  for (const { target } of plan) {
    if (await exists(context.datasetFileSystem, target)) {
      conflicts.push(relative(root, target));
    }
  }
  if (conflicts.length > 0) {
    context.stderr(`No se ha escrito nada: ${pluralize(conflicts.length, 'destino ya existe', 'destinos ya existen')} en ${sourcesRoot}\n${conflicts.map((path) => `  ${path}`).join('\n')}\n`);
    return EXIT_FAILURE;
  }

  try {
    for (const { source, target } of plan) {
      const content = await context.datasetFileSystem.readTextFile(source);
      await context.artifactFileSystem.mkdir(dirname(target));
      await context.artifactFileSystem.writeFile(target, content, SOURCE_MODE);
    }
  } catch (error) {
    context.stderr(`No se pudo crear el dataset en «${sourcesRoot}»: ${describeError(error)}\n`);
    return EXIT_FAILURE;
  }

  let gitignore: GitignoreOutcome;
  try {
    gitignore = await ensureGitignore(context, root);
  } catch (error) {
    context.stderr(`No se pudo escribir «${join(root, '.gitignore')}»: ${describeError(error)}\n`);
    return EXIT_FAILURE;
  }

  context.stdout(
    [
      `Espacio de trabajo creado en ${root}: ${pluralize(files.length, 'fichero de ejemplo', 'ficheros de ejemplo')} en ${DEFAULT_DATA_DIR} (perfil sintético; sustitúyelo por tus datos)`,
      GITIGNORE_MESSAGES[gitignore],
      'Siguientes pasos:',
      `  1. Edita ${DEFAULT_DATA_DIR}/ (formato: docs/formato-dataset.md y docs/formato-csv.md)`,
      `  2. cv build                    # valida y compila ${DEFAULT_ARTIFACT_PATH}`,
      '  3. cv generate-cv -s backend   # o --format pdf, o -f oferta.txt para adaptarlo a una oferta',
      '',
    ].join('\n'),
  );
  return EXIT_OK;
}
