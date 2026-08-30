import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import { ApiError, type ApiClient } from '../lib/api/client';
import type { LlmConfigResponse } from '../lib/api/types';
import Ajustes from './Ajustes.svelte';

const PROVIDER: LlmConfigResponse['llm']['providers'][number] = {
  id: 'groq',
  plan: 'free',
  availability: 'available',
  availabilityNote: undefined,
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
      config: { provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080', model: 'qwen', sources: { provider: 'file', baseUrl: 'file', model: 'file' } },
      configError: undefined,
      health: undefined,
      keys: { openai: 'none', anthropic: 'none', groq: 'none' },
      keysFile: '/h/.config/chameleon-cv/keys.json',
      allowedHosts: [],
      remote: undefined,
      usable: false,
      settings: { path: '/work/cv.toml', present: true, configured: true, error: undefined },
      providers: [PROVIDER],
      ...overrides.llm,
    },
    file: overrides.file ?? { path: '/work/cv.toml', present: true, sha256: 'abc' },
    remote: overrides.remote ?? { allowed: false },
  };
}

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    status: vi.fn(), validate: vi.fn(), build: vi.fn(), profile: vi.fn(), sources: vi.fn(), source: vi.fn(), writeSource: vi.fn(), generate: vi.fn(), analyze: vi.fn(), extractOffer: vi.fn(), themes: vi.fn(), createTheme: vi.fn(), installTheme: vi.fn(), verifyTheme: vi.fn(), outputs: vi.fn(), output: vi.fn(), reviews: vi.fn(), review: vi.fn(), writeReview: vi.fn(), deleteReview: vi.fn(), applyReview: vi.fn(), jobs: vi.fn(), job: vi.fn(), startJob: vi.fn(), cancelJob: vi.fn(), jobEvents: vi.fn(), exportProfile: vi.fn(), importProfile: vi.fn(), offerHistory: vi.fn(), shutdown: vi.fn(),
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

  it('rechaza una URL que no es loopback, muestra el 409 al guardar, bloquea lo fijado por el entorno y avisa del 401', async () => {
    const onsession = vi.fn();
    const api = fakeApi({
      llmConfig: vi.fn(async () => response({ llm: { config: { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen', sources: { provider: 'env', baseUrl: 'default', model: 'default' } } } })),
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
        return response({ llm: { config: undefined, configError: 'Configuración inválida (/work/cv.toml)', settings: { path: '/work/cv.toml', present: true, configured: false, error: 'inválido' }, providers: [{ ...PROVIDER, keyPresence: 'env', live: calls > 1 ? live : undefined }] }, remote: { allowed: true }, file: { path: '/work/cv.toml', present: false, sha256: undefined } });
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
    const api = fakeApi({ llmConfig: vi.fn(async () => response({ llm: { providers: [pending] }, remote: { allowed: true } })) });
    render(Ajustes, { props: { api, onsession: vi.fn() } });
    await waitFor(() => expect(screen.getByText(/Pendiente de verificación humana: pendiente de la verificación al alta/)).toBeTruthy());
    const item = screen.getByText('groq', { selector: 'strong' }).closest('li') as HTMLElement;
    expect((within(item).getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });
});
