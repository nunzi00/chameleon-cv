import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import { ApiError, type ApiClient } from '../lib/api/client';
import type { LlmConfigResponse } from '../lib/api/types';
import Ajustes from './Ajustes.svelte';

const PROVIDER: LlmConfigResponse['llm']['providers'][number] = {
  id: 'groq',
  plan: 'free',
  availability: 'available',
  availabilityNote: undefined, dataNote: undefined,
  host: 'api.groq.com',
  baseUrl: 'https://api.groq.com/openai',
  defaultModel: 'openai/gpt-oss-120b', models: [],
  keyPresence: 'none',
  quota: { requestsPerMinute: 30, requestsPerDay: 1000, tokensPerMinute: 8000, tokensPerDay: 200000, note: '', sourceUrl: 'https://console.groq.com/docs/rate-limits', verifiedAt: '2026-08-30' },
  rateLimitsUrl: 'https://console.groq.com/docs/rate-limits',
  c7: { sourceUrl: 'https://console.groq.com/docs/legal/services-agreement', verifiedAt: '2026-08-30', quote: '…' },
  live: undefined,
};

function response(overrides: { llm?: Partial<LlmConfigResponse['llm']>; remote?: LlmConfigResponse['remote']; file?: LlmConfigResponse['file'] } = {}): LlmConfigResponse {
  return {
    llm: {
      config: { provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080', model: 'qwen', context: 16384, sources: { provider: 'file', baseUrl: 'file', model: 'file', context: 'default' } },
      configError: undefined,
      health: undefined,
      keys: { openai: 'none', anthropic: 'none', groq: 'none', gemini: 'none' },
      keysFile: '/h/.config/chameleon-cv/keys.json',
      allowedHosts: [],
      remote: undefined,
      usable: false,
      settings: { path: '/work/cv.toml', present: true, configured: true, error: undefined },
      providers: [PROVIDER],
      ...overrides.llm,
    },
    file: overrides.file ?? { path: '/work/cv.toml', present: true, sha256: 'abc' },
    remote: overrides.remote ?? { allowed: false, configured: undefined, pending: false },
  };
}

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    status: vi.fn(), validate: vi.fn(), build: vi.fn(), profile: vi.fn(), sources: vi.fn(), source: vi.fn(), writeSource: vi.fn(), generate: vi.fn(), analyze: vi.fn(), saveAliases: vi.fn(), applyTags: vi.fn(), rankOffers: vi.fn(), importFolder: vi.fn(), extractOffer: vi.fn(), setLlmKey: vi.fn(), removeLlmKey: vi.fn(), applyImportProposal: vi.fn(), drafts: vi.fn(), draftFiles: vi.fn(), draftFile: vi.fn(), writeDraftFile: vi.fn(), adoptDraftEntries: vi.fn(), importLinkedIn: vi.fn(), importCv: vi.fn(), offers: vi.fn(), offerFetch: vi.fn(), offerSave: vi.fn(), themes: vi.fn(), createTheme: vi.fn(), installTheme: vi.fn(), verifyTheme: vi.fn(), outputs: vi.fn(), output: vi.fn(), reviews: vi.fn(), review: vi.fn(), writeReview: vi.fn(), deleteReview: vi.fn(), applyReview: vi.fn(), jobs: vi.fn(), job: vi.fn(), startJob: vi.fn(), cancelJob: vi.fn(), jobEvents: vi.fn(), exportProfile: vi.fn(), importProfile: vi.fn(), offerHistory: vi.fn(), shutdown: vi.fn(), llmRuntime: vi.fn(), llmModels: vi.fn(), llmRuntimeAction: vi.fn(), sourceHistory: vi.fn(), sourceVersion: vi.fn(), restoreSourceVersion: vi.fn(), writeServeConfig: vi.fn(),
    llmConfig: vi.fn(async () => response()),
    writeLlmConfig: vi.fn(async () => ({ path: '/work/cv.toml', sha256: 'def', llm: {} })),
    checkLlm: vi.fn(async () => ({ provider: 'openai-compatible', kind: 'local' as const, ok: true, models: ['qwen'], modelAvailable: true, message: undefined, quota: undefined })),
    ...overrides,
  };
}

describe('Ajustes', () => {
  it('muestra la configuración efectiva con sus orígenes, guarda la tabla [llm] con la huella y comprueba el local', async () => {
    const api = fakeApi();
    render(Ajustes, { props: { api, onsession: vi.fn() } });
    await waitFor(() => expect(screen.getByText(/Efectivo: openai-compatible \(cv\.toml\)/)).toBeTruthy());
    expect((screen.getByLabelText('Proveedor') as HTMLSelectElement).value).toBe('openai-compatible');
    expect((screen.getByLabelText('Modelo') as HTMLInputElement).value).toBe('qwen');
    await fireEvent.input(screen.getByLabelText('Modelo'), { target: { value: ' otro ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Guardar en cv.toml' }));
    await waitFor(() => expect(screen.getByText(/Guardado en \/work\/cv\.toml/)).toBeTruthy());
    expect(api.writeLlmConfig).toHaveBeenCalledWith({ provider: 'openai-compatible', base_url: 'http://127.0.0.1:8080', model: 'otro' }, 'abc');
    await fireEvent.click(screen.getByRole('button', { name: 'Comprobar' }));
    await waitFor(() => expect(screen.getByText('Responde: 1 modelo (qwen) · el modelo configurado está disponible')).toBeTruthy());
    expect(api.checkLlm).toHaveBeenLastCalledWith({ provider: 'openai-compatible', model: 'qwen' });
    expect(screen.getByText('sin clave')).toBeTruthy();
    expect(screen.getByText(/Cuota publicada: 30 peticiones\/min/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Comprobar groq' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/no envía nada a remotos/)).toBeTruthy();
  });

  it('el conmutador de remotos escribe [serve] allow_remote, avisa del reinicio y muestra el pendiente (T-8.17)', async () => {
    const api = fakeApi({ writeServeConfig: vi.fn(async () => ({ path: '/work/cv.toml', sha256: 'def', serve: { allow_remote: true } })) });
    render(Ajustes, { props: { api, onsession: vi.fn() } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Permitir proveedores remotos' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Permitir proveedores remotos' }));
    await waitFor(() => expect(screen.getByText(/\[serve\] allow_remote = true\. Reinicia «cv serve»/)).toBeTruthy());
    expect(api.writeServeConfig).toHaveBeenCalledWith({ allow_remote: true }, 'abc');

    // Con la clave ya escrita y el proceso todavía sin permiso, la página avisa de que hay que reiniciar.
    const pending = fakeApi({ llmConfig: vi.fn(async () => response({ remote: { allowed: false, configured: true, pending: true } })) });
    render(Ajustes, { props: { api: pending, onsession: vi.fn() } });
    await waitFor(() => expect(screen.getByText(/cv\.toml pide permitirlos: reinicia «cv serve»/)).toBeTruthy());
    expect(screen.getAllByRole('button', { name: 'Prohibir proveedores remotos' }).length).toBeGreaterThan(0);
  });

  it('rechaza una URL que no es loopback, muestra el 409 al guardar, bloquea lo fijado por el entorno y avisa del 401', async () => {
    const onsession = vi.fn();
    const api = fakeApi({
      llmConfig: vi.fn(async () => response({ llm: { config: { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen', context: 16384, sources: { provider: 'env', baseUrl: 'default', model: 'default', context: 'default' } } } })),
      writeLlmConfig: vi.fn(async () => {
        throw new ApiError(409, { code: 'conflict', message: '/work/cv.toml cambió desde que se leyó' });
      }),
    });
    render(Ajustes, { props: { api, onsession } });
    await waitFor(() => expect(screen.getByText(/Proveedor \(fijado por el entorno\)/)).toBeTruthy());
    expect((screen.getByLabelText(/^Proveedor/) as HTMLSelectElement).disabled).toBe(true);
    await fireEvent.input(screen.getByLabelText('URL base'), { target: { value: 'https://api.openai.com' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Guardar en cv.toml' }));
    await waitFor(() => expect(screen.getByText('Ajustes no válidos')).toBeTruthy());
    expect(api.writeLlmConfig).not.toHaveBeenCalled();
    await fireEvent.input(screen.getByLabelText('URL base'), { target: { value: '' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Guardar en cv.toml' }));
    await waitFor(() => expect(screen.getByText(/cambió desde que se leyó/)).toBeTruthy());
    (api.checkLlm as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new ApiError(401, { code: 'unauthorized', message: 'caducó' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Comprobar' }));
    await waitFor(() => expect(onsession).toHaveBeenCalled());
  });

  it('con clave y --allow-remote comprueba el remoto, muestra la cuota viva tras la comprobación y avisa de un cv.toml inválido', async () => {
    const live = { provider: 'groq' as const, observedAt: '2026-08-30T12:00:00.000Z', remainingRequests: 28, limitRequests: 30 };
    let calls = 0;
    const api = fakeApi({
      llmConfig: vi.fn(async () => {
        calls += 1;
        return response({ llm: { config: undefined, configError: 'Configuración inválida (/work/cv.toml)', settings: { path: '/work/cv.toml', present: true, configured: false, error: 'inválido' }, providers: [{ ...PROVIDER, keyPresence: 'env', live: calls > 1 ? live : undefined }] }, remote: { allowed: true, configured: undefined, pending: false }, file: { path: '/work/cv.toml', present: false, sha256: undefined } });
      }),
      checkLlm: vi.fn(async () => ({ provider: 'groq', kind: 'remote' as const, ok: true, models: ['openai/gpt-oss-120b'], modelAvailable: true, message: undefined, quota: live })),
    });
    render(Ajustes, { props: { api, onsession: vi.fn() } });
    await waitFor(() => expect(screen.getByText('Configuración inválida')).toBeTruthy());
    expect(screen.getByText(/admite remotos/)).toBeTruthy();
    expect(screen.getByText('clave en el entorno')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Comprobar groq' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(/Responde: 1 modelo \(openai\/gpt-oss-120b\)/)).toBeTruthy());
    expect(api.checkLlm).toHaveBeenCalledWith({ provider: 'groq' });
    await waitFor(() => expect(screen.getByText(/Cuota viva: quedan 28\/30 peticiones/)).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Guardar en cv.toml' }));
    await waitFor(() => expect(api.writeLlmConfig).toHaveBeenCalledWith({ provider: 'ollama' }, '*'));
  });
});

describe('Ajustes: remotos pendientes de verificación humana', () => {
  it('muestra el aviso del registro y no deja comprobar el proveedor aunque haya clave y remotos permitidos', async () => {
    const pending = { ...PROVIDER, keyPresence: 'env' as const, availability: 'pending-verification' as const, availabilityNote: 'pendiente de la verificación al alta por una persona (docs/copilot-providers.md §9): no se puede seleccionar hasta entonces' };
    const api = fakeApi({ llmConfig: vi.fn(async () => response({ llm: { providers: [pending] }, remote: { allowed: true, configured: undefined, pending: false } })) });
    render(Ajustes, { props: { api, onsession: vi.fn() } });
    await waitFor(() => expect(screen.getByText(/Pendiente de verificación humana: pendiente de la verificación al alta/)).toBeTruthy());
    const item = screen.getByText('groq', { selector: 'strong' }).closest('article') as HTMLElement;
    // La tarjeta tiene ahora también los botones de la clave: se nombra el que interesa, el de comprobar.
    expect((within(item).getByRole('button', { name: /^Comprobar/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Ajustes · Ollama local (T-8.8)', () => {
  const STOPPED = { runner: 'native' as const, candidates: { native: { available: true, reason: 'binario «ollama» (0.33.2)' }, docker: { available: false, reason: 'Docker no responde («docker»)' } }, plan: { runner: 'native' as const, note: 'binario «ollama» (0.33.2)' }, managed: false, running: false, model: { name: 'qwen2.5:7b', present: false }, log: '/h/.cache/chameleon-cv/ollama/serve.log', disabled: undefined, detail: 'Ollama parado · runner native disponible' };
  const RUNNING = { ...STOPPED, managed: true, running: true, model: { name: 'qwen2.5:7b', present: true }, detail: 'Ollama en marcha (native, lo arrancó cv) · modelo «qwen2.5:7b» presente' };

  it('arrancar con el modelo sin descargar pide consentimiento, lanza el trabajo, lo sigue y refresca el estado', async () => {
    let state = STOPPED;
    const api = fakeApi({
      llmRuntime: vi.fn(async () => ({ runtime: state })),
      llmRuntimeAction: vi.fn(async () => ({ job: { id: 'j1', kind: 'ollama-up' as const, status: 'queued' as const, createdAt: '', startedAt: undefined, finishedAt: undefined, lines: [], result: undefined, error: undefined }, sending: {}, warnings: [] })),
      job: vi.fn(async () => {
        state = RUNNING;
        return { job: { id: 'j1', kind: 'ollama-up' as const, status: 'done' as const, createdAt: '', startedAt: undefined, finishedAt: undefined, lines: ['descargando…', 'modelo disponible'], result: undefined, error: undefined } };
      }),
    });
    render(Ajustes, { props: { api, onsession: vi.fn() } });
    await waitFor(() => expect(screen.getByText('Ollama parado · runner native disponible')).toBeTruthy());
    expect(screen.getByText('parado')).toBeTruthy();
    // T-8.14: la vía de arranque y su motivo, en el panel y en el consentimiento.
    expect(screen.getByTestId('runtime-plan').textContent).toBe('Se usará el binario ollama: binario «ollama» (0.33.2).');
    expect((screen.getByRole('button', { name: 'Parar Ollama' }) as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Arrancar Ollama con «qwen2.5:7b»' }));
    expect(screen.getByRole('dialog').textContent).toContain('registro público de Ollama');
    expect(screen.getByRole('dialog').textContent).toContain('Se usará el binario ollama');
    await fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(api.llmRuntimeAction).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Arrancar Ollama con «qwen2.5:7b»' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Descargar y arrancar' }));
    await waitFor(() => expect(screen.getByText('Ollama en marcha (native, lo arrancó cv) · modelo «qwen2.5:7b» presente')).toBeTruthy());
    expect(api.llmRuntimeAction).toHaveBeenCalledWith({ action: 'up' });
    expect(document.querySelector('pre.cv-progress')?.textContent).toBe('descargando…\nmodelo disponible');
    expect((screen.getByRole('button', { name: 'Parar Ollama' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('parar pide confirmación y muestra lo hecho; un trabajo fallido explica el error; sin runtime, el mensaje', async () => {
    let state = RUNNING;
    const api = fakeApi({
      llmRuntime: vi.fn(async () => ({ runtime: state })),
      llmRuntimeAction: vi.fn(async (body: { action: string }) => {
        if (body.action === 'down') {
          state = STOPPED;
          return { runtime: STOPPED, lines: ['Ollama detenido (native)'] };
        }
        return { job: { id: 'j2', kind: 'ollama-up' as const, status: 'queued' as const, createdAt: '', startedAt: undefined, finishedAt: undefined, lines: [], result: undefined, error: undefined }, sending: {}, warnings: [] };
      }),
      job: vi.fn(async () => ({ job: { id: 'j2', kind: 'ollama-up' as const, status: 'failed' as const, createdAt: '', startedAt: undefined, finishedAt: undefined, lines: ['descargando…'], result: undefined, error: { code: 'environment', message: 'la descarga falló', lines: undefined } } })),
    });
    render(Ajustes, { props: { api, onsession: vi.fn() } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Parar Ollama' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Parar Ollama' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Parar' }));
    await waitFor(() => expect(screen.getByText('Ollama detenido (native)')).toBeTruthy());
    expect(api.llmRuntimeAction).toHaveBeenCalledWith({ action: 'down' });
    // Ahora está parado con el modelo ausente: arrancar → consentimiento → el trabajo falla.
    await fireEvent.click(screen.getByRole('button', { name: 'Arrancar Ollama con «qwen2.5:7b»' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Descargar y arrancar' }));
    await waitFor(() => expect(screen.getByText('la descarga falló')).toBeTruthy());
    expect(screen.getByText('Ollama no quedó listo')).toBeTruthy();
  });

  it('cuando el servidor no tiene runtime (503) lo dice sin tratarlo como error; un 401 devuelve a la puerta', async () => {
    const onsession = vi.fn();
    const api = fakeApi({ llmRuntime: vi.fn(async () => Promise.reject(new ApiError(503, { code: 'environment', message: 'El runtime de Ollama no está disponible en este servidor' }))) });
    render(Ajustes, { props: { api, onsession } });
    await waitFor(() => expect(screen.getByText(/Runtime no disponible: .*no está disponible en este servidor/)).toBeTruthy());
    expect(onsession).not.toHaveBeenCalled();
    const expired = fakeApi({ llmRuntime: vi.fn(async () => Promise.reject(new ApiError(401, { code: 'unauthorized', message: 'Caducó' }))) });
    render(Ajustes, { props: { api: expired, onsession } });
    await waitFor(() => expect(onsession).toHaveBeenCalled());
  });
});

describe('Ajustes · catálogo de modelos locales (T-8.13)', () => {
  const entry = (id: string, thinking: 'none' | 'switchable' | 'always', present: boolean, mirror: string | undefined) => ({
    id,
    family: 'x',
    thinking,
    downloadGiB: 5.2,
    minRamGiB: 8,
    license: 'MIT',
    recommendedFor: ['improve' as const],
    note: '',
    mirror,
    sourceUrl: 'https://ollama.com/library/x',
    verifiedAt: '2026-08-30',
    present,
    sizeBytes: undefined,
    configured: id === 'qwen2.5:7b-instruct',
  });
  const MODELS = { catalogue: [entry('qwen2.5:7b-instruct', 'none', true, undefined), entry('qwen3:8b', 'switchable', false, 'hf.co/unsloth/Qwen3-8B-GGUF:Q4_K_M')], others: [], running: true, disabled: undefined };
  const OLLAMA = response({ llm: { config: { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b-instruct', context: 16384, sources: { provider: 'file', baseUrl: 'default', model: 'file', context: 'default' } } } });

  it('con catálogo, el modelo se elige en un selector (con «otro» libre) y think se guarda como [llm] think', async () => {
    // El doble del servidor recuerda lo guardado: tras «Guardar», la pantalla recarga cv.toml y muestra el modelo elegido.
    let current = OLLAMA;
    const api = fakeApi({
      llmConfig: vi.fn(async () => current),
      llmModels: vi.fn(async () => MODELS),
      writeLlmConfig: vi.fn(async (body: { model?: string; think?: boolean }) => {
        current = response({
          llm: {
            config: { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: body.model ?? '', context: 16384, sources: { provider: 'file', baseUrl: 'default', model: 'file', context: 'default' } },
            settings: { path: '/work/cv.toml', present: true, configured: true, error: undefined, values: { provider: 'ollama', ...body } },
          },
        });
        return { path: '/work/cv.toml', sha256: 'def', llm: {} };
      }),
    });
    render(Ajustes, { props: { api, onsession: vi.fn() } });
    await waitFor(() => expect(screen.getByLabelText('Modelo')).toBeTruthy());
    const select = screen.getByLabelText('Modelo') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('qwen2.5:7b-instruct'));
    expect(within(select).getByText('qwen3:8b — razonamiento conmutable · 5.2 GiB · RAM ≥ 8 GiB · no descargado')).toBeTruthy();
    await fireEvent.change(select, { target: { value: 'qwen3:8b' } });
    await fireEvent.click(screen.getByLabelText(/Pedir razonamiento/));
    await fireEvent.click(screen.getByRole('button', { name: 'Guardar en cv.toml' }));
    await waitFor(() => expect(api.writeLlmConfig).toHaveBeenCalledWith({ provider: 'ollama', model: 'qwen3:8b', think: true }, 'abc'));
    await waitFor(() => expect(screen.getByText(/modelo qwen3:8b \(cv\.toml\)/)).toBeTruthy());
    expect((screen.getByLabelText(/Pedir razonamiento/) as HTMLInputElement).checked).toBe(true);
    await fireEvent.change(screen.getByLabelText('Modelo'), { target: { value: '__otro__' } });
    const free = screen.getByLabelText('Nombre del modelo en Ollama') as HTMLInputElement;
    expect(free.value).toBe('qwen3:8b');
    await fireEvent.input(free, { target: { value: 'llama3:8b' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Guardar en cv.toml' }));
    await waitFor(() => expect(api.writeLlmConfig).toHaveBeenLastCalledWith({ provider: 'ollama', model: 'llama3:8b', think: true }, 'abc'));
  });

  it('sin catálogo (runtime ausente) el campo sigue siendo libre y el consentimiento cita el espejo cuando lo hay', async () => {
    const api = fakeApi({ llmConfig: vi.fn(async () => OLLAMA), llmModels: vi.fn(async () => Promise.reject(new ApiError(503, { code: 'environment', message: 'sin runtime' }))) });
    render(Ajustes, { props: { api, onsession: vi.fn() } });
    await waitFor(() => expect((screen.getByLabelText('Modelo') as HTMLInputElement).tagName).toBe('INPUT'));
    const STOPPED = { runner: 'native' as const, candidates: { native: { available: true, reason: 'binario «ollama» (0.33.2)' }, docker: { available: false, reason: 'Docker no responde («docker»)' } }, plan: { runner: 'native' as const, note: 'binario «ollama» (0.33.2)' }, managed: false, running: false, model: { name: 'qwen3:8b', present: false }, log: '/h/serve.log', disabled: undefined, detail: 'Ollama parado · runner native disponible' };
    const withModels = fakeApi({ llmConfig: vi.fn(async () => OLLAMA), llmModels: vi.fn(async () => MODELS), llmRuntime: vi.fn(async () => ({ runtime: STOPPED })) });
    render(Ajustes, { props: { api: withModels, onsession: vi.fn() } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Arrancar Ollama con «qwen3:8b»' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Arrancar Ollama con «qwen3:8b»' }));
    expect(screen.getByRole('dialog').textContent).toContain('se descarga el espejo «hf.co/unsloth/Qwen3-8B-GGUF:Q4_K_M» desde huggingface.co');
  });

});

describe('Ajustes · claves de proveedores remotos', () => {
  it('guarda la clave de un proveedor desde la página y limpia el campo (nunca hay clave que enseñar)', async () => {
    const setLlmKey = vi.fn(async () => ({ provider: 'groq', source: 'file', keysFile: '/home/lucas/.config/chameleon-cv/keys.json' }));
    const api = fakeApi({ setLlmKey });
    render(Ajustes, { props: { api, onsession: vi.fn() } });
    const field = await waitFor(() => screen.getByLabelText('Clave de groq') as HTMLInputElement);
    // El campo es de contraseña y sin autocompletado: la clave no se muestra ni la guarda el navegador.
    expect(field.type).toBe('password');
    expect(field.autocomplete).toBe('off');
    await fireEvent.input(field, { target: { value: '  sk-secreta  ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Guardar clave' }));
    await waitFor(() => expect(screen.getByText('Clave guardada')).toBeTruthy());
    // Se envía sin los espacios de alrededor y el campo queda vacío.
    expect(setLlmKey).toHaveBeenCalledWith('groq', 'sk-secreta');
    expect((screen.getByLabelText('Clave de groq') as HTMLInputElement).value).toBe('');
  });

  it('avisa cuando la variable de entorno sigue mandando, y borrar lo dice aunque no hubiera clave', async () => {
    const setLlmKey = vi.fn(async () => ({ provider: 'groq', source: 'env', keysFile: '/k.json' }));
    const removeLlmKey = vi.fn(async () => ({ provider: 'groq', source: 'none', keysFile: '/k.json', removed: false }));
    const api = fakeApi({ setLlmKey, removeLlmKey, llmConfig: vi.fn(async () => response({ llm: { providers: [{ ...PROVIDER, keyPresence: 'file' }] } })) });
    render(Ajustes, { props: { api, onsession: vi.fn() } });
    const field = await waitFor(() => screen.getByLabelText('Clave de groq'));
    await fireEvent.input(field, { target: { value: 'sk-otra' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Guardar clave' }));
    await waitFor(() => expect(screen.getByText('Guardada, pero manda la variable de entorno')).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Borrar clave' }));
    await waitFor(() => expect(screen.getByText('No había clave que borrar')).toBeTruthy());
  });

  it('un fallo al guardar la clave se explica en su sitio y no se pierde lo escrito', async () => {
    const setLlmKey = vi.fn(async () => {
      throw new ApiError(422, { code: 'invalid-data', message: 'La clave no puede contener saltos de línea' });
    });
    const api = fakeApi({ setLlmKey });
    render(Ajustes, { props: { api, onsession: vi.fn() } });
    const field = await waitFor(() => screen.getByLabelText('Clave de groq'));
    await fireEvent.input(field, { target: { value: 'mala' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Guardar clave' }));
    await waitFor(() => expect(screen.getByText(/saltos de línea/)).toBeTruthy());
    expect((screen.getByLabelText('Clave de groq') as HTMLInputElement).value).toBe('mala');
  });
});
