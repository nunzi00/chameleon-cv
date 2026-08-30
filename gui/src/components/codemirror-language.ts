/** Lenguaje del editor por extensión, separado de CodeMirror para que Fuentes lo use sin cargar el editor. */
export type Language = 'markdown' | 'yaml' | 'plain';

export function languageFor(path: string): Language {
  const lower = path.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return 'markdown';
  }
  return lower.endsWith('.yml') || lower.endsWith('.yaml') || lower.endsWith('.toml') ? 'yaml' : 'plain';
}
