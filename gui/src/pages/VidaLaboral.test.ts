import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import { ApiError, type ApiClient } from '../lib/api/client';
import type { VidaLaboralResponse } from '../lib/api/types';
import VidaLaboral from './VidaLaboral.svelte';

const REPORT: VidaLaboralResponse = {
  spells: 28,
  employers: 19,
  items: [
    { kind: 'still-open', company: 'Life5', title: 'Life5 sigue abierta en tus fuentes y el informe registra la baja el 2026-08-31', detail: 'Ponle fecha de fin.', matchedBy: 'period', sources: ['exp-life5-2026'] },
    { kind: 'start', company: 'Picas Rojas', title: 'Picas Rojas empieza en 2013-01 y el informe dice 2015-01-08', matchedBy: 'name', sources: ['exp-picas'] },
    { kind: 'missing-in-profile', company: 'BAHIA SOFTWARE, S.L.U.', title: 'El informe registra 172 días en «BAHIA SOFTWARE, S.L.U.» y tus fuentes no lo tienen' },
  ],
};

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    vidaLaboral: vi.fn(async () => REPORT),
    users: vi.fn(),
    createUser: vi.fn(),
    removeUser: vi.fn(),
    status: vi.fn(), validate: vi.fn(), build: vi.fn(), profile: vi.fn(), sources: vi.fn(), source: vi.fn(), writeSource: vi.fn(), deleteSourcePlan: vi.fn(), deleteSource: vi.fn(), generate: vi.fn(), analyze: vi.fn(), saveAliases: vi.fn(), applyTags: vi.fn(), rankOffers: vi.fn(), importFolder: vi.fn(), cvFolders: vi.fn(), linkedinPlan: vi.fn(), extractOffer: vi.fn(), setLlmKey: vi.fn(), removeLlmKey: vi.fn(), applyImportProposal: vi.fn(), drafts: vi.fn(), draftFiles: vi.fn(), draftFile: vi.fn(), writeDraftFile: vi.fn(), adoptDraftEntries: vi.fn(), duplicates: vi.fn(), resolveDuplicate: vi.fn(), importLinkedIn: vi.fn(), importManfred: vi.fn(), importCv: vi.fn(), offers: vi.fn(), offerFetch: vi.fn(), offerSave: vi.fn(), themes: vi.fn(), createTheme: vi.fn(), installTheme: vi.fn(), verifyTheme: vi.fn(), outputs: vi.fn(), output: vi.fn(), exportProfile: vi.fn(), importProfile: vi.fn(), llmConfig: vi.fn(), writeLlmConfig: vi.fn(), checkLlm: vi.fn(), offerHistory: vi.fn(), shutdown: vi.fn(), llmRuntime: vi.fn(), llmModels: vi.fn(), llmRuntimeAction: vi.fn(), sourceHistory: vi.fn(), sourceVersion: vi.fn(), restoreSourceVersion: vi.fn(), writeServeConfig: vi.fn(), reviews: vi.fn(), review: vi.fn(), writeReview: vi.fn(), deleteReview: vi.fn(), archiveReview: vi.fn(), undoReview: vi.fn(), applyReview: vi.fn(), jobs: vi.fn(), job: vi.fn(), startJob: vi.fn(), cancelJob: vi.fn(), jobEvents: vi.fn(),
    ...overrides,
  };
}

/** Sube un PDF por el input de fichero, como haría el usuario. */
async function upload(api: ApiClient): Promise<void> {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['%PDF'], 'vida_laboral.pdf', { type: 'application/pdf' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await fireEvent.change(input);
  await waitFor(() => expect(api.vidaLaboral).toHaveBeenCalled());
}

describe('Vida laboral (T-9.28)', () => {
  it('explica de dónde sale el informe y que el PDF no se guarda', () => {
    render(VidaLaboral, { props: { api: fakeApi(), onsession: vi.fn(), navigate: vi.fn() } });
    expect(screen.getByText(/Sede Electrónica de la Seguridad Social/)).toBeTruthy();
    expect(screen.getByText(/no se guarda/)).toBeTruthy();
    // Lo que NO se lee del informe se dice explícitamente: es un documento con DNI y domicilio dentro.
    expect(screen.getByText(/el DNI, el número de la/)).toBeTruthy();
  });

  it('compara el PDF y agrupa los apuntes, avisando de lo emparejado por periodo', async () => {
    const api = fakeApi();
    render(VidaLaboral, { props: { api, onsession: vi.fn(), navigate: vi.fn() } });
    await upload(api);
    await waitFor(() => expect(screen.getByText('Empleos que das por abiertos')).toBeTruthy());
    expect(screen.getByText('Fechas de inicio que no cuadran')).toBeTruthy();
    expect(screen.getByText('En el informe y no en tus fuentes')).toBeTruthy();
    expect(screen.getByText('por el periodo')).toBeTruthy();
    expect(screen.getByText(/28 altas de empleo leídas/)).toBeTruthy();
    expect(screen.getByText(/No se ha.*cambiado nada/s)).toBeTruthy();
  });

  it('desde un desfase de fechas se va a corregirlo a Fuentes', async () => {
    const navigate = vi.fn();
    const api = fakeApi();
    render(VidaLaboral, { props: { api, onsession: vi.fn(), navigate } });
    await upload(api);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Corregir en Fuentes' }).length).toBeGreaterThan(0));
    await fireEvent.click(screen.getAllByRole('button', { name: 'Corregir en Fuentes' })[0] as HTMLElement);
    expect(navigate).toHaveBeenCalledWith({ page: 'fuentes' });
  });

  it('unas fechas que cuadran se dicen, y un PDF que no es un informe se explica', async () => {
    const limpio = fakeApi({ vidaLaboral: vi.fn(async () => ({ spells: 3, employers: 3, items: [] })) as never });
    const { unmount } = render(VidaLaboral, { props: { api: limpio, onsession: vi.fn(), navigate: vi.fn() } });
    await upload(limpio);
    await waitFor(() => expect(screen.getByText('Tus fechas cuadran con el informe.')).toBeTruthy());
    unmount();

    const roto = fakeApi({ vidaLaboral: vi.fn(async () => { throw new ApiError(422, { code: 'invalid-data', message: 'no parece un informe de vida laboral' }); }) as never });
    render(VidaLaboral, { props: { api: roto, onsession: vi.fn(), navigate: vi.fn() } });
    await upload(roto);
    await waitFor(() => expect(screen.getByText(/no parece un informe/)).toBeTruthy());
  });
});
