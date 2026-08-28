/** Mensaje legible de cualquier valor lanzado (`Error` o no). */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
