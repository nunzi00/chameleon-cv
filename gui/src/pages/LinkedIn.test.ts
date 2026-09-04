import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import { ApiError, type ApiClient } from '../lib/api/client';
import type { LinkedinPlanResponse } from '../lib/api/types';
import LinkedIn from './LinkedIn.svelte';

const PLAN: LinkedinPlanResponse = {
  draft: 'perfil',
  counts: { add: 1, fix: 1, pending: 1 },
  items: [
    { action: 'add', kind: 'experience', title: 'Arquitecta · ACME · 2023-01 – actualidad', body: 'Lo que hice.\n• Un logro' },
    { action: 'fix', kind: 'headline', title: 'Cambiar el titular (LinkedIn dice «Developer»)', body: 'Arquitecta de software' },
    { action: 'pending', kind: 'certifications', title: 'No tienes ninguna certificación registrada', reason: 'LinkedIn tiene sección propia.' },
  ],
};

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    drafts: vi.fn(async () => ({ drafts: [{ name: 'perfil', counts: { experience: 6, education: 3, projects: 0, skills: 3, certifications: 0 }, entries: [], report: { issues: 0, unparsed: 0 }, files: 5 }], duplicates: { groups: [], compared: 0 } })),
    linkedinPlan: vi.fn(async () => PLAN), vidaLaboral: vi.fn(),
    status: vi.fn(), validate: vi.fn(), build: vi.fn(), profile: vi.fn(), sources: vi.fn(), source: vi.fn(), writeSource: vi.fn(), deleteSourcePlan: vi.fn(), deleteSource: vi.fn(), generate: vi.fn(), analyze: vi.fn(), saveAliases: vi.fn(), applyTags: vi.fn(), rankOffers: vi.fn(), importFolder: vi.fn(), cvFolders: vi.fn(), extractOffer: vi.fn(), setLlmKey: vi.fn(), removeLlmKey: vi.fn(), applyImportProposal: vi.fn(), draftFiles: vi.fn(), draftFile: vi.fn(), writeDraftFile: vi.fn(), adoptDraftEntries: vi.fn(), duplicates: vi.fn(), resolveDuplicate: vi.fn(), importLinkedIn: vi.fn(), importManfred: vi.fn(), importCv: vi.fn(), offers: vi.fn(), offerFetch: vi.fn(), offerSave: vi.fn(), themes: vi.fn(), createTheme: vi.fn(), installTheme: vi.fn(), verifyTheme: vi.fn(), outputs: vi.fn(), output: vi.fn(), exportProfile: vi.fn(), importProfile: vi.fn(), llmConfig: vi.fn(), writeLlmConfig: vi.fn(), checkLlm: vi.fn(), offerHistory: vi.fn(), shutdown: vi.fn(), llmRuntime: vi.fn(), llmModels: vi.fn(), llmRuntimeAction: vi.fn(), sourceHistory: vi.fn(), sourceVersion: vi.fn(), restoreSourceVersion: vi.fn(), writeServeConfig: vi.fn(), reviews: vi.fn(), review: vi.fn(), writeReview: vi.fn(), deleteReview: vi.fn(), archiveReview: vi.fn(), undoReview: vi.fn(), applyReview: vi.fn(), jobs: vi.fn(), job: vi.fn(), startJob: vi.fn(), cancelJob: vi.fn(), jobEvents: vi.fn(),
    ...overrides,
  };
}

describe('LinkedIn (T-9.27)', () => {
  it('explica cómo exportar e importar, y con un solo borrador lo deja puesto', async () => {
    const api = fakeApi();
    render(LinkedIn, { props: { api, onsession: vi.fn(), navigate: vi.fn() } });
    // Los pasos están antes del botón: sin el export no hay nada que comparar.
    expect(screen.getByText(/Obtener una copia de tus datos/)).toBeTruthy();
    expect(screen.getByText(/Guardar como PDF/)).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('perfil'));
  });

  it('genera el plan y lo enseña en tres bloques, con el cuerpo listo para copiar', async () => {
    const api = fakeApi();
    render(LinkedIn, { props: { api, onsession: vi.fn(), navigate: vi.fn() } });
    await waitFor(() => expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('perfil'));
    await fireEvent.click(screen.getByRole('button', { name: 'Generar mejoras para LinkedIn' }));
    await waitFor(() => expect(screen.getByText('Qué añadir')).toBeTruthy());
    expect(api.linkedinPlan).toHaveBeenCalledWith({ draft: 'perfil' });
    expect(screen.getByText('Qué corregir')).toBeTruthy();
    expect(screen.getByText('Qué falta por actualizar')).toBeTruthy();
    expect(screen.getByText(/Un logro/)).toBeTruthy();
    // Lo que no trae cuerpo no ofrece «Copiar»: no hay nada que llevarse.
    expect(screen.getAllByRole('button', { name: 'Copiar' })).toHaveLength(2);
  });

  it('sin borrador avisa de que solo puede decir qué tienes tú, y lo pide sin «draft»', async () => {
    const api = fakeApi({ drafts: vi.fn(async () => ({ drafts: [], duplicates: { groups: [], compared: 0 } })) as never });
    render(LinkedIn, { props: { api, onsession: vi.fn(), navigate: vi.fn() } });
    await waitFor(() => expect(screen.getByText(/solo puede decir/)).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Generar mejoras para LinkedIn' }));
    await waitFor(() => expect(api.linkedinPlan).toHaveBeenCalledWith({}));
  });

  it('un plan vacío se dice como lo que es, y un fallo se explica', async () => {
    const vacio = fakeApi({ linkedinPlan: vi.fn(async () => ({ counts: { add: 0, fix: 0, pending: 0 }, items: [] })) as never });
    const { unmount } = render(LinkedIn, { props: { api: vacio, onsession: vi.fn(), navigate: vi.fn() } });
    await fireEvent.click(screen.getByRole('button', { name: 'Generar mejoras para LinkedIn' }));
    await waitFor(() => expect(screen.getByText(/ya dice lo mismo que tus fuentes/)).toBeTruthy());
    unmount();

    const roto = fakeApi({ linkedinPlan: vi.fn(async () => { throw new ApiError(422, { code: 'invalid-data', message: 'Las fuentes no cargan' }); }) as never });
    render(LinkedIn, { props: { api: roto, onsession: vi.fn(), navigate: vi.fn() } });
    await fireEvent.click(screen.getByRole('button', { name: 'Generar mejoras para LinkedIn' }));
    await waitFor(() => expect(screen.getByText(/Las fuentes no cargan/)).toBeTruthy());
  });
});
