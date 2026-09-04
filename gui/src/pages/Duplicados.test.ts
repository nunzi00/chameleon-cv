/**
 * «Duplicados» (T-9.20): los grupos de las propias fuentes, la elección de cuál se queda —nada viene elegido—,
 * el plan antes de escribir y la resolución, que dice cómo deshacerla.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../lib/api/client';
import type { DuplicatesResolveResponse, DuplicatesResponse } from '../lib/api/types';
import Duplicados from './Duplicados.svelte';

const DATA: DuplicatesResponse = {
  root: '/work/data/sources',
  compared: 22,
  files: {
    'edu-ciclo': 'education/ciclo-superior-administrador-de-sistemas.md',
    'edu-piringalla': 'education/cs-administrador-ies-piringalla.md',
  },
  groups: [
    {
      section: 'education',
      inSources: true,
      members: [
        { entry: { section: 'education', id: 'edu-ciclo', title: 'Ciclo Superior Administrador de Sistemas · Centro pendiente', start: '2008', end: '2010', path: 'education/ciclo-superior-administrador-de-sistemas.md' } },
        { entry: { section: 'education', id: 'edu-piringalla', title: 'cs administrador de sistemas informaticos · ies piringalla', path: 'education/cs-administrador-ies-piringalla.md' } },
      ],
    },
  ],
};

const PLAN: DuplicatesResolveResponse = {
  root: '/work/data/sources',
  section: 'education',
  keep: { id: 'edu-ciclo', title: 'Ciclo Superior Administrador de Sistemas · I.E.S Piringalla', path: 'education/ciclo-superior-administrador-de-sistemas.md' },
  absorbed: [{ id: 'edu-piringalla', title: 'cs administrador · ies piringalla', path: 'education/cs-administrador-ies-piringalla.md' }],
  taken: [{ field: 'institution', from: 'cs administrador · ies piringalla', value: 'I.E.S Piringalla' }],
  conflicts: [{ field: 'degree', from: 'cs administrador · ies piringalla', kept: 'Ciclo Superior Administrador de Sistemas', discarded: 'cs administrador de sistemas informaticos' }],
  added: [],
  dryRun: true,
};

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    replaceSourcesWithDraft: vi.fn(),
    users: vi.fn(),
    createUser: vi.fn(),
    removeUser: vi.fn(),
    status: vi.fn(), validate: vi.fn(), build: vi.fn(), profile: vi.fn(), sources: vi.fn(), source: vi.fn(), writeSource: vi.fn(), deleteSourcePlan: vi.fn(), deleteSource: vi.fn(), generate: vi.fn(), analyze: vi.fn(), saveAliases: vi.fn(), applyTags: vi.fn(), rankOffers: vi.fn(), importFolder: vi.fn(), cvFolders: vi.fn(), linkedinPlan: vi.fn(), vidaLaboral: vi.fn(), extractOffer: vi.fn(), themes: vi.fn(), createTheme: vi.fn(), installTheme: vi.fn(), verifyTheme: vi.fn(), exportProfile: vi.fn(), importProfile: vi.fn(), llmConfig: vi.fn(), writeLlmConfig: vi.fn(), checkLlm: vi.fn(), offerHistory: vi.fn(), shutdown: vi.fn(), llmRuntime: vi.fn(), llmModels: vi.fn(), llmRuntimeAction: vi.fn(), sourceHistory: vi.fn(), sourceVersion: vi.fn(), restoreSourceVersion: vi.fn(), writeServeConfig: vi.fn(), reviews: vi.fn(), review: vi.fn(), writeReview: vi.fn(), deleteReview: vi.fn(), archiveReview: vi.fn(), undoReview: vi.fn(), applyReview: vi.fn(), jobs: vi.fn(), job: vi.fn(), cancelJob: vi.fn(), outputs: vi.fn(), output: vi.fn(), offers: vi.fn(), offerFetch: vi.fn(), offerSave: vi.fn(), setLlmKey: vi.fn(), removeLlmKey: vi.fn(), applyImportProposal: vi.fn(), importLinkedIn: vi.fn(), importManfred: vi.fn(), importCv: vi.fn(), startJob: vi.fn(), jobEvents: vi.fn(), drafts: vi.fn(), draftFiles: vi.fn(), draftFile: vi.fn(), writeDraftFile: vi.fn(), adoptDraftEntries: vi.fn(),
    duplicates: vi.fn(async () => DATA),
    resolveDuplicate: vi.fn(async (body: { readonly dryRun?: boolean | undefined }) => (body.dryRun === true ? PLAN : { ...PLAN, dryRun: false, historyId: '20260902T160000000Z-duplicados-edu-ciclo' })),
    ...overrides,
  };
}

describe('Duplicados', () => {
  it('sin nada repetido lo dice, y explica que un empleo partido en periodos no lo es', async () => {
    const api = fakeApi({ duplicates: vi.fn(async () => ({ root: '/work/data/sources', compared: 22, files: {}, groups: [] })) });
    render(Duplicados, { props: { api, onsession: vi.fn(), onopen: vi.fn() } });
    await waitFor(() => expect(screen.getByText('Nada se repite')).toBeTruthy());
    expect(screen.getByText(/partido en periodos/)).toBeTruthy();
  });

  it('enseña el grupo y NO elige por ti: sin marcar cuál se queda no hay botón que escriba', async () => {
    render(Duplicados, { props: { api: fakeApi(), onsession: vi.fn(), onopen: vi.fn() } });
    await waitFor(() => expect(screen.getByText(/Ciclo Superior Administrador de Sistemas · Centro pendiente/)).toBeTruthy());
    for (const radio of screen.getAllByRole('radio') as HTMLInputElement[]) {
      expect(radio.checked).toBe(false);
    }
    expect(screen.queryByRole('button', { name: /Ver qué pasaría/ })).toBeNull();
    expect(screen.getByText('Marca cuál se queda.')).toBeTruthy();
  });

  it('el fichero de cada entrada lleva a «Fuentes»', async () => {
    const onopen = vi.fn();
    render(Duplicados, { props: { api: fakeApi(), onsession: vi.fn(), onopen } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'education/cs-administrador-ies-piringalla.md' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'education/cs-administrador-ies-piringalla.md' }));
    expect(onopen).toHaveBeenCalledWith('education/cs-administrador-ies-piringalla.md');
  });

  it('primero el plan —lo que toma y lo que descarta— y solo después el botón que escribe', async () => {
    const api = fakeApi();
    render(Duplicados, { props: { api, onsession: vi.fn(), onopen: vi.fn() } });
    await waitFor(() => expect(screen.getAllByRole('radio').length).toBe(2));
    await fireEvent.click(screen.getAllByRole('radio')[0] as HTMLInputElement);
    await fireEvent.click(await screen.findByRole('button', { name: 'Ver qué pasaría' }));

    await waitFor(() => expect(screen.getByText('Lo que pasaría')).toBeTruthy());
    expect(api.resolveDuplicate).toHaveBeenCalledWith({ keep: 'edu-ciclo', absorb: ['edu-piringalla'], dryRun: true });
    expect(screen.getByText(/Toma/)).toBeTruthy();
    expect(screen.getByText('I.E.S Piringalla')).toBeTruthy();
    // La discrepancia se enseña antes de escribir: se conserva una y se descarta la otra.
    expect(screen.getByText(/Conserva/)).toBeTruthy();
    expect(screen.getByText('cs administrador de sistemas informaticos')).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: /^Resolver: quedarme con esta/ }));
    await waitFor(() => expect(api.resolveDuplicate).toHaveBeenCalledWith({ keep: 'edu-ciclo', absorb: ['edu-piringalla'] }));
    expect(screen.getByText(/cv history restore/)).toBeTruthy();
  });

  it('una entrada del grupo se puede dejar fuera de la absorción', async () => {
    const api = fakeApi();
    render(Duplicados, { props: { api, onsession: vi.fn(), onopen: vi.fn() } });
    await waitFor(() => expect(screen.getAllByRole('radio').length).toBe(2));
    await fireEvent.click(screen.getAllByRole('radio')[0] as HTMLInputElement);
    await fireEvent.click(await screen.findByRole('checkbox'));
    expect(screen.getByText('No queda ninguna entrada que absorber.')).toBeTruthy();
    expect(api.resolveDuplicate).not.toHaveBeenCalled();
  });
});
