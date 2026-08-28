/**
 * `cv llm status` (T-4.2): proveedor y modelo que se usarían, si el servidor local responde,
 * qué modelos sirve y qué claves remotas hay definidas (solo nombres). Nunca envía datos.
 */
import { REMOTE_KEY_VARIABLES, createProvider, definedRemoteKeys, resolveLlmConfig, type LlmConfig } from './config';
import type { JsonHttp } from './http';
import type { LlmHealth } from './provider';

export interface LlmStatus {
  readonly config: LlmConfig | undefined;
  readonly configError: string | undefined;
  readonly health: LlmHealth | undefined;
  readonly remoteKeys: readonly string[];
  /** Hay proveedor válido, responde y sirve el modelo configurado. */
  readonly usable: boolean;
}

export interface LlmStatusOptions {
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly http?: JsonHttp | undefined;
}

export async function llmStatus(options: LlmStatusOptions = {}): Promise<LlmStatus> {
  const env = options.env ?? process.env;
  const remoteKeys = definedRemoteKeys(env);
  const resolved = resolveLlmConfig(env);
  if (!resolved.ok) {
    return { config: undefined, configError: resolved.message, health: undefined, remoteKeys, usable: false };
  }
  const health = await createProvider(resolved.config, options.http).health();
  return { config: resolved.config, configError: undefined, health, remoteKeys, usable: health.ok && health.modelAvailable };
}

const PROVIDER_LABELS = { ollama: 'Ollama', 'openai-compatible': 'servidor compatible con OpenAI' } as const;

export function formatLlmStatus(status: LlmStatus): string {
  const lines: string[] = [];
  if (status.config === undefined) {
    lines.push(`Configuración inválida: ${status.configError}`);
  } else {
    const { config } = status;
    const origin = (source: 'env' | 'default'): string => (source === 'env' ? 'entorno' : 'por defecto');
    lines.push(`Proveedor: ${config.provider} (local, ${config.baseUrl}; ${origin(config.sources.provider)}) · modelo: ${config.model} (${origin(config.sources.model)})`);
    const health = status.health;
    if (health === undefined || !health.ok) {
      lines.push(`Estado: no disponible · ${health?.message ?? 'sin comprobar'}`);
      lines.push(`  Arranca ${PROVIDER_LABELS[config.provider]} en ${config.baseUrl} o configura ${'CHAMELEON_LLM_PROVIDER'}/${'CHAMELEON_LLM_BASE_URL'}/${'CHAMELEON_LLM_MODEL'}`);
    } else {
      const version = health.version === undefined ? '' : ` · versión ${health.version}`;
      const models = health.models.length === 0 ? 'ningún modelo servido' : `${health.models.length} ${health.models.length === 1 ? 'modelo' : 'modelos'} (${health.models.slice(0, 6).join(', ')}${health.models.length > 6 ? ', …' : ''})`;
      lines.push(`Estado: alcanzable${version} · ${models} · ${health.modelAvailable ? 'el modelo configurado está disponible' : `el modelo configurado «${config.model}» no está disponible`}`);
    }
  }
  lines.push(
    status.remoteKeys.length === 0
      ? `Claves remotas: ninguna definida (${REMOTE_KEY_VARIABLES.join(', ')}); los proveedores remotos llegan en T-4.5`
      : `Claves remotas definidas: ${status.remoteKeys.join(', ')} (solo el nombre; los proveedores remotos llegan en T-4.5)`,
  );
  return `${lines.join('\n')}\n`;
}
