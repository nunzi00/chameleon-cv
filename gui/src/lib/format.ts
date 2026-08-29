/** Formato para la pantalla, en es-ES. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kib = bytes / 1024;
  return kib < 1024 ? `${kib.toFixed(kib < 10 ? 1 : 0)} KB` : `${(kib / 1024).toFixed(1)} MB`;
}

export function formatDateTime(epochMs: number): string {
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(epochMs));
}

export function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
