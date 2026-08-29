/** CodeMirror 6, cargado bajo demanda (docs/gui-mvp.md §2.3): Markdown para las fuentes, YAML para cv.toml/yaml, texto para CSV. */
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { yaml } from '@codemirror/lang-yaml';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';

export type Language = 'markdown' | 'yaml' | 'plain';

export function languageFor(path: string): Language {
  const lower = path.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return 'markdown';
  }
  return lower.endsWith('.yml') || lower.endsWith('.yaml') || lower.endsWith('.toml') ? 'yaml' : 'plain';
}

export interface EditorHandle {
  getValue(): string;
  setValue(value: string): void;
  destroy(): void;
}

export interface EditorOptions {
  readonly doc: string;
  readonly language: Language;
  readonly onChange: (doc: string) => void;
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
