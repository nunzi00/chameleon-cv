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

export interface RemoteProviderEntry {
  readonly id: RemoteProviderId;
  readonly api: RemoteApi;
  /** Host de la lista blanca (comparación exacta, solo https). */
  readonly host: string;
  /** URL base a la que el cliente añade sus rutas (`/v1/chat/completions`, `/v1/models`, `/v1/messages`). */
  readonly baseUrl: string;
  readonly defaultModel: string;
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
    api: 'openai-chat',
    host: 'api.openai.com',
    baseUrl: 'https://api.openai.com',
    defaultModel: 'gpt-4o-mini',
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
    api: 'anthropic-messages',
    host: 'api.anthropic.com',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-5',
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
    api: 'openai-chat',
    host: 'api.groq.com',
    baseUrl: 'https://api.groq.com/openai',
    defaultModel: 'openai/gpt-oss-120b',
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
