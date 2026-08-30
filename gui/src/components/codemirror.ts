/** CodeMirror 6, cargado bajo demanda (docs/gui-mvp.md §2.3): Markdown para las fuentes, YAML para cv.toml/yaml, texto para CSV. */
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { yaml } from '@codemirror/lang-yaml';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';

import { languageFor, type Language } from './codemirror-language';

export { languageFor, type Language };

export interface EditorHandle {
  getValue(): string;
  setValue(value: string): void;
  destroy(): void;
}

export interface EditorOptions {
  readonly doc: string;
  readonly language: Language;
  readonly onChange: (doc: string) => void;
  /** Posición del cursor (línea y columna desde 1) para el pie del editor. */
  readonly onCursor?: ((line: number, column: number) => void) | undefined;
}

function languageExtension(language: Language): Extension {
  if (language === 'markdown') {
    return markdown();
  }
  return language === 'yaml' ? yaml() : [];
}

export function createEditor(parent: HTMLElement, options: EditorOptions): EditorHandle {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        syntaxHighlighting(defaultHighlightStyle),
        languageExtension(options.language),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            options.onChange(update.state.doc.toString());
          }
          if (options.onCursor !== undefined && (update.selectionSet || update.docChanged || update.focusChanged)) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            options.onCursor(line.number, head - line.from + 1);
          }
        }),
      ],
    }),
  });
  return {
    getValue: () => view.state.doc.toString(),
    setValue: (value) => {
      if (value !== view.state.doc.toString()) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
      }
    },
    destroy: () => view.destroy(),
  };
}
