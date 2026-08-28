import { MasterProfileSchema, type MasterProfile } from './master-profile';
import { formatPath, type SchemaPath } from './path';

/** Problema detectado al validar; `path` es una expresión de acceso (`experience[0].dates.end`) o `''` para la raíz. */
export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export type ValidationResult =
  | { readonly ok: true; readonly profile: MasterProfile }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

/** Error lanzado por {@link parseMasterProfile}; lista todos los problemas encontrados. */
export class MasterProfileValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    const details = issues.map((issue) => `  - ${issue.path || '<raíz>'}: ${issue.message}`).join('\n');
    super(`MasterProfile inválido (${issues.length} problema(s)):\n${details}`);
    this.name = 'MasterProfileValidationError';
    this.issues = issues;
  }
}

interface RawIssue {
  readonly path: SchemaPath;
  readonly message: string;
}

const toValidationIssue = (issue: RawIssue): ValidationIssue => ({
  path: formatPath(issue.path),
  message: issue.message,
});

/**
 * Valida y sanea un valor desconocido como MasterProfile. Nunca lanza: devuelve el
 * perfil canónico o la lista completa de problemas con su ruta.
 */
export function validateMasterProfile(input: unknown): ValidationResult {
  const result = MasterProfileSchema.safeParse(input);
  if (result.success) {
    return { ok: true, profile: result.data };
  }
  return { ok: false, issues: result.error.issues.map(toValidationIssue) };
}

/**
 * Variante de {@link validateMasterProfile} para los bordes en los que un perfil
 * inválido es un error irrecuperable.
 *
 * @throws {MasterProfileValidationError} con todos los problemas encontrados.
 */
export function parseMasterProfile(input: unknown): MasterProfile {
  const result = validateMasterProfile(input);
  if (result.ok) {
    return result.profile;
  }
  throw new MasterProfileValidationError(result.issues);
}
