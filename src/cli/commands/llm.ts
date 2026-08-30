/**
 * `cv llm status [--provider <id>] [--model <m>]` (T-4.2/T-4.5): proveedor local que usaría el
 * co-piloto y si responde; procedencia de las claves remotas (nunca su valor) y lista blanca.
 * Solo con `--provider <remoto>` explícito se comprueba ese proveedor en la red.
 */
import {
  REMOTE_PROVIDER_IDS,
  describeKeys,
  formatLlmStatus,
  formatRuntimeState,
  isRemoteProviderId,
  isRuntimeRunner,
  keysFilePath,
  removeApiKey,
  writeApiKey,
  type KeyPresence,
  type RuntimeResult,
} from '../../llm';
import type { CliContext } from '../context';
import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK } from '../output';

export interface LlmStatusCommandOptions {
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
}

export async function runLlmStatus(context: CliContext, options: LlmStatusCommandOptions = {}): Promise<number> {
  const status = await context.llmStatus({ provider: options.provider, model: options.model });
  context.stdout(formatLlmStatus(status));
  if (context.llmRuntime !== undefined) {
    context.stdout(`${formatRuntimeState(await context.llmRuntime.status())}\n`);
  }
  const remoteUsable = status.remote === undefined ? true : !('error' in status.remote) && status.remote.health.ok && status.remote.health.modelAvailable;
  return (status.usable || status.remote !== undefined) && remoteUsable ? EXIT_OK : EXIT_FAILURE;
}

/* ─────────────────────────── cv llm up / down (T-8.8) ─────────────────────────── */

export interface LlmRuntimeCommandOptions {
  readonly model?: string | undefined;
  readonly runner?: string | undefined;
  /** `--no-pull` lo pone a `false`. */
  readonly pull?: boolean | undefined;
  readonly json?: boolean | undefined;
}

function reportRuntime(context: CliContext, result: RuntimeResult, json: boolean): number {
  const code = result.ok ? EXIT_OK : result.code === 'invalid-model' ? EXIT_DATA_ERROR : EXIT_FAILURE;
  if (json) {
    context.stdout(`${JSON.stringify(result, null, 2)}\n`);
    return code;
  }
  if (!result.ok) {
    context.stderr(`${result.message}\n`);
    return code;
  }
  context.stdout(`${formatRuntimeState(result.state)}\n`);
  return code;
}

/** `cv llm up [--model] [--runner native|docker] [--no-pull] [--json]`: arranca el Ollama local y asegura el modelo. */
export async function runLlmUp(context: CliContext, options: LlmRuntimeCommandOptions = {}): Promise<number> {
  if (context.llmRuntime === undefined) {
    context.stderr('El runtime de Ollama no está disponible en este contexto\n');
    return EXIT_FAILURE;
  }
  const runner = options.runner?.trim().toLowerCase();
  if (runner !== undefined && runner !== '' && !isRuntimeRunner(runner)) {
    context.stderr(`--runner debe ser native o docker (no «${options.runner}»)\n`);
    return EXIT_DATA_ERROR;
  }
  const json = options.json === true;
  const result = await context.llmRuntime.up({
    model: options.model,
    runner: runner === undefined || runner === '' ? undefined : runner,
    pull: options.pull,
    progress: json ? undefined : (line) => context.stdout(`${line}\n`),
  });
  return reportRuntime(context, result, json);
}

/** `cv llm down [--json]`: para el Ollama que arrancó cv; nunca uno ajeno. */
export async function runLlmDown(context: CliContext, options: LlmRuntimeCommandOptions = {}): Promise<number> {
  if (context.llmRuntime === undefined) {
    context.stderr('El runtime de Ollama no está disponible en este contexto\n');
    return EXIT_FAILURE;
  }
  const json = options.json === true;
  const result = await context.llmRuntime.down();
  if (!json) {
    for (const line of result.lines) {
      context.stdout(`${line}\n`);
    }
  }
  return reportRuntime(context, result, json);
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
