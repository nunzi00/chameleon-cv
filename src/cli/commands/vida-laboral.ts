/**
 * `cv vida-laboral <informe.pdf>` (T-9.28): compara las fechas de tus fuentes con el informe de vida laboral
 * de la Seguridad Social y sugiere correcciones. Cliente delgado de `compareVidaLaboral`: no escribe nada.
 *
 * Del informe solo salen empresas y fechas. El DNI, el número de la Seguridad Social y el domicilio que trae el
 * PDF no se imprimen aquí ni en ningún sitio.
 */
import { compareVidaLaboral, type VidaLaboralItem, type VidaLaboralKind } from '../../app/vida-laboral';
import type { CliContext } from '../context';
import { EXIT_OK, pluralize, reportError } from '../output';

export interface VidaLaboralOptions {
  readonly data: string;
  readonly json?: boolean | undefined;
}

const TITLES: Readonly<Record<VidaLaboralKind, string>> = {
  start: 'Fechas de inicio que no cuadran',
  end: 'Fechas de fin que no cuadran',
  'still-open': 'Empleos que tus fuentes dan por abiertos',
  'missing-in-profile': 'En el informe y no en tus fuentes',
  'missing-in-report': 'En tus fuentes y no en el informe',
};

const ORDER: readonly VidaLaboralKind[] = ['still-open', 'start', 'end', 'missing-in-profile', 'missing-in-report'];

function describe(item: VidaLaboralItem): string {
  const detail = item.detail === undefined || item.detail === '' ? '' : `      ${item.detail}\n`;
  const sources = item.sources === undefined || item.sources.length === 0 ? '' : `      ${item.sources.join(', ')}\n`;
  return `  - ${item.title}\n${detail}${sources}`;
}

export async function runVidaLaboral(context: CliContext, report: string, options: VidaLaboralOptions): Promise<number> {
  const result = await compareVidaLaboral(context, { data: options.data, report });
  if (!result.ok) {
    return reportError(context, result.error);
  }
  if (options.json === true) {
    context.stdout(`${JSON.stringify(result.report, null, 2)}\n`);
    return EXIT_OK;
  }
  for (const kind of ORDER) {
    const items = result.report.items.filter((item) => item.kind === kind);
    if (items.length === 0) {
      continue;
    }
    context.stdout(`${TITLES[kind]} (${items.length.toString()})\n`);
    for (const item of items) {
      context.stdout(describe(item));
    }
    context.stdout('\n');
  }
  const { spells, employers, items } = result.report;
  context.stderr(
    `${pluralize(spells, 'alta de empleo leída', 'altas de empleo leídas')} · ${pluralize(employers, 'empresa', 'empresas')} · ${pluralize(items.length, 'apunte', 'apuntes')}. No se ha cambiado nada: las fechas las corriges tú\n`,
  );
  return EXIT_OK;
}
