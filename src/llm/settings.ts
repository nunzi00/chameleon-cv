/**
 * La tabla `[llm]` de `cv.toml` (T-8.2, `docs/copilot-settings.md` §4.1): el proveedor **local** y su
 * modelo, y en `[llm.models]` el modelo por defecto de cada remoto (no lo selecciona: C3). Aquí viven el
 * esquema, la serialización y la **sustitución quirúrgica** de la tabla en el texto del fichero: el
 * resto de `cv.toml` —comentarios incluidos— queda byte a byte como estaba.
 */
import { z } from 'zod';

import { isLoopbackUrl } from './http';
import { REMOTE_PROVIDER_IDS, type RemoteProviderId } from './registry';

z.config(z.locales.es());

export const LOCAL_PROVIDER_ID_VALUES = ['ollama', 'openai-compatible'] as const;

const ModelName = z.string().trim().min(1).max(120);

export const LlmSettingsSchema = z.strictObject({
  provider: z.enum(LOCAL_PROVIDER_ID_VALUES, { error: `provider debe ser un proveedor local (${LOCAL_PROVIDER_ID_VALUES.join(', ')}): los remotos exigen --provider explícito en cada orden` }).optional(),
  base_url: z
    .string()
    .trim()
    .refine(isLoopbackUrl, { error: 'base_url debe ser una dirección local (loopback): los proveedores remotos exigen --provider explícito' })
    .optional(),
  model: ModelName.optional(),
  /** `[llm.runtime]`: preferencias de `cv llm up` (T-8.8): runner forzado e imagen de Ollama para el runner docker. */
  runtime: z
    .strictObject({
      runner: z.enum(['native', 'docker']).optional(),
      image: z.string().trim().min(1).max(200).optional(),
    })
    .optional(),
  /** `[llm.models]`: modelo por defecto por proveedor remoto. */
  models: z.strictObject(Object.fromEntries(REMOTE_PROVIDER_IDS.map((id) => [id, ModelName.optional()])) as Record<RemoteProviderId, z.ZodOptional<typeof ModelName>>).optional(),
});

export type LlmSettings = z.output<typeof LlmSettingsSchema>;

/** Cadena básica de TOML (las secuencias de escape de JSON son válidas en TOML). */
function tomlString(value: string): string {
  return JSON.stringify(value);
}

/** El texto de la tabla `[llm]` (y `[llm.models]` si hay modelos), con salto final; solo las claves presentes. */
export function serializeLlmTable(settings: LlmSettings): string {
  const lines = ['[llm]'];
  if (settings.provider !== undefined) {
    lines.push(`provider = ${tomlString(settings.provider)}`);
  }
  if (settings.base_url !== undefined) {
    lines.push(`base_url = ${tomlString(settings.base_url)}`);
  }
  if (settings.model !== undefined) {
    lines.push(`model = ${tomlString(settings.model)}`);
  }
  const models = Object.entries(settings.models ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined);
  if (models.length > 0) {
    lines.push('', '[llm.models]', ...models.map(([provider, model]) => `${provider} = ${tomlString(model)}`));
  }
  const runtime = Object.entries(settings.runtime ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined);
  if (runtime.length > 0) {
    lines.push('', '[llm.runtime]', ...runtime.map(([key, value]) => `${key} = ${tomlString(value)}`));
  }
  return `${lines.join('\n')}\n`;
}

const LLM_HEADER = /^[ \t]*\[[ \t]*llm[ \t]*\][ \t]*(?:#.*)?$/;
const LLM_SUBTABLE_HEADER = /^[ \t]*\[[ \t]*llm[ \t]*\.[^\]]*\][ \t]*(?:#.*)?$/;
const ANY_HEADER = /^[ \t]*\[\[?[^\]]*\]\]?[ \t]*(?:#.*)?$/;

/**
 * Sustituye la tabla `[llm]` (con sus subtablas `[llm.*]` contiguas) por la nueva, o la añade al final si
 * no existe; el resto del texto no cambia. Un `cv.toml` sin `[llm]` y sin salto final recibe la tabla tras
 * una línea en blanco. Devuelve el texto nuevo.
 */
export function replaceLlmTable(text: string, settings: LlmSettings): string {
  const table = serializeLlmTable(settings);
  const lines = text.split('\n');
  const start = lines.findIndex((line) => LLM_HEADER.test(line));
  if (start === -1) {
    if (text === '') {
      return table;
    }
    const separator = text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
    return `${text}${separator}${table}`;
  }
  const next = lines.slice(start + 1).findIndex((line) => ANY_HEADER.test(line) && !LLM_SUBTABLE_HEADER.test(line));
  const end = next === -1 ? lines.length : start + 1 + next;
  // Las líneas en blanco finales del bloque antiguo se conservan como separación con la tabla siguiente.
  let keep = end;
  while (keep > start + 1 && String(lines[keep - 1]).trim() === '') {
    keep -= 1;
  }
  const before = lines.slice(0, start).join('\n');
  const after = lines.slice(keep).join('\n');
  const head = before === '' ? '' : `${before}\n`;
  return `${head}${table}${after}`;
}
