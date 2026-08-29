/** Lo que la pantalla Estado muestra, sacado de /status con los campos conocidos del contrato. */
import type { StatusResponse } from './api/types';

export type Tone = 'ok' | 'warn' | 'error';

export interface Indicator {
  readonly tone: Tone;
  readonly label: string;
  readonly detail: string | undefined;
}

export interface StatusView {
  readonly version: string;
  readonly workspace: string;
  readonly artifact: Indicator;
  readonly specialties: readonly string[];
  readonly typst: Indicator;
  readonly llm: Indicator;
  readonly themes: { readonly defaultName: string; readonly count: number; readonly warning: string | undefined };
}

const ARTIFACT: Readonly<Record<StatusResponse['artifact']['status'], { readonly tone: Tone; readonly label: string }>> = {
  fresh: { tone: 'ok', label: 'al día' },
  stale: { tone: 'warn', label: 'obsoleto: compila para actualizarlo' },
  missing: { tone: 'warn', label: 'sin compilar' },
  invalid: { tone: 'error', label: 'inválido' },
  unknown: { tone: 'warn', label: 'estado desconocido' },
};

export function describeStatus(status: StatusResponse): StatusView {
  const artifact = ARTIFACT[status.artifact.status];
  const llmDetail = status.llm.configError ?? (status.llm.health !== undefined && !status.llm.health.ok ? status.llm.health.message : undefined);
  return {
    version: status.version,
    workspace: status.workspace,
    artifact: { tone: artifact.tone, label: artifact.label, detail: status.artifact.detail },
    specialties: status.artifact.specialties,
    typst: { tone: status.typst.usable ? 'ok' : 'warn', label: status.typst.usable ? `utilizable (${status.typst.required})` : `no disponible (se requiere ${status.typst.required}; cv typst install)`, detail: undefined },
    llm: { tone: status.llm.usable ? 'ok' : 'warn', label: status.llm.usable ? 'proveedor local listo' : 'sin proveedor local utilizable', detail: llmDetail },
    themes: { defaultName: status.themes.defaultName, count: status.themes.entries.length, warning: status.themes.configWarning },
  };
}
