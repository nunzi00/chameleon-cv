/**
 * El registro de proveedores remotos (T-8.2, `docs/copilot-settings.md` §4.2): datos, no código. Cada
 * remoto entra con su API, su host (de aquí sale la lista blanca), su modelo por defecto, su plan, sus
 * **cuotas publicadas** (con fuente y fecha) y la **evidencia de C7** —URL, fecha y cita literal de la
 * política que declara no entrenar ni retener con los datos enviados por API—. Sin evidencia no hay
 * proveedor (principio 2). La selección del *spike* y la decisión del Director están en
 * `docs/copilot-providers.md`.
 */

export type RemoteProviderId = 'openai' | 'anthropic' | 'groq';

/** Con qué dialecto se habla: el cliente compatible con OpenAI (`/v1/chat/completions`) o Messages de Anthropic. */
export type RemoteApi = 'openai-chat' | 'anthropic-messages';

export interface ProviderEvidence {
  readonly sourceUrl: string;
  /** Fecha de la lectura (AAAA-MM-DD). */
  readonly verifiedAt: string;
  /** Cita literal, en el idioma original. */
  readonly quote: string;
}

export interface ProviderQuota {
  readonly requestsPerMinute?: number | undefined;
  readonly requestsPerDay?: number | undefined;
  readonly tokensPerMinute?: number | undefined;
  readonly tokensPerDay?: number | undefined;
  /** A qué se aplica (plan, modelo, ámbito). */
  readonly note: string;
  readonly sourceUrl: string;
  readonly verifiedAt: string;
}

/**
 * Un remoto entra en el registro con su evidencia, pero solo se puede seleccionar cuando está `available`. Un
 * proveedor `pending-verification` espera la verificación al alta por una persona (docs/copilot-providers.md §9):
 * `cv llm status` y la pantalla Ajustes lo muestran así; `--provider`, `POST /config/llm/check` y el selector del
 * Co-piloto lo rechazan hasta entonces (la clave sí puede guardarse: es el paso 2 del protocolo).
 */
export type ProviderAvailability = 'available' | 'pending-verification';

/** Tarea del co-piloto para la que se recomienda un modelo. */
export type CopilotTask = 'improve' | 'summarize' | 'suggest-tags';

/** Modelo seleccionable de un proveedor remoto, con su estado publicado y para qué tareas se recomienda. */
export interface RemoteModelOption {
  readonly id: string;
  /** `production` = estable; `preview` = el proveedor puede retirarlo sin plazo. */
  readonly status: 'production' | 'preview';
  readonly recommendedFor: readonly CopilotTask[];
  /** Por qué se recomienda (o no) y con qué evidencia. */
  readonly note: string;
  readonly sourceUrl: string;
  readonly verifiedAt: string;
}

export interface RemoteProviderEntry {
  readonly id: RemoteProviderId;
  readonly availability: ProviderAvailability;
  /** Por qué no está disponible todavía (solo `pending-verification`). */
  readonly availabilityNote?: string | undefined;
  readonly api: RemoteApi;
  /** Host de la lista blanca (comparación exacta, solo https). */
  readonly host: string;
  /** URL base a la que el cliente añade sus rutas (`/v1/chat/completions`, `/v1/models`, `/v1/messages`). */
  readonly baseUrl: string;
  readonly defaultModel: string;
  /** Modelos seleccionables (`--model` o `[llm.models]`); el primero es el de por defecto. */
  readonly models: readonly RemoteModelOption[];
  /** `CHAMELEON_<ID>_API_KEY` y `CHAMELEON_<ID>_BASE_URL`. */
  readonly keyEnv: string;
  readonly baseUrlEnv: string;
  readonly plan: 'free' | 'paid';
  /** Límites publicados; ausente cuando dependen del nivel de la cuenta (solo la fuente). */
  readonly quota: ProviderQuota | undefined;
  /** Dónde documenta el proveedor sus límites. */
  readonly rateLimitsUrl: string;
  readonly c7: ProviderEvidence;
  /** Cabeceras de cuota que devuelve (documentadas), en minúsculas. */
  readonly rateLimitHeaders: readonly string[];
}

export const REMOTE_PROVIDERS: readonly RemoteProviderEntry[] = [
  {
    id: 'openai',
    availability: 'available',
    api: 'openai-chat',
    host: 'api.openai.com',
    baseUrl: 'https://api.openai.com',
    defaultModel: 'gpt-4o-mini',
    models: [
      {
        id: 'gpt-4o-mini',
        status: 'production',
        recommendedFor: ['improve', 'summarize', 'suggest-tags'],
        note: 'modelo de pago de bajo coste con salida estructurada (json_schema estricto); único registrado para OpenAI',
        sourceUrl: 'https://platform.openai.com/docs/models',
        verifiedAt: '2026-08-30',
      },
    ],
    keyEnv: 'CHAMELEON_OPENAI_API_KEY',
    baseUrlEnv: 'CHAMELEON_OPENAI_BASE_URL',
    plan: 'paid',
    quota: undefined,
    rateLimitsUrl: 'https://developers.openai.com/api/docs/guides/rate-limits',
    c7: {
      sourceUrl: 'https://developers.openai.com/api/docs/guides/your-data',
      verifiedAt: '2026-08-30',
      quote: 'As of March 1, 2023, data sent to the OpenAI API is not used to train or improve OpenAI models (unless you explicitly opt in to share data with us).',
    },
    rateLimitHeaders: ['x-ratelimit-limit-requests', 'x-ratelimit-remaining-requests', 'x-ratelimit-reset-requests', 'x-ratelimit-limit-tokens', 'x-ratelimit-remaining-tokens', 'x-ratelimit-reset-tokens'],
  },
  {
    id: 'anthropic',
    availability: 'available',
    api: 'anthropic-messages',
    host: 'api.anthropic.com',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-5',
    models: [
      {
        id: 'claude-sonnet-4-5',
        status: 'production',
        recommendedFor: ['improve', 'summarize', 'suggest-tags'],
        note: 'modelo de pago con herramienta forzada (esquema de la tarea); único registrado para Anthropic',
        sourceUrl: 'https://docs.anthropic.com/en/docs/about-claude/models',
        verifiedAt: '2026-08-30',
      },
    ],
    keyEnv: 'CHAMELEON_ANTHROPIC_API_KEY',
    baseUrlEnv: 'CHAMELEON_ANTHROPIC_BASE_URL',
    plan: 'paid',
    quota: undefined,
    rateLimitsUrl: 'https://platform.claude.com/docs/en/api/rate-limits',
    c7: {
      sourceUrl: 'https://www.anthropic.com/legal/commercial-terms',
      verifiedAt: '2026-08-30',
      quote: 'Anthropic may not train models on Customer Content from Services.',
    },
    rateLimitHeaders: ['anthropic-ratelimit-requests-limit', 'anthropic-ratelimit-requests-remaining', 'anthropic-ratelimit-requests-reset', 'anthropic-ratelimit-tokens-limit', 'anthropic-ratelimit-tokens-remaining', 'anthropic-ratelimit-tokens-reset', 'retry-after'],
  },
  {
    id: 'groq',
    availability: 'pending-verification',
    availabilityNote: 'pendiente de la verificación al alta por una persona (docs/copilot-providers.md §9): no se puede seleccionar hasta entonces',
    api: 'openai-chat',
    host: 'api.groq.com',
    baseUrl: 'https://api.groq.com/openai',
    defaultModel: 'openai/gpt-oss-120b',
    models: [
      {
        id: 'openai/gpt-oss-120b',
        status: 'production',
        recommendedFor: ['improve', 'summarize'],
        note: 'calidad y español probados (MMMLU es 84,6–85,9 %), json_schema estricto y caché de prompt; plan Free: 200 000 tokens/día (≈ una sesión al día). Ideal para reescribir logros y resúmenes cuando el presupuesto diario basta',
        sourceUrl: 'https://console.groq.com/docs/model/openai/gpt-oss-120b',
        verifiedAt: '2026-08-30',
      },
      {
        id: 'qwen/qwen3.8-27b',
        status: 'preview',
        recommendedFor: ['suggest-tags', 'improve', 'summarize'],
        note: 'json_schema estricto, razonamiento desactivable y 2 000 000 tokens/día en el plan Free (≈ diez sesiones): ideal para etiquetas y para sesiones gratuitas con más de una tanda al día; en preview (retirable sin plazo) y sin cifra publicada en español: si falla, volver a openai/gpt-oss-120b',
        sourceUrl: 'https://console.groq.com/docs/model/qwen/qwen3.8-27b',
        verifiedAt: '2026-08-30',
      },
    ],
    keyEnv: 'CHAMELEON_GROQ_API_KEY',
    baseUrlEnv: 'CHAMELEON_GROQ_BASE_URL',
    plan: 'free',
    quota: {
      requestsPerMinute: 30,
      requestsPerDay: 1000,
      tokensPerMinute: 8000,
      tokensPerDay: 200_000,
      note: 'plan Free, por organización, para openai/gpt-oss-120b (otros modelos: 200 000–2 000 000 tokens/día)',
      sourceUrl: 'https://console.groq.com/docs/rate-limits',
      verifiedAt: '2026-08-30',
    },
    rateLimitsUrl: 'https://console.groq.com/docs/rate-limits',
    c7: {
      sourceUrl: 'https://console.groq.com/docs/legal/services-agreement',
      verifiedAt: '2026-08-30',
      quote: 'Groq is not permitted to use Inputs or Outputs for training or fine-tuning any AI Model Services or other models, unless explicitly granted permission or instructed by Customer.',
    },
    rateLimitHeaders: ['x-ratelimit-limit-requests', 'x-ratelimit-remaining-requests', 'x-ratelimit-reset-requests', 'x-ratelimit-limit-tokens', 'x-ratelimit-remaining-tokens', 'x-ratelimit-reset-tokens', 'retry-after'],
  },
];

export const REMOTE_PROVIDER_IDS: readonly RemoteProviderId[] = REMOTE_PROVIDERS.map((entry) => entry.id);

/** Los remotos que se pueden seleccionar hoy. */
export const AVAILABLE_REMOTE_PROVIDER_IDS: readonly RemoteProviderId[] = REMOTE_PROVIDERS.filter((entry) => entry.availability === 'available').map((entry) => entry.id);

/** Mensaje de rechazo de un remoto registrado pero no disponible. */
export function unavailableMessage(entry: RemoteProviderEntry): string {
  return `El proveedor «${entry.id}» está registrado pero ${entry.availabilityNote ?? 'no está disponible'}`;
}

export function isRemoteProviderId(value: string): value is RemoteProviderId {
  return (REMOTE_PROVIDER_IDS as readonly string[]).includes(value);
}

export function remoteProvider(id: RemoteProviderId): RemoteProviderEntry {
  const entry = REMOTE_PROVIDERS.find((candidate) => candidate.id === id);
  if (entry === undefined) {
    throw new Error(`Proveedor remoto sin registrar: ${id}`);
  }
  return entry;
}

/** Los hosts oficiales del registro: lo único permitido si el usuario no amplía la lista. */
export function registryHosts(): string[] {
  return REMOTE_PROVIDERS.map((entry) => entry.host);
}

/** Texto corto de una cuota publicada («30 req/min, 1000 req/día, 8000 tokens/min, 200000 tokens/día»). */
export function describeQuota(quota: ProviderQuota): string {
  const parts = [
    quota.requestsPerMinute === undefined ? undefined : `${quota.requestsPerMinute} req/min`,
    quota.requestsPerDay === undefined ? undefined : `${quota.requestsPerDay} req/día`,
    quota.tokensPerMinute === undefined ? undefined : `${quota.tokensPerMinute} tokens/min`,
    quota.tokensPerDay === undefined ? undefined : `${quota.tokensPerDay} tokens/día`,
  ].filter((part): part is string => part !== undefined);
  return parts.join(', ');
}

/** Modelo recomendado de un proveedor para una tarea: el primero que la lista; si ninguno la lista, el de por defecto. */
export function recommendedModel(entry: RemoteProviderEntry, task: CopilotTask): RemoteModelOption {
  return entry.models.find((model) => model.recommendedFor.includes(task)) ?? entry.models.find((model) => model.id === entry.defaultModel) ?? entry.models[0]!;
}

/** Los modelos de un proveedor en una línea: «id (estado; tareas)». */
export function describeModels(models: readonly RemoteModelOption[]): string {
  return models.map((model) => `${model.id} (${model.status === 'production' ? 'estable' : 'preview'}; ${model.recommendedFor.join(', ')})`).join(' · ');
}

/* ─────────────────────────── Modelos locales (T-8.13) ─────────────────────────── */

/** Cómo razona un modelo local: nunca, conmutable con `think` (Qwen3, gpt-oss) o siempre (destilados de DeepSeek-R1). */
export type LocalThinking = 'none' | 'switchable' | 'always';

/** Modelo local del catálogo: qué es, qué pide a la máquina, de dónde se descarga y con qué evidencia. */
export interface LocalModelEntry {
  /** Etiqueta en Ollama (`familia:tamaño`). */
  readonly id: string;
  readonly family: string;
  readonly thinking: LocalThinking;
  /** Descarga y RAM mínima recomendada, en GiB (los publica la biblioteca de Ollama; el tamaño real se lee al listar). */
  readonly downloadGiB: number;
  readonly minRamGiB: number;
  /** Identificador SPDX de la licencia del modelo. */
  readonly license: string;
  readonly recommendedFor: readonly CopilotTask[];
  /** Por qué está en el catálogo y con qué evidencia. */
  readonly note: string;
  /** Espejo en Hugging Face (`hf.co/<repo>:<cuantización>`) para cuando el registro de Ollama falla; `undefined` si no lo hay. */
  readonly mirror: string | undefined;
  readonly sourceUrl: string;
  readonly verifiedAt: string;
}

/** Hosts a los que se conecta el propio Ollama al descargar (cv no descarga nada: se lo pide a Ollama). */
export const OLLAMA_REGISTRY_HOST = 'registry.ollama.ai';
export const HUGGINGFACE_HOST = 'huggingface.co';

export const LOCAL_DEFAULT_MODEL_ID = 'qwen3:8b';

export const LOCAL_MODELS: readonly LocalModelEntry[] = [
  {
    id: 'qwen3:8b',
    family: 'Qwen3',
    thinking: 'switchable',
    downloadGiB: 5.2,
    minRamGiB: 8,
    license: 'Apache-2.0',
    recommendedFor: ['improve', 'summarize', 'suggest-tags'],
    note: 'modelo por defecto (T-8.11 D3): 16/16 en el arnés de IA en 1,29× el tiempo de qwen2.5 y 5 de 6 reescrituras aceptadas por C2 (docs/qwen3-evaluation.md §4); razonamiento conmutable con `think`; espejo verificado el 2026-08-30',
    mirror: 'hf.co/unsloth/Qwen3-8B-GGUF:Q4_K_M',
    sourceUrl: 'https://ollama.com/library/qwen3',
    verifiedAt: '2026-08-30',
  },
  {
    id: 'qwen2.5:7b-instruct',
    family: 'Qwen2.5',
    thinking: 'none',
    downloadGiB: 4.7,
    minRamGiB: 8,
    license: 'Apache-2.0',
    recommendedFor: ['improve', 'summarize', 'suggest-tags'],
    note: 'el defecto anterior: el más rápido del catálogo en CPU (224 s en el arnés de IA), pero sus reescrituras no superaron la verificación C2 (0 de 6; docs/qwen3-evaluation.md §4)',
    mirror: 'hf.co/bartowski/Qwen2.5-7B-Instruct-GGUF:Q4_K_M',
    sourceUrl: 'https://ollama.com/library/qwen2.5',
    verifiedAt: '2026-08-30',
  },
  {
    id: 'deepseek-r1:8b',
    family: 'DeepSeek-R1',
    thinking: 'always',
    downloadGiB: 5.2,
    minRamGiB: 8,
    license: 'MIT',
    recommendedFor: [],
    note: 'destilado de DeepSeek-R1-0528 sobre Qwen3-8B: razona siempre y, con el GGUF del espejo, no respetó el JSON estricto en improve ni en suggest tags (10/16, 3,5×; docs/qwen3-evaluation.md §4): sin tareas recomendadas, solo para probar',
    mirror: 'hf.co/unsloth/DeepSeek-R1-0528-Qwen3-8B-GGUF:Q4_K_M',
    sourceUrl: 'https://ollama.com/library/deepseek-r1',
    verifiedAt: '2026-08-30',
  },
  {
    id: 'gpt-oss:20b',
    family: 'gpt-oss',
    thinking: 'switchable',
    downloadGiB: 14,
    minRamGiB: 16,
    license: 'Apache-2.0',
    recommendedFor: ['improve', 'summarize', 'suggest-tags'],
    note: 'modelo abierto de OpenAI con razonamiento por niveles; exige 16 GiB de RAM; sin espejo verificado',
    mirror: undefined,
    sourceUrl: 'https://ollama.com/library/gpt-oss',
    verifiedAt: '2026-08-30',
  },
  {
    id: 'qwen3:4b',
    family: 'Qwen3',
    thinking: 'switchable',
    downloadGiB: 2.6,
    minRamGiB: 6,
    license: 'Apache-2.0',
    recommendedFor: ['suggest-tags', 'summarize'],
    note: 'para máquinas justas de memoria: el mismo razonamiento conmutable que qwen3:8b con menos calidad; espejo no verificado',
    mirror: 'hf.co/unsloth/Qwen3-4B-GGUF:Q4_K_M',
    sourceUrl: 'https://ollama.com/library/qwen3',
    verifiedAt: '2026-08-30',
  },
];

/** La entrada del catálogo para una etiqueta de Ollama (`nombre` y `nombre:latest` son el mismo modelo). */
export function localModel(id: string): LocalModelEntry | undefined {
  const name = id.trim().replace(/:latest$/, '');
  return LOCAL_MODELS.find((entry) => entry.id === name);
}

/** Familias que razonan, por patrón, para modelos fuera del catálogo (también nombres `hf.co/<repo>:<tag>`). */
const ALWAYS_THINKING = /(^|\/)(deepseek-r1|qwq|exaone-deep)(?![a-z0-9])/i;
const SWITCHABLE_THINKING = /(^|\/)(qwen3(?!-coder)|gpt-oss|magistral|phi4-(?:mini-)?reasoning)(?![a-z])/i;

/** Cómo razona un modelo: por el catálogo y, fuera de él, por la familia que delata su nombre. */
export function thinkingOf(model: string): LocalThinking {
  const entry = localModel(model);
  if (entry !== undefined) {
    return entry.thinking;
  }
  const name = model.trim();
  if (ALWAYS_THINKING.test(name)) {
    return 'always';
  }
  return SWITCHABLE_THINKING.test(name) ? 'switchable' : 'none';
}

export function describeThinking(thinking: LocalThinking): string {
  return thinking === 'none' ? 'sin razonamiento' : thinking === 'switchable' ? 'razonamiento conmutable' : 'razona siempre';
}
