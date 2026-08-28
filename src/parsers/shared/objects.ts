export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Elimina recursivamente los valores vacíos (`''`): en el frontmatter, un valor vacío
 * equivale a omitir la clave (`docs/formato-dataset.md` §8.3).
 */
export function stripEmptyValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripEmptyValues(item)).filter((item) => item !== '');
  }
  if (isPlainObject(value)) {
    const cleaned: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const stripped = stripEmptyValues(item);
      if (stripped !== '') {
        cleaned[key] = stripped;
      }
    }
    return cleaned;
  }
  return value;
}
