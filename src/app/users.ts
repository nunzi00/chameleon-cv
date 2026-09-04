/**
 * Usuarios de un espacio de trabajo (T-9.32): varias personas —«lucas», «invitado1»— en el mismo
 * directorio, cada una con su espacio COMPLETO en `usuarios/<id>/`.
 *
 * La idea entera cabe en una frase: **un usuario es un espacio de trabajo dentro del espacio de
 * trabajo**. Toda la lógica del producto resuelve sus rutas contra `context.cwd` —fuentes, artefacto,
 * salidas, historial, borradores, ofertas y revisiones—, así que cambiar de usuario es cambiar esa
 * raíz y nada más: no hay una segunda implementación de nada. `cv serve --workspace` ya demostraba
 * que la raíz es un parámetro; esto la nombra.
 *
 * Un usuario es una frontera de ORGANIZACIÓN, no de seguridad (decidido con el director el 2026-09-04):
 * el modelo de amenazas del producto es un servidor en tu máquina, en loopback, con un token; poner
 * contraseñas daría una sensación de aislamiento falsa sobre ficheros que el mismo usuario del sistema
 * operativo lee con `cat`. Quien tiene el token los ve todos, y la documentación lo dice así.
 */
import { resolve } from 'node:path';

import { readProfileArtifact } from '../artifact';
import type { AppContext } from './context';
import { DEFAULT_ARTIFACT_PATH, DEFAULT_DATA_DIR } from './defaults';
import { conflictError, notFoundError, unsafePathError, usageError, type AppError } from './errors';
import { SOURCE_FILE_MODE } from './sources';

/** Directorio que contiene los usuarios, en la raíz del espacio de trabajo. */
export const USERS_DIRNAME = 'usuarios';

/**
 * Identificador de usuario: minúsculas, dígitos y guiones, de 1 a 40, sin empezar ni terminar en guión.
 * Es a la vez un nombre de directorio y un valor de cabecera HTTP; que no admita punto ni barra es lo
 * que hace imposible que un identificador manipulado salga de `usuarios/`.
 */
export const USER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function isUserId(id: string): boolean {
  return USER_ID_PATTERN.test(id);
}

export function usersRoot(cwd: string): string {
  return resolve(cwd, USERS_DIRNAME);
}

/** La raíz de un usuario; `undefined` si el identificador no es válido. */
export function userRoot(cwd: string, id: string): string | undefined {
  return isUserId(id) ? resolve(usersRoot(cwd), id) : undefined;
}

export interface UserSummary {
  readonly id: string;
  /** Ruta absoluta de su espacio de trabajo. */
  readonly root: string;
  /** Tiene `data/sources/`: se puede trabajar con él. */
  readonly sources: boolean;
  /** El nombre del artefacto compilado, si existe y es válido; sirve para reconocerlo en un selector. */
  readonly name: string | undefined;
}

async function isDirectory(context: Pick<AppContext, 'datasetFileSystem'>, path: string): Promise<boolean> {
  try {
    return (await context.datasetFileSystem.stat(path)).kind === 'directory';
  } catch {
    return false;
  }
}

/**
 * El nombre que muestra el selector: sale del artefacto y solo si es válido. No tenerlo nunca es un
 * error —un usuario recién creado todavía no ha compilado nada—, y `readProfileArtifact` ya devuelve
 * el fallo en vez de lanzarlo: ausente, ilegible o inválido son el mismo «todavía no hay nombre».
 */
async function nameOf(context: Pick<AppContext, 'artifactFileSystem'>, root: string): Promise<string | undefined> {
  const artifact = await readProfileArtifact(context.artifactFileSystem, resolve(root, DEFAULT_ARTIFACT_PATH));
  return artifact.ok ? artifact.profile.personal.fullName : undefined;
}

async function summaryOf(context: Pick<AppContext, 'datasetFileSystem' | 'artifactFileSystem'>, root: string, id: string): Promise<UserSummary> {
  return { id, root, sources: await isDirectory(context, resolve(root, DEFAULT_DATA_DIR)), name: await nameOf(context, root) };
}

/**
 * Los usuarios del espacio de trabajo, por orden alfabético. Que no exista `usuarios/` no es un error:
 * es un espacio de trabajo clásico, que sigue funcionando exactamente igual que antes.
 */
export async function listUsers(context: Pick<AppContext, 'cwd' | 'datasetFileSystem' | 'artifactFileSystem'>): Promise<readonly UserSummary[]> {
  const root = usersRoot(context.cwd);
  let entries;
  try {
    entries = await context.datasetFileSystem.readDirectory(root);
  } catch {
    return [];
  }
  const ids = entries
    .filter((entry) => entry.kind === 'directory' && isUserId(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'es'));
  return Promise.all(ids.map((id) => summaryOf(context, resolve(root, id), id)));
}

/** La raíz del espacio de trabajo del usuario, comprobando que existe. */
export async function resolveUser(context: Pick<AppContext, 'cwd' | 'datasetFileSystem'>, id: string): Promise<{ readonly root: string } | { readonly error: AppError }> {
  const root = userRoot(context.cwd, id);
  if (root === undefined) {
    return { error: unsafePathError(`Identificador de usuario no válido «${id}»: minúsculas, dígitos y guiones, sin empezar ni terminar en guión`) };
  }
  return (await isDirectory(context, root)) ? { root } : { error: notFoundError(`No existe el usuario «${id}» en ${usersRoot(context.cwd)}`) };
}

/**
 * El mismo contexto con otra raíz: cambiar de usuario es cambiar `cwd`, y nada más. `withWorkspace`
 * rehace lo poco que había capturado la raíz al construirse (el lector de `cv.toml`).
 */
export function contextForWorkspace<T extends AppContext>(context: T, cwd: string, workspaceRoot: string | undefined): T {
  return { ...context, ...context.withWorkspace?.(cwd, workspaceRoot), cwd, workspaceRoot };
}

/**
 * Lo que se traslada al adoptar la raíz como usuario (`--adopt`): todo lo que es de una persona.
 * `cv.toml` y `themes/` NO están, a propósito: son del espacio de trabajo y se comparten.
 */
export const USER_DIRECTORIES = ['data', 'output', 'import', 'offers', 'revisiones', 'revisiones-archivadas'] as const;

export interface CreateUserRequest {
  readonly id: string;
  /** Traslada el contenido de la raíz (data/, output/, import/, offers/, revisiones/) al usuario nuevo. */
  readonly adopt?: boolean | undefined;
}

export interface CreateUserResult {
  readonly id: string;
  readonly root: string;
  /** Directorios trasladados desde la raíz (solo con `adopt`). */
  readonly adopted: readonly string[];
}

/**
 * Crea `usuarios/<id>/`. Con `adopt`, además, TRASLADA el contenido de la raíz al usuario: es la forma
 * de convertir un espacio de trabajo de una persona en el primero de varios sin copiar ni perder nada
 * —un renombrado por directorio, ni un byte reescrito—. Nunca pisa un usuario existente.
 */
export async function createUser(context: Pick<AppContext, 'cwd' | 'datasetFileSystem' | 'artifactFileSystem'>, request: CreateUserRequest): Promise<CreateUserResult | { readonly error: AppError }> {
  const root = userRoot(context.cwd, request.id);
  if (root === undefined) {
    return { error: unsafePathError(`Identificador de usuario no válido «${request.id}»: minúsculas, dígitos y guiones, sin empezar ni terminar en guión`) };
  }
  if (await isDirectory(context, root)) {
    return { error: conflictError(`Ya existe el usuario «${request.id}» en ${root}`, 2) };
  }
  const moves = request.adopt !== true ? [] : await pendingMoves(context, root);
  await context.artifactFileSystem.mkdir(root);
  const adopted: string[] = [];
  for (const move of moves) {
    await context.artifactFileSystem.rename(move.from, move.to);
    adopted.push(move.name);
  }
  return { id: request.id, root, adopted };
}

async function pendingMoves(context: Pick<AppContext, 'cwd' | 'datasetFileSystem'>, root: string): Promise<readonly { readonly name: string; readonly from: string; readonly to: string }[]> {
  const moves: { readonly name: string; readonly from: string; readonly to: string }[] = [];
  for (const name of USER_DIRECTORIES) {
    const from = resolve(context.cwd, name);
    if (await isDirectory(context, from)) {
      moves.push({ name, from, to: resolve(root, name) });
    }
  }
  return moves;
}

/**
 * Siembra el dataset de ejemplo en un usuario recién creado, igual que `cv init` en un espacio nuevo:
 * mejor un perfil sintético que compila que un directorio vacío en el que no se sabe por dónde empezar.
 * No escribe `.gitignore`: el del espacio de trabajo ya cubre a todos los usuarios.
 */
export async function seedUserSources(context: Pick<AppContext, 'assets' | 'datasetFileSystem' | 'artifactFileSystem'>, root: string): Promise<void> {
  await copyTree(context, await context.assets.directory('templates/dataset'), resolve(root, DEFAULT_DATA_DIR));
}

async function copyTree(context: Pick<AppContext, 'datasetFileSystem' | 'artifactFileSystem'>, from: string, to: string): Promise<void> {
  await context.artifactFileSystem.mkdir(to);
  for (const entry of await context.datasetFileSystem.readDirectory(from)) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    if (entry.kind === 'directory') {
      await copyTree(context, resolve(from, entry.name), resolve(to, entry.name));
    } else if (entry.kind === 'file') {
      await context.artifactFileSystem.writeFile(resolve(to, entry.name), await context.datasetFileSystem.readTextFile(resolve(from, entry.name)), SOURCE_FILE_MODE);
    }
  }
}

export interface RemoveUserResult {
  readonly id: string;
  /** El espacio del usuario, renombrado entero: borrar no borra (C9). */
  readonly backup: string;
}

/**
 * Retira un usuario. No borra: renombra su espacio entero a `usuarios/<id>.<marca>.bak`, el mismo
 * procedimiento que `cv import --replace`. Un CV que costó meses no se pierde por una orden.
 */
export async function removeUser(
  context: Pick<AppContext, 'cwd' | 'datasetFileSystem' | 'artifactFileSystem' | 'now'>,
  id: string,
  backupPath: (context: Pick<AppContext, 'datasetFileSystem' | 'now'>, root: string) => Promise<string>,
): Promise<RemoveUserResult | { readonly error: AppError }> {
  const resolved = await resolveUser(context, id);
  if ('error' in resolved) {
    return resolved;
  }
  const backup = await backupPath(context, resolved.root);
  await context.artifactFileSystem.rename(resolved.root, backup);
  return { id, backup };
}

export interface WorkspaceSelection {
  /** Raíz efectiva: la del usuario, o la del espacio de trabajo cuando no hay usuario elegido. */
  readonly root: string;
  readonly user: string | undefined;
  /** Se trabaja sobre la raíz habiendo usuarios: se dice, para que nunca sea una sorpresa. */
  readonly notice?: string | undefined;
}

/**
 * La raíz con la que trabajar. Sin usuario elegido se trabaja sobre la raíz, como siempre; pero si la
 * raíz ya no tiene fuentes y sí hay usuarios, no se sigue en silencio hacia un «no hay fuentes» que no
 * explica nada: se para y se dice con quién se puede trabajar.
 */
export async function selectWorkspace(context: Pick<AppContext, 'cwd' | 'datasetFileSystem' | 'artifactFileSystem'>, id: string | undefined): Promise<WorkspaceSelection | { readonly error: AppError }> {
  if (id !== undefined && id !== '') {
    const resolved = await resolveUser(context, id);
    return 'error' in resolved ? resolved : { root: resolved.root, user: id };
  }
  const users = await listUsers(context);
  if (await isDirectory(context, resolve(context.cwd, DEFAULT_DATA_DIR))) {
    // La raíz sigue siendo un espacio de trabajo válido y se usa, pero habiendo usuarios se avisa: la
    // orden que se acaba de dar NO es la de ninguno de ellos.
    const notice = users.length === 0 ? undefined : `Trabajando sobre la raíz; este espacio tiene ${String(users.length)} usuario${users.length === 1 ? '' : 's'} (${users.map((user) => user.id).join(', ')}): elige con --user`;
    return { root: context.cwd, user: undefined, notice };
  }
  if (users.length === 0) {
    return { root: context.cwd, user: undefined };
  }
  return {
    error: usageError(`Este espacio de trabajo tiene usuarios y no has elegido ninguno`, [
      `Este espacio de trabajo tiene usuarios y no has elegido ninguno.`,
      `  cv --user ${String(users[0]?.id)} <orden>   (o export CHAMELEON_USER=${String(users[0]?.id)})`,
      `Usuarios: ${users.map((user) => user.id).join(', ')}`,
    ]),
  };
}
