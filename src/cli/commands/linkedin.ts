/**
 * `cv linkedin` (T-9.27): el plan para poner LinkedIn al día a partir de tus fuentes. Cliente delgado de
 * `linkedinPlan`: agrupa por acción —añadir, corregir y lo que le falta a tu perfil antes de subirlo— y deja
 * el texto listo para copiar.
 */
import { linkedinPlan, type PlanAction, type PlanItem } from '../../app/linkedin';
import type { CliContext } from '../context';
import { EXIT_OK, reportError } from '../output';

export interface LinkedinOptions {
  readonly data: string;
  /** Borrador con lo exportado de LinkedIn (`import/<nombre>`). */
  readonly draft?: string | undefined;
  readonly json?: boolean | undefined;
}

const TITLES: Readonly<Record<PlanAction, string>> = {
  add: 'Añadir en LinkedIn',
  fix: 'Corregir en LinkedIn (tus fuentes son la referencia)',
  pending: 'Antes de subirlo: lo que le falta a tu perfil',
};

/** Un apunte con su cuerpo sangrado, para que se vea de un vistazo qué se copia y qué es la instrucción. */
function describe(item: PlanItem): string {
  const body = item.body === undefined ? '' : `${item.body.split('\n').map((line) => `      ${line}`).join('\n')}\n`;
  const reason = item.reason === undefined ? '' : `      ${item.reason}\n`;
  return `  - ${item.title}\n${body}${reason}`;
}

export async function runLinkedin(context: CliContext, options: LinkedinOptions): Promise<number> {
  const result = await linkedinPlan(context, { data: options.data, ...(options.draft === undefined ? {} : { draft: options.draft }) });
  if (!result.ok) {
    return reportError(context, result.error);
  }
  const { plan } = result;
  if (options.json === true) {
    context.stdout(`${JSON.stringify(plan, null, 2)}\n`);
    return EXIT_OK;
  }
  for (const action of ['add', 'fix', 'pending'] as const) {
    const items = plan.items.filter((item) => item.action === action);
    if (items.length === 0) {
      continue;
    }
    context.stdout(`${TITLES[action]} (${items.length.toString()})\n`);
    for (const item of items) {
      context.stdout(describe(item));
    }
    context.stdout('\n');
  }
  // Sin borrador no se puede decir qué sobra ni qué está mal: solo qué tienes tú. Conviene que se sepa.
  if (plan.draft === undefined) {
    context.stderr('Sin un borrador de LinkedIn con el que comparar: el plan solo dice qué tienes tú. Exporta tu perfil e impórtalo con «cv import-cv <fichero>» para saber además qué corregir\n');
  }
  return EXIT_OK;
}
