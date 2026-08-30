/**
 * `cv llm status [--provider <id>] [--model <m>]` (T-4.2/T-4.5): proveedor local que usaría el
 * co-piloto y si responde; procedencia de las claves remotas (nunca su valor) y lista blanca.
 * Solo con `--provider <remoto>` explícito se comprueba ese proveedor en la red.
 */
import { REMOTE_PROVIDER_IDS, describeKeys, formatLlmStatus, isRemoteProviderId, keysFilePath, removeApiKey, writeApiKey, type KeyPresence } from '../../llm';
import type { CliContext } from '../context';
import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK } from '../output';

export interface LlmStatusCommandOptions {
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
}

export async function runLlmStatus(context: CliContext, options: LlmStatusCommandOptions = {}): Promise<number> {
  const status = await context.llmStatus({ provider: options.provider, model: options.model });
  context.stdout(formatLlmStatus(status));
  const remoteUsable = status.remote === undefined ? true : !('error' in status.remote) && status.remote.health.ok && status.remote.health.modelAvailable;
  return (status.usable || status.remote !== undefined) && remoteUsable ? EXIT_OK : EXIT_FAILURE;
}

/* ─────────────────────────── cv llm key (T-8.2) ─────────────────────────── */

function unknownProvider(context: CliContext, provider: string): number {
  context.stderr(`«${provider}» no es un proveedor remoto conocido (${REMOTE_PROVIDER_IDS.join(', ')})\n`);
  return EXIT_DATA_ERROR;
}

/**
 * `cv llm key set <proveedor>`: la clave entra por la pregunta sin eco (terminal) o por la entrada
 * estándar (sin terminal); nunca por argumento, nunca se imprime. Se guarda en el fichero de claves con 0600.
 */
export async function runLlmKeySet(context: CliContext, provider: string): Promise<number> {
  const id = provider.trim().toLowerCase();
  if (!isRemoteProviderId(id)) {
    return unknownProvider(context, provider);
  }
  const key = context.readSecret === undefined ? await context.stdin() : await context.readSecret(`Clave de ${id} (no se mostrará): `);
  const result = await writeApiKey(id, key);
  if (!result.ok) {
    context.stderr(`${result.message}\n`);
    return EXIT_FAILURE;
  }
  context.stdout(`Clave de «${id}» guardada en ${result.file} (permisos 0600)\n`);
  return EXIT_OK;
}

export async function runLlmKeyRemove(context: CliContext, provider: string): Promise<number> {
  const id = provider.trim().toLowerCase();
  if (!isRemoteProviderId(id)) {
    return unknownProvider(context, provider);
  }
  const result = await removeApiKey(id);
  if (!result.ok) {
    context.stderr(`${result.message}\n`);
    return EXIT_FAILURE;
  }
  context.stdout(result.removed ? `Clave de «${id}» eliminada de ${result.file}\n` : `No había clave de «${id}» en ${result.file}\n`);
  return EXIT_OK;
}

const PRESENCE_LABELS: Readonly<Record<KeyPresence, string>> = {
  env: 'variable de entorno',
  file: 'fichero de claves',
  none: 'ninguna',
  'insecure-file': 'fichero de claves con permisos abiertos (chmod 600)',
  'invalid-file': 'fichero de claves inválido',
};

/** `cv llm key list`: procedencia de cada clave, nunca su valor. */
export async function runLlmKeyList(context: CliContext): Promise<number> {
  const keys = await describeKeys();
  context.stdout(`Fichero de claves: ${keysFilePath()}\n`);
  for (const id of REMOTE_PROVIDER_IDS) {
    context.stdout(`${id}: ${PRESENCE_LABELS[keys[id]]}\n`);
  }
  return EXIT_OK;
}
