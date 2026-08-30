import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import { ApiError, type ApiClient } from '../lib/api/client';
import type { StatusResponse } from '../lib/api/types';
import Estado from './Estado.svelte';

const STATUS: StatusResponse = {
  version: '1.2.0',
  workspace: '/work',
  artifact: { status: 'stale', detail: 'experience/acme.md', specialties: ['backend'] },
  typst: { required: '0.15.1', candidates: [], selected: undefined, usable: true },
  llm: { config: undefined, configError: undefined, health: undefined, keys: {} as StatusResponse['llm']['keys'], keysFile: '', allowedHosts: [], remote: undefined, usable: false, settings: { path: undefined, present: false, configured: false, error: undefined }, providers: [] },
  themes: { defaultName: 'default', configWarning: undefined, roots: [], entries: [] },
};

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    status: vi.fn(async () => STATUS),
    validate: vi.fn(async () => ({ root: '/work/data/sources', files: [{ path: 'a' }, { path: 'b' }] as never, summary: '2 experiencias' })),
    build: vi.fn(async () => ({ artifactPath: '/work/data/dist/profile.json', files: [] as never, summary: 'ok' })),
    profile: vi.fn(),
    sources: vi.fn(),
    source: vi.fn(),
    writeSource: vi.fn(),
    generate: vi.fn(),
    analyze: vi.fn(),
    extractOffer: vi.fn(),
    themes: vi.fn(),
    createTheme: vi.fn(),
    outputs: vi.fn(),
    output: vi.fn(), reviews: vi.fn(), review: vi.fn(), writeReview: vi.fn(), deleteReview: vi.fn(), applyReview: vi.fn(),
    jobs: vi.fn(),
    job: vi.fn(),
    startJob: vi.fn(),
    cancelJob: vi.fn(),
    jobEvents: vi.fn(),
    exportProfile: vi.fn(), importProfile: vi.fn(), llmConfig: vi.fn(), writeLlmConfig: vi.fn(), checkLlm: vi.fn(), shutdown: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  };
}

describe('Estado', () => {
  it('muestra el estado, valida y compila, y refleja los mensajes', async () => {
    const api = fakeApi();
    render(Estado, { props: { api, onsession: vi.fn(), onopen: vi.fn() } });
    await waitFor(() => expect(screen.getByText('obsoleto: compila para actualizarlo')).toBeTruthy());
    expect(screen.getByText('experience/acme.md')).toBeTruthy();
    expect(screen.getByText('Especialidades: backend')).toBeTruthy();
    expect(screen.getByText('utilizable (0.15.1)')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Validar' }));
    await waitFor(() => expect(screen.getByText('Fuentes válidas: 2 ficheros · 2 experiencias')).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Compilar' }));
    await waitFor(() => expect(screen.getByText('Artefacto compilado en /work/data/dist/profile.json · ok')).toBeTruthy());
    expect(api.status).toHaveBeenCalledTimes(3);
  });

  it('con problemas de validación los lista y permite abrir el fichero; un 401 avisa de la sesión', async () => {
    const onopen = vi.fn();
    const onsession = vi.fn();
    const api = fakeApi({
      validate: vi.fn(async () => {
        throw new ApiError(422, { code: 'invalid-data', message: '1 problema', issues: [{ file: 'experience/acme.md', line: 4, message: 'falta company' }] });
      }),
      build: vi.fn(async () => {
        throw new ApiError(401, { code: 'unauthorized', message: 'token' });
      }),
    });
    render(Estado, { props: { api, onsession, onopen } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Validar' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Validar' }));
    await waitFor(() => expect(screen.getByText('1 problema en las fuentes')).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'experience/acme.md:4' }));
    expect(onopen).toHaveBeenCalledWith('experience/acme.md', 4);
    await fireEvent.click(screen.getByRole('button', { name: 'Compilar' }));
    await waitFor(() => expect(onsession).toHaveBeenCalled());
    expect(screen.getByText('La sesión no es válida')).toBeTruthy();
  });

  it('apagar pide confirmación y deja la pantalla en «servidor detenido»', async () => {
    const api = fakeApi();
    render(Estado, { props: { api, onsession: vi.fn(), onopen: vi.fn() } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apagar el servidor' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Apagar el servidor' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(api.shutdown).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Apagar el servidor' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apagar' }));
    await waitFor(() => expect(screen.getByText('Servidor detenido')).toBeTruthy());
    expect(api.shutdown).toHaveBeenCalledTimes(1);
  });
});
