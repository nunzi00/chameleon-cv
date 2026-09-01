import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, type ApiClient } from '../lib/api/client';
import type { ImportResponse, StatusResponse } from '../lib/api/types';
import Estado from './Estado.svelte';

const STATUS: StatusResponse = {
  version: '1.4.0',
  workspace: '/work',
  artifact: { status: 'fresh', detail: undefined, specialties: [] },
  typst: { required: '0.15.1', candidates: [], selected: undefined, usable: true },
  llm: { config: undefined, configError: undefined, health: undefined, keys: {} as StatusResponse['llm']['keys'], keysFile: '', allowedHosts: [], remote: undefined, usable: false, settings: { path: undefined, present: false, configured: false, error: undefined }, providers: [] },
  themes: { defaultName: 'default', configWarning: undefined, roots: [], entries: [] },
};

const PLAN: ImportResponse = {
  root: '/work/data/sources',
  dryRun: true,
  plan: { files: [{ path: 'profile.md', bytes: 39 }], counts: { specialties: 0, experience: 0, projects: 0, education: 0, achievements: 0, skills: 0, certifications: 0 }, warnings: [] },
  written: [],
};

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    status: vi.fn(async () => STATUS),
    validate: vi.fn(), build: vi.fn(), profile: vi.fn(), sources: vi.fn(), source: vi.fn(), writeSource: vi.fn(), generate: vi.fn(), analyze: vi.fn(), saveAliases: vi.fn(), applyTags: vi.fn(), rankOffers: vi.fn(), importFolder: vi.fn(), extractOffer: vi.fn(), setLlmKey: vi.fn(), removeLlmKey: vi.fn(), applyImportProposal: vi.fn(), importLinkedIn: vi.fn(), importCv: vi.fn(), offers: vi.fn(), offerFetch: vi.fn(), offerSave: vi.fn(), themes: vi.fn(), createTheme: vi.fn(), installTheme: vi.fn(), verifyTheme: vi.fn(), outputs: vi.fn(), output: vi.fn(), reviews: vi.fn(), review: vi.fn(), writeReview: vi.fn(), deleteReview: vi.fn(), applyReview: vi.fn(), jobs: vi.fn(), job: vi.fn(), startJob: vi.fn(), cancelJob: vi.fn(), jobEvents: vi.fn(), offerHistory: vi.fn(), shutdown: vi.fn(), llmRuntime: vi.fn(), llmModels: vi.fn(), llmRuntimeAction: vi.fn(), sourceHistory: vi.fn(), sourceVersion: vi.fn(), restoreSourceVersion: vi.fn(), writeServeConfig: vi.fn(),
    llmConfig: vi.fn(), writeLlmConfig: vi.fn(), checkLlm: vi.fn(),
    exportProfile: vi.fn(async () => ({ meta: { schemaVersion: 1 as const }, personal: { fullName: 'Ada', links: [] }, specialties: [], experience: [], projects: [], education: [], skills: [], achievements: [], certifications: [], languages: [] })),
    importProfile: vi.fn(async (body: { dryRun?: boolean | undefined }) => (body.dryRun === false ? { ...PLAN, dryRun: false, written: ['profile.md'], backup: '/work/data/sources.20260830-120000.bak' } : PLAN)),
    ...overrides,
  };
}

function chooseFile(name: string, content: string): Promise<boolean> {
  const input = screen.getByLabelText('Fichero del perfil (JSON)') as HTMLInputElement;
  const file = new File([content], name, { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  return fireEvent.change(input);
}

describe('Estado · Portabilidad', () => {
  const clicks: string[] = [];
  beforeEach(() => {
    clicks.length = 0;
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:perfil'), revokeObjectURL: vi.fn() }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(`${this.download}←${this.href}`);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('exporta el perfil como descarga con el nombre del día', async () => {
    const api = fakeApi();
    render(Estado, { props: { api, onsession: vi.fn(), onopen: vi.fn() } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Exportar perfil (JSON)' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Exportar perfil (JSON)' }));
    await waitFor(() => expect(screen.getByText(/^Perfil exportado como perfil-\d{4}-\d{2}-\d{2}\.json$/)).toBeTruthy());
    expect(api.exportProfile).toHaveBeenCalledOnce();
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatch(/^perfil-\d{4}-\d{2}-\d{2}\.json←blob:perfil$/);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:perfil');
  });

  it('importa: elige el fichero, ve el plan (con y sin sustituir), escribe tras confirmar y muestra la copia', async () => {
    const api = fakeApi();
    render(Estado, { props: { api, onsession: vi.fn(), onopen: vi.fn() } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Importar perfil…' })).toBeTruthy());
    await chooseFile('perfil.json', '{"personal":{"fullName":"Ada"}}');
    await waitFor(() => expect(screen.getByText('perfil.json')).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Ver plan' }));
    await waitFor(() => expect(screen.getByText('profile.md (39 bytes)')).toBeTruthy());
    expect(api.importProfile).toHaveBeenLastCalledWith({ profile: { personal: { fullName: 'Ada' } }, replace: false, dryRun: true });
    expect(screen.getByText('Auto-chequeo superado: las fuentes regeneradas reproducen el perfil.')).toBeTruthy();
    await fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.queryByText('profile.md (39 bytes)')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Ver plan' }));
    await waitFor(() => expect(screen.getByText('profile.md (39 bytes)')).toBeTruthy());
    expect(api.importProfile).toHaveBeenLastCalledWith({ profile: { personal: { fullName: 'Ada' } }, replace: true, dryRun: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Escribir en las fuentes' }));
    await waitFor(() => expect(screen.getByText('Perfil importado en /work/data/sources: 1 fichero · las fuentes anteriores quedan en /work/data/sources.20260830-120000.bak · compila para regenerar el artefacto')).toBeTruthy());
    expect(api.importProfile).toHaveBeenLastCalledWith({ profile: { personal: { fullName: 'Ada' } }, replace: true, dryRun: false });
    expect(screen.queryByText('perfil.json')).toBeNull();
  });

  it('muestra el 409 dentro del diálogo, el fichero que no es un perfil, cancela, y un 401 avisa de la sesión', async () => {
    const onsession = vi.fn();
    const api = fakeApi({
      importProfile: vi.fn(async (body: { replace?: boolean | undefined }) => {
        if (body.replace === true) {
          throw new ApiError(401, { code: 'unauthorized', message: 'caducó' });
        }
        throw new ApiError(409, { code: 'conflict', message: 'El directorio de fuentes «/work/data/sources» no está vacío (profile.md): use --replace' });
      }),
    });
    render(Estado, { props: { api, onsession, onopen: vi.fn() } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Importar perfil…' })).toBeTruthy());
    await chooseFile('roto.json', '[1, 2]');
    await waitFor(() => expect(screen.getByText('El fichero no es un perfil')).toBeTruthy());
    expect(screen.queryByText('roto.json')).toBeNull();
    await chooseFile('perfil.json', '{"personal":{"fullName":"Ada"}}');
    await waitFor(() => expect(screen.getByText('perfil.json')).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Ver plan' }));
    await waitFor(() => expect(screen.getByText(/no está vacío/)).toBeTruthy());
    await fireEvent.click(screen.getByRole('checkbox'));
    await fireEvent.click(screen.getByRole('button', { name: 'Ver plan' }));
    await waitFor(() => expect(onsession).toHaveBeenCalled());
    await fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByText('perfil.json')).toBeNull());
    const input = screen.getByLabelText('Fichero del perfil (JSON)') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [], configurable: true });
    await fireEvent.change(input);
    expect(screen.queryByText('Importar perfil')).toBeNull();
  });
});
