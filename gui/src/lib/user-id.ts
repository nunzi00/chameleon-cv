/**
 * El identificador de un usuario del espacio de trabajo, con la MISMA regla que el servidor
 * (`src/app/users.ts`): minúsculas, dígitos y guiones, de 1 a 40, sin empezar ni terminar en guión.
 * Que no admita punto ni barra es lo que hace imposible que un identificador salga de `usuarios/`.
 * Se comprueba aquí para poder decirlo antes de pedir nada, no para confiar en el navegador.
 */
export const USER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function isUserId(value: string): boolean {
  return USER_ID_PATTERN.test(value);
}
