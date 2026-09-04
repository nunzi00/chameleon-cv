/**
 * Capa de casos de uso (T-7.4a, docs/api-headless.md §3): el núcleo es su propia API. Funciones de
 * orquestación que reciben un `AppContext` y devuelven datos —nunca texto ni códigos de salida—; la CLI
 * (en proceso) y el servidor HTTP son dos clientes de esta capa.
 */
export * from './aliases';
export * from './analyze';
export * from './rank';
export * from './tags-apply';
export * from './assets';
export * from './context';
export * from './copilot';
export * from './dataset';
export * from './defaults';
export * from './errors';
export * from './format';
export * from './freshness';
export * from './generate';
export * from './limits';
export * from './linkedin';
export * from './offer';
export * from './paths';
export * from './portability';
export * from './provenance';
export * from './review';
export * from './review-undo';
export * from './source-history';
export * from './settings';
export * from './slug';
export * from './source-delete';
export * from './sources';
export * from './tailor';
export * from './text';
export * from './themes';
export * from './vida-laboral';
export * from './workspace';
