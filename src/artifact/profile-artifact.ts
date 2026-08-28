/**
 * Artefacto canónico `data/dist/profile.json` (`docs/arquitectura.md` §2.4): se escribe de
 * forma atómica (fichero temporal + renombrado) con permisos 0600, y **se re-valida al leer**.
 */
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';

import { validateMasterProfile, type MasterProfile } from '../core/schema';
import { describeError } from '../shared/errors';
import type { WritableFileSystem } from './writable-file-system';

/** Datos personales en claro: solo el propietario puede leerlo. */
export const ARTIFACT_MODE = 0o600;

export type ArtifactResult =
  | { readonly ok: true; readonly profile: MasterProfile }
  | { readonly ok: false; readonly errors: readonly string[] };

export function serializeProfile(profile: MasterProfile): string {
  return `${JSON.stringify(profile, null, 2)}\n`;
}

function defaultSuffix(): string {
  return randomBytes(6).toString('hex');
}

/**
 * Escribe el artefacto: temporal en el mismo directorio, permisos 0600 explícitos (independientes
 * del umask) y renombrado atómico. Si algo falla, el temporal se elimina y el error se propaga.
 */
export async function writeProfileArtifact(
  fs: WritableFileSystem,
  path: string,
  profile: MasterProfile,
  suffix: () => string = defaultSuffix,
): Promise<void> {
  await fs.mkdir(dirname(path));
  const temporary = `${path}.${suffix()}.tmp`;
  try {
    await fs.writeFile(temporary, serializeProfile(profile), ARTIFACT_MODE);
    await fs.chmod(temporary, ARTIFACT_MODE);
    await fs.rename(temporary, path);
  } catch (error) {
    try {
      await fs.remove(temporary);
    } catch {
      // El error original es el que importa; el temporal huérfano es un daño menor.
    }
    throw error;
  }
}

/** `ENOENT` de Node: el fichero no existe. */
export function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/** Lee el artefacto y lo valida contra el esquema: nunca se confía en un fichero de disco. */
export async function readProfileArtifact(fs: WritableFileSystem, path: string): Promise<ArtifactResult> {
  let content: string;
  try {
    content = await fs.readFile(path);
  } catch (error) {
    if (isMissingFile(error)) {
      return { ok: false, errors: [`No existe el artefacto «${path}»: ejecuta «cv build» para generarlo`] };
    }
    return { ok: false, errors: [`No se pudo leer el artefacto «${path}»: ${describeError(error)}`] };
  }
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (error) {
    return { ok: false, errors: [`El artefacto «${path}» no es JSON válido: ${describeError(error)}`] };
  }
  const validation = validateMasterProfile(data);
  if (validation.ok) {
    return { ok: true, profile: validation.profile };
  }
  return {
    ok: false,
    errors: validation.issues.map((issue) => `${path}: ${issue.path === '' ? '<raíz>' : issue.path}: ${issue.message}`),
  };
}
