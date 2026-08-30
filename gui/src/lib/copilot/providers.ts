/**
 * Las opciones del selector «Proveedor» del Co-piloto (docs/copilot-settings.md §4.6): el local efectivo y los
 * remotos del registro, utilizables solo con clave y con un servidor que admita remotos. Sin configuración
 * (o si falla), solo el local.
 */
import type { LlmConfigResponse } from '../api/types';

export interface RemoteOption {
  readonly id: string;
  readonly label: string;
  readonly defaultModel: string;
  readonly usable: boolean;
}

const KEY_LABELS: Readonly<Record<LlmConfigResponse['llm']['providers'][number]['keyPresence'], string>> = {
  env: 'clave en el entorno',
  file: 'clave en el fichero',
  none: 'sin clave',
  'insecure-file': 'fichero de claves con permisos abiertos',
  'invalid-file': 'fichero de claves inválido',
};

export function remoteProviderOptions(config: LlmConfigResponse | undefined): RemoteOption[] {
  if (config === undefined) {
    return [];
  }
  return config.llm.providers.map((provider) => {
    const hasKey = provider.keyPresence === 'env' || provider.keyPresence === 'file';
    const usable = hasKey && config.remote.allowed;
    const reason = !hasKey ? KEY_LABELS[provider.keyPresence] : config.remote.allowed ? KEY_LABELS[provider.keyPresence] : 'el servidor no admite remotos (--allow-remote)';
    return { id: provider.id, label: `${provider.id} · ${provider.plan === 'free' ? 'plan gratuito' : 'plan de pago'} · ${reason}`, defaultModel: provider.defaultModel, usable };
  });
}
