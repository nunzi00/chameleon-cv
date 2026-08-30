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
    importCv: vi.fn(),
    offers: vi.fn(),
    offerFetch: vi.fn(),
    offerSave: vi.fn(),
    themes: vi.fn(),
    createTheme: vi.fn(), installTheme: vi.fn(), verifyTheme: vi.fn(),
    outputs: vi.fn(),
    output: vi.fn(), reviews: vi.fn(), review: vi.fn(), writeReview: vi.fn(), deleteReview: vi.fn(), applyReview: vi.fn(),
    jobs: vi.fn(),
    job: vi.fn(),
    startJob: vi.fn(),
    cancelJob: vi.fn(),
    jobEvents: vi.fn(),
    exportProfile: vi.fn(), importProfile: vi.fn(), llmConfig: vi.fn(), writeLlmConfig: vi.fn(), checkLlm: vi.fn(), offerHistory: vi.fn(), llmRuntime: vi.fn(), llmModels: vi.fn(), llmRuntimeAction: vi.fn(), sourceHistory: vi.fn(), sourceVersion: vi.fn(), restoreSourceVersion: vi.fn(), shutdown: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  };
}

describe('Estado', () => {
  it('muestra el estado, valida y compila, y refleja los mensajes', async () => {
    const api = fakeApi();
    render(Estado, { props: { api, onsession: vi.fn(), onopen: vi.fn() } });
    await waitFor(() => expect(screen.getByText('obsoleto: compila para actualizarlo')).toBeTruthy());
    expect(screen.getByText('experience/acme.md')).toBeTruthy();
    expect(screen.getByText('backend').className).toContain('cv-chip');
    expect(screen.getByText('utilizable (0.15.1)')).toBeTruthy();
    expect(screen.getByText('data/sources/')).toBeTruthy();
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
    await waitFor(() => expect(screen.getByText(/1 problema en las fuentes/)).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'experience/acme.md:4' }));
    expect(onopen).toHaveBeenCalledWith('experience/acme.md', 4);
    await fireEvent.click(screen.getByRole('button', { name: 'Compilar' }));
    await waitFor(() => expect(onsession).toHaveBeenCalled());
    expect(screen.getByText('La sesión no es válida')).toBeTruthy();
  });

  it('sin fuentes ni artefacto muestra el vacío con «cv init» y «Volver a comprobar» vuelve a consultar', async () => {
    const api = fakeApi({
      status: vi.fn(async () => ({ ...STATUS, artifact: { status: 'missing' as const, detail: undefined, specialties: [] } })),
      sources: vi.fn(async () => ({ root: '/work/data/sources', entries: [] })),
    });
    render(Estado, { props: { api, onsession: vi.fn(), onopen: vi.fn() } });
    await waitFor(() => expect(screen.getByText('Sin fuentes todavía')).toBeTruthy());
    expect(screen.getByText('$ cv init')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Volver a comprobar' }));
    await waitFor(() => expect(api.status).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Importar un perfil JSON…' })).toBeTruthy();
  });

  it('muestra el recuento de fuentes, la tabla de temas con su origen y comprueba el co-piloto', async () => {
    const api = fakeApi({
      status: vi.fn(async () => ({
        ...STATUS,
        llm: { ...STATUS.llm, config: { provider: 'ollama' as const, baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b', context: 16384, sources: { provider: 'default' as const, baseUrl: 'default' as const, model: 'default' as const, context: 'default' as const } } },
        themes: {
          ...STATUS.themes,
          entries: [
            { name: 'default', directory: '/t/default', builtin: true, shadows: false, description: undefined, author: undefined, license: undefined, homepage: undefined, error: undefined },
            { name: 'nord', directory: '/w/themes/nord', builtin: false, shadows: false, description: undefined, author: undefined, license: undefined, homepage: undefined, error: undefined, origin: { source: 'https://x/nord.zip', kind: 'url' as const, installedAt: '', verified: 'modified' as const } },
          ] as StatusResponse['themes']['entries'],
        },
      })),
      sources: vi.fn(async () => ({ root: '/work/data/sources', entries: [{ path: 'profile.md', bytes: 1, sha256: 'a' }, { path: 'skills.csv', bytes: 1, sha256: 'b' }] as never })),
      checkLlm: vi.fn(async () => ({ provider: 'ollama', kind: 'local' as const, ok: true, models: ['qwen2.5:7b'], modelAvailable: true, message: undefined, quota: undefined })),
    });
    render(Estado, { props: { api, onsession: vi.fn(), onopen: vi.fn() } });
    await waitFor(() => expect(screen.getByText('2 ficheros en data/sources/')).toBeTruthy());
    const table = screen.getByRole('table', { name: 'Temas instalados' });
    expect(table.textContent).toContain('integrado');
    expect(table.textContent).toContain('instalado desde URL');
    expect(table.textContent).toContain('modificado');
    expect(screen.getByText('http://127.0.0.1:11434')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Comprobar' }));
    await waitFor(() => expect(api.checkLlm).toHaveBeenCalledWith({}));
    await waitFor(() => expect(screen.getByText(/Responde: 1 modelo/)).toBeTruthy());
  });

  it('con problemas de validación ofrece abrir el primero en Fuentes y volver a validar', async () => {
    const onopen = vi.fn();
    const api = fakeApi({
      validate: vi.fn(async () => {
        throw new ApiError(422, { code: 'invalid-data', message: '2 problemas', issues: [{ file: 'skills.csv', line: 7, message: 'sin id' }, { file: 'profile.md', line: undefined, message: 'falta fullName' }] });
      }),
    });
    render(Estado, { props: { api, onsession: vi.fn(), onopen } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Validar' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Validar' }));
    await waitFor(() => expect(screen.getByText('Ninguna fuente se ha modificado.')).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Abrir la primera en Fuentes' }));
    expect(onopen).toHaveBeenCalledWith('skills.csv', 7);
    await fireEvent.click(screen.getByRole('button', { name: 'Volver a validar' }));
    await waitFor(() => expect(api.validate).toHaveBeenCalledTimes(2));
  });
});
