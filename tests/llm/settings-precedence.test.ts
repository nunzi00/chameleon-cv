import { describe, expect, it } from 'vitest';

import { LLM_ENV, QuotaLedger, formatLlmStatus, llmStatus, resolveLlmConfig, selectProvider, type JsonHttp, type LlmStatus, type QuotaObserver } from '../../src/llm';

const FILE = { provider: 'openai-compatible' as const, base_url: 'http://127.0.0.1:8080', model: 'del-fichero', models: { openai: 'gpt-del-fichero' } };

/** Responde a la salud de ambos proveedores locales: `/v1/models` (data) y `/api/tags` (models). */
const http: JsonHttp = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    data: { data: [{ id: 'del-fichero' }, { id: 'de-la-orden' }], models: [{ name: 'del-fichero' }, { name: 'de-la-orden' }, { name: 'qwen2.5:7b-instruct' }] },
  });

describe('precedencia orden > entorno > cv.toml > defecto', () => {
  it('cada campo toma el primer valor presente y recuerda su origen', () => {
    expect(resolveLlmConfig({}, { settings: FILE })).toEqual({
      ok: true,
      config: { provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080', model: 'del-fichero', sources: { provider: 'file', baseUrl: 'file', model: 'file' } },
    });
    expect(resolveLlmConfig({ [LLM_ENV.model]: 'del-entorno' }, { settings: FILE })).toMatchObject({ ok: true, config: { model: 'del-entorno', sources: { provider: 'file', model: 'env' } } });
    expect(resolveLlmConfig({ [LLM_ENV.model]: 'del-entorno' }, { model: 'de-la-orden', provider: 'ollama', settings: FILE })).toMatchObject({
      ok: true,
      config: { provider: 'ollama', baseUrl: 'http://127.0.0.1:8080', model: 'de-la-orden', sources: { provider: 'flag', baseUrl: 'file', model: 'flag' } },
    });
    expect(resolveLlmConfig({}, { settings: {} })).toMatchObject({ ok: true, config: { provider: 'ollama', sources: { provider: 'default', baseUrl: 'default', model: 'default' } } });
    expect(resolveLlmConfig({}, { model: '  ' })).toMatchObject({ ok: true, config: { sources: { model: 'default' } } });
  });

  it('un cv.toml con URL no local o proveedor remoto falla con el origen en el mensaje', () => {
    expect(resolveLlmConfig({}, { settings: { base_url: 'http://192.168.1.2:11434' } as never })).toEqual({
      ok: false,
      message: 'cv.toml [llm].base_url=«http://192.168.1.2:11434» no es una dirección local (loopback): los proveedores remotos exigen --provider explícito',
    });
    expect(resolveLlmConfig({}, { settings: { provider: 'openai' } as never })).toMatchObject({ ok: false, message: expect.stringMatching(/^cv\.toml \[llm\]\.provider=«openai» es un proveedor remoto/) as string });
    expect(resolveLlmConfig({}, { provider: 'nada' as never })).toMatchObject({ ok: false, message: expect.stringMatching(/^--provider=«nada» no es un proveedor conocido/) as string });
  });

  it('selectProvider usa cv.toml para lo local, [llm.models] para el modelo del remoto, y un cv.toml inválido lo bloquea todo', async () => {
    expect(await selectProvider({}, { env: {}, http, settings: FILE })).toMatchObject({ ok: true, provider: { id: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080', model: 'del-fichero' } });
    expect(await selectProvider({ model: 'de-la-orden' }, { env: {}, http, settings: FILE })).toMatchObject({ ok: true, provider: { model: 'de-la-orden' } });
    const remoteHttp = (): JsonHttp => http;
    expect(await selectProvider({ provider: 'openai' }, { env: { CHAMELEON_OPENAI_API_KEY: 'sk' }, remoteHttp, settings: FILE })).toMatchObject({ ok: true, provider: { id: 'openai', model: 'gpt-del-fichero' } });
    expect(await selectProvider({ provider: 'openai', model: 'gpt-orden' }, { env: { CHAMELEON_OPENAI_API_KEY: 'sk' }, remoteHttp, settings: FILE })).toMatchObject({ ok: true, provider: { model: 'gpt-orden' } });
    expect(await selectProvider({ provider: 'openai' }, { env: { CHAMELEON_OPENAI_API_KEY: 'sk' }, remoteHttp, settings: {} })).toMatchObject({ ok: true, provider: { model: 'gpt-4o-mini' } });
    expect(await selectProvider({}, { env: {}, http, settingsError: 'Configuración inválida (cv.toml)' })).toEqual({ ok: false, message: 'Configuración inválida (cv.toml)' });
  });

  it('selectProvider anota en el libro de cuotas las cabeceras que el cliente remoto observa', async () => {
    const ledger = new QuotaLedger();
    let observer: QuotaObserver | undefined;
    const remoteHttp = (_allowed: readonly string[], _fetch?: typeof fetch, observe?: QuotaObserver): JsonHttp => {
      observer = observe;
      return http;
    };
    const now = () => new Date('2026-08-30T12:00:00.000Z');
    expect(await selectProvider({ provider: 'openai' }, { env: { CHAMELEON_OPENAI_API_KEY: 'sk' }, remoteHttp, quotaLedger: ledger, now })).toMatchObject({ ok: true, provider: { id: 'openai', model: 'gpt-4o-mini' } });
    observer?.({ 'x-ratelimit-remaining-requests': '29', 'x-ratelimit-limit-requests': '30' });
    expect(ledger.get('openai')).toMatchObject({ provider: 'openai', observedAt: '2026-08-30T12:00:00.000Z', remainingRequests: 29, limitRequests: 30 });
    const status = await llmStatus({ env: {}, http, quotaLedger: ledger });
    expect(formatLlmStatus(status)).toContain('    cuota viva: quedan 29/30 peticiones (leída 2026-08-30T12:00:00.000Z)');
    expect(await selectProvider({ provider: 'openai' }, { env: { CHAMELEON_OPENAI_API_KEY: 'sk' }, remoteHttp })).toMatchObject({ ok: true });
    observer?.({ 'retry-after': '3' });
  });

  it('llmStatus describe cv.toml y los orígenes; con cv.toml inválido no comprueba nada', async () => {
    const status = await llmStatus({ env: {}, http, settings: FILE, settingsPath: '/work/cv.toml', settingsPresent: true });
    expect(status.settings).toMatchObject({ path: '/work/cv.toml', present: true, configured: true, error: undefined });
    expect(status.config?.sources).toEqual({ provider: 'file', baseUrl: 'file', model: 'file' });
    const text = formatLlmStatus(status);
    expect(text).toContain('Proveedor local: openai-compatible (http://127.0.0.1:8080; cv.toml) · modelo: del-fichero (cv.toml)');
    expect(text).toContain('Configuración del proyecto: /work/cv.toml (tabla [llm] presente)');
    const flagged = await llmStatus({ env: {}, http, provider: 'ollama', model: 'de-la-orden', settings: FILE, settingsPath: '/work/cv.toml', settingsPresent: true });
    expect(flagged.config?.sources).toEqual({ provider: 'flag', baseUrl: 'file', model: 'flag' });
    expect(formatLlmStatus(flagged)).toContain('(http://127.0.0.1:8080; orden) · modelo: de-la-orden (orden)');
    const modelOnly = await llmStatus({ env: {}, http, model: 'de-la-orden', settings: FILE });
    expect(modelOnly.config?.sources).toEqual({ provider: 'file', baseUrl: 'file', model: 'flag' });
    const absent = await llmStatus({ env: {}, http, settingsPath: '/work/cv.toml' });
    expect(formatLlmStatus(absent)).toContain('Configuración del proyecto: /work/cv.toml (no existe)');
    const withoutTable = await llmStatus({ env: {}, http, settingsPath: '/work/cv.toml', settingsPresent: true });
    expect(formatLlmStatus(withoutTable)).toContain('(sin tabla [llm])');
    const invalid = await llmStatus({ env: {}, http, settingsError: 'Configuración inválida (/work/cv.toml):\n  - llm.provider: …', settingsPath: '/work/cv.toml', settingsPresent: true });
    expect(invalid).toMatchObject({ config: undefined, configError: expect.stringMatching(/^Configuración inválida/) as string, usable: false, settings: { error: expect.any(String) as string } });
    expect(formatLlmStatus(invalid)).toContain('Configuración del proyecto: /work/cv.toml (inválida)');
    const noPath: LlmStatus = await llmStatus({ env: {}, http });
    expect(formatLlmStatus(noPath)).not.toContain('Configuración del proyecto');
  });
});
