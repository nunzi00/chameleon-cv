/** Lo que la pantalla Estado muestra, sacado de /status con los campos conocidos del contrato. */
import type { StatusResponse } from './api/types';

export type Tone = 'ok' | 'warn' | 'error';

export interface Indicator {
  readonly tone: Tone;
  readonly label: string;
  readonly detail: string | undefined;
}

export interface ThemeRow {
  readonly name: string;
  /** «integrado», «proyecto» o «instalado desde <URL|archivo|directorio>». */
  readonly origin: string;
  readonly state: Indicator;
}

export interface StatusView {
  readonly version: string;
  readonly workspace: string;
  readonly artifact: Indicator;
  readonly specialties: readonly string[];
  readonly typst: Indicator & { readonly path: string | undefined; readonly version: string | undefined };
  readonly llm: Indicator & { readonly provider: string | undefined; readonly baseUrl: string | undefined; readonly model: string | undefined };
  readonly themes: { readonly defaultName: string; readonly count: number; readonly warning: string | undefined; readonly rows: readonly ThemeRow[] };
}

const ARTIFACT: Readonly<Record<StatusResponse['artifact']['status'], { readonly tone: Tone; readonly label: string }>> = {
  fresh: { tone: 'ok', label: 'al día' },
  stale: { tone: 'warn', label: 'obsoleto: compila para actualizarlo' },
  missing: { tone: 'warn', label: 'sin compilar' },
  invalid: { tone: 'error', label: 'inválido' },
  unknown: { tone: 'warn', label: 'estado desconocido' },
};

const ORIGIN_KIND: Readonly<Record<'url' | 'archive' | 'directory', string>> = { url: 'URL', archive: 'archivo', directory: 'directorio' };

function themeRow(entry: StatusResponse['themes']['entries'][number]): ThemeRow {
  const origin = entry.builtin ? 'integrado' : entry.origin === undefined ? 'proyecto' : `instalado desde ${ORIGIN_KIND[entry.origin.kind]}`;
  if (entry.error !== undefined) {
    return { name: entry.name, origin, state: { tone: 'error', label: 'inválido', detail: entry.error } };
  }
  if (entry.origin?.verified === 'modified') {
    return { name: entry.name, origin, state: { tone: 'warn', label: 'modificado', detail: 'difiere de la huella registrada al instalarlo' } };
  }
  return { name: entry.name, origin, state: { tone: 'ok', label: entry.shadows ? 'intacto · oculta al integrado' : 'intacto', detail: undefined } };
}

export function describeStatus(status: StatusResponse): StatusView {
  const artifact = ARTIFACT[status.artifact.status];
  const llmDetail = status.llm.configError ?? (status.llm.health !== undefined && !status.llm.health.ok ? status.llm.health.message : undefined);
  const config = status.llm.config;
  return {
    version: status.version,
    workspace: status.workspace,
    artifact: { tone: artifact.tone, label: artifact.label, detail: status.artifact.detail },
    specialties: status.artifact.specialties,
    typst: {
      tone: status.typst.usable ? 'ok' : 'warn',
      label: status.typst.usable ? `utilizable (${status.typst.required})` : `no disponible (se requiere ${status.typst.required}; cv typst install)`,
      detail: undefined,
      path: status.typst.selected?.path,
      version: status.typst.selected?.version,
    },
    llm: {
      tone: status.llm.usable ? 'ok' : 'warn',
      label: status.llm.usable ? 'proveedor local listo' : 'sin proveedor local utilizable',
      detail: llmDetail,
      provider: config?.provider,
      baseUrl: config?.baseUrl,
      model: config?.model,
    },
    themes: { defaultName: status.themes.defaultName, count: status.themes.entries.length, warning: status.themes.configWarning, rows: status.themes.entries.map(themeRow) },
  };
}
