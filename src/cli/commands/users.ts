/**
 * `cv users` (T-9.32): los usuarios del espacio de trabajo. Un usuario es un espacio de trabajo dentro
 * del espacio de trabajo (`usuarios/<id>/`), así que crear uno es crear un directorio y sembrarlo con el
 * mismo dataset de ejemplo que `cv init`; retirarlo es apartarlo, nunca borrarlo.
 */
import { relative, resolve } from 'node:path';

import { backupDirectory } from '../../app/portability';
import { USERS_DIRNAME, createUser, listUsers, removeUser, resolveUser, seedUserSources, usersRoot } from '../../app/users';
import type { CliContext } from '../context';
import { EXIT_FAILURE, EXIT_OK, formatTable, pluralize, reportError } from '../output';

export interface UsersCreateOptions {
  /** No siembra el dataset de ejemplo: el usuario nace vacío. */
  readonly empty: boolean;
  /** Traslada al usuario nuevo lo que hay en la raíz (data/, output/, import/, offers/, revisiones/). */
  readonly adopt: boolean;
}

export async function runUsersList(context: CliContext): Promise<number> {
  const users = await listUsers(context);
  if (users.length === 0) {
    context.stdout(`No hay usuarios en ${usersRoot(context.cwd)}\n`);
    context.stdout(`Este espacio de trabajo es de una sola persona; «cv users create <id>» crea el primero.\n`);
    return EXIT_OK;
  }
  const rows = users.map((user) => [user.id, user.name ?? '—', user.sources ? 'sí' : 'no', relative(context.cwd, user.root)]);
  context.stdout(formatTable(['usuario', 'nombre', 'fuentes', 'ruta'], rows));
  context.stdout(`${pluralize(users.length, 'usuario', 'usuarios')} · elige con «cv --user <id> <orden>» o CHAMELEON_USER\n`);
  return EXIT_OK;
}

export async function runUsersPath(context: CliContext, id: string): Promise<number> {
  const resolved = await resolveUser(context, id);
  if ('error' in resolved) {
    return reportError(context, resolved.error);
  }
  context.stdout(`${resolved.root}\n`);
  return EXIT_OK;
}

export async function runUsersCreate(context: CliContext, id: string, options: UsersCreateOptions): Promise<number> {
  if (options.adopt && options.empty) {
    context.stderr('--adopt y --empty se contradicen: o se trae lo de la raíz, o se nace vacío\n');
    return EXIT_FAILURE;
  }
  const created = await createUser(context, { id, adopt: options.adopt });
  if ('error' in created) {
    return reportError(context, created.error);
  }
  context.stdout(`Usuario «${created.id}» creado en ${created.root}\n`);
  if (created.adopted.length > 0) {
    context.stdout(`Trasladado desde la raíz: ${created.adopted.join(', ')}\n`);
    context.stdout(`Si versionas este espacio, añade a .gitignore: ${USERS_DIRNAME}/*/data/dist/ y ${USERS_DIRNAME}/*/output/\n`);
  } else if (!options.empty) {
    await seedUserSources(context, created.root);
    context.stdout(`Sembrado con el dataset de ejemplo (el mismo de «cv init»)\n`);
  }
  context.stdout(`Trabaja con él: cv --user ${created.id} build\n`);
  return EXIT_OK;
}

export async function runUsersRemove(context: CliContext, id: string): Promise<number> {
  const removed = await removeUser(context, id, backupDirectory);
  if ('error' in removed) {
    return reportError(context, removed.error);
  }
  context.stdout(`Usuario «${removed.id}» retirado: su espacio queda entero en ${removed.backup}\n`);
  context.stdout(`Para deshacerlo, renómbralo de vuelta a ${resolve(usersRoot(context.cwd), removed.id)}\n`);
  return EXIT_OK;
}
