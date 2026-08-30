/**
 * Chips de la cabecera de contexto (T-8.6 S1): con la aplicación en cualquier pantalla se sabe, sin navegar, si el
 * artefacto está al día, si Typst está, si el co-piloto responde y si el servidor permite remotos. Una sola consulta
 * de /status (más /config/llm para los remotos) alimenta estos chips en todas las pantallas.
 */
import type { StatusResponse } from './api/types';
import type { IconName } from './icons';
import { describeStatus } from './status';

export type ChipTone = 'ok' | 'warn' | 'error' | 'quiet';

export interface Chip {
  readonly id: 'artifact' | 'typst' | 'copilot' | 'remote';
  readonly tone: ChipTone;
  readonly icon: IconName;
  readonly label: string;
  /** Explicación completa (atributo title): el detalle del estado, cuando lo hay. */
  readonly title: string | undefined;
}

export interface AppContext {
  readonly status: StatusResponse;
  readonly remoteAllowed: boolean;
  readonly reviews: number;
}

const ARTIFACT_LABEL: Readonly<Record<StatusResponse['artifact']['status'], string>> = {
  fresh: 'Artefacto al día',
  stale: 'Artefacto obsoleto',
  missing: 'Sin artefacto',
  invalid: 'Artefacto inválido',
  unknown: 'Artefacto: estado desconocido',
};

export function describeChips(context: AppContext): readonly Chip[] {
  const { status, remoteAllowed } = context;
  const view = describeStatus(status);
  const config = status.llm.config;
  const copilot = status.llm.usable && config !== undefined ? `Co-piloto: ${config.provider} · ${config.model}` : 'Co-piloto sin proveedor';
  return [
    { id: 'artifact', tone: view.artifact.tone, icon: 'check-circle', label: ARTIFACT_LABEL[status.artifact.status], title: view.artifact.detail },
    {
      id: 'typst',
      tone: view.typst.tone,
      icon: 'file',
      label: status.typst.usable ? `Typst ${status.typst.required}` : 'Typst no disponible',
      title: status.typst.usable ? status.typst.selected?.path : `Se requiere Typst ${status.typst.required}`,
    },
    { id: 'copilot', tone: view.llm.tone, icon: 'robot', label: copilot, title: view.llm.detail },
    {
      id: 'remote',
      tone: 'quiet',
      icon: 'shield',
      label: remoteAllowed ? 'Remotos: permitidos' : 'Remotos: no permitidos',
      title: remoteAllowed ? 'cv serve arrancó con --allow-remote' : 'Sin --allow-remote nada sale de esta máquina',
    },
  ];
}

/** Último tramo de la ruta del espacio de trabajo, para la cabecera; la ruta completa va debajo en monoespaciada. */
export function workspaceName(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part !== '');
  return parts.at(-1) ?? path;
}
