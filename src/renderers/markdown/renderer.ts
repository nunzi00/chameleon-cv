/**
 * MarkdownRenderer (T-1.7): `MasterProfile` → CV en Markdown. La plantilla Handlebars no
 * contiene lógica: recibe el modelo de vista ya formateado (`view.ts`). `noEscape` es correcto
 * porque la salida es Markdown y el contenido ya está saneado por el esquema.
 */
import Handlebars from 'handlebars';

import type { MasterProfile } from '../../core/schema';
import { loadBaseTemplate } from './template';
import { buildCvView, type CvView } from './view';

export interface RenderOptions {
  /** Locale para etiquetas y fechas; por defecto `meta.locale` y, en su ausencia, castellano. */
  readonly locale?: string;
  /** Código fuente de una plantilla Handlebars propia; por defecto, `templates/cv.md.hbs`. */
  readonly template?: string;
}

export const DEFAULT_LOCALE = 'es';

/**
 * Deja el Markdown limpio sin que quien edite la plantilla tenga que pelear con Handlebars:
 * sin espacios finales, nunca más de una línea vacía seguida, sin líneas vacías iniciales y
 * con exactamente un salto de línea final.
 */
export function normalizeMarkdown(text: string): string {
  const trimmedLines = text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');
  return `${trimmedLines.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '')}\n`;
}

/** Aplica una plantilla a un modelo de vista. */
export function renderView(view: CvView, template: string): string {
  const compile = Handlebars.create().compile<CvView>(template, { noEscape: true });
  return normalizeMarkdown(compile(view));
}

export function renderMarkdownCv(profile: MasterProfile, options: RenderOptions = {}): string {
  const locale = options.locale ?? profile.meta.locale ?? DEFAULT_LOCALE;
  return renderView(buildCvView(profile, locale), options.template ?? loadBaseTemplate());
}
