/**
 * Capa de proveedores de modelos (T-4.2, `docs/llm-integration.md`): HTTP contenido, contrato
 * `LlmProvider`, proveedores locales (Ollama, compatible con OpenAI), configuración `CHAMELEON_*`,
 * estado y la tarea `improve`. La seudonimización vive en `src/core/llm/redact.ts`.
 */
export * from './cache';
export * from './config';
export * from './http';
export * from './improve-batch';
export * from './ollama';
export * from './openai-compatible';
export * from './provider';
export * from './review';
export * from './status';
export * from './tasks/improve';
