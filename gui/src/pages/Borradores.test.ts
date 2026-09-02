/**
 * «Borradores» (T-9.19): la lista con lo que reconoció cada uno, la selección de entradas que se adoptan en
 * `data/sources/`, los grupos de duplicados —que se enseñan sin decidir nada, con lo que ya tienes marcado como
 * no seleccionable— y la corrección de un fichero del borrador con su huella.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../lib/api/client';
import type { DraftsResponse } from '../lib/api/types';
import Borradores from './Borradores.svelte';

const DRAFTS: DraftsResponse = {
  drafts: [
    {
      name: 'cv-lucas',
      counts: { experience: 2, education: 1, projects: 0, skills: 0, certifications: 0 },
      entries: [
        { section: 'experience', id: 'exp-acme', title: 'Backend Senior · Acme', start: '2020-01', end: '2021-01', path: 'experience/acme.md' },
        { section: 'experience', id: 'exp-life5', title: 'Software Developer · Life5', start: '2022-04', path: 'experience/life5.md' },
        { section: 'education', id: 'edu-ies', title: 'Ciclo Superior · I.E.S. Muralla Romana', start: '2008', end: '2010', path: 'education/ies.md' },
      ],
      report: { origin: 'CV Lucas.pdf', importedAt: '2026-09-02T12:08:17.894Z', issues: 15, unparsed: 4 },
      files: 5,
    },
    {
      name: 'roto',
      counts: { experience: 0, education: 0, projects: 0, skills: 0, certifications: 0 },
      entries: [],
      report: { issues: 0, unparsed: 0 },
      files: 0,
      problem: '1 problema en /work/import/roto',
    },
  ],
  duplicates: {
    compared: 4,
    groups: [
      {
        section: 'experience',
        inSources: true,
        members: [
          { entry: { section: 'experience', id: 'exp-life5-2022', title: 'Backend Developer · Life5', start: '2022-05', end: '2022-12', path: 'experience/life5.md' } },
          { draft: 'cv-lucas', entry: { section: 'experience', id: 'exp-life5', title: 'Software Developer · Life5', start: '2022-04', path: 'experience/life5.md' } },
        ],
      },
    ],
  },
};

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    status: vi.fn(), validate: vi.fn(), build: vi.fn(), profile: vi.fn(), sources: vi.fn(), source: vi.fn(), writeSource: vi.fn(), generate: vi.fn(), analyze: vi.fn(), saveAliases: vi.fn(), applyTags: vi.fn(), rankOffers: vi.fn(), importFolder: vi.fn(), extractOffer: vi.fn(), themes: vi.fn(), createTheme: vi.fn(), installTheme: vi.fn(), verifyTheme: vi.fn(), exportProfile: vi.fn(), importProfile: vi.fn(), llmConfig: vi.fn(), writeLlmConfig: vi.fn(), checkLlm: vi.fn(), offerHistory: vi.fn(), shutdown: vi.fn(), llmRuntime: vi.fn(), llmModels: vi.fn(), llmRuntimeAction: vi.fn(), sourceHistory: vi.fn(), sourceVersion: vi.fn(), restoreSourceVersion: vi.fn(), writeServeConfig: vi.fn(), reviews: vi.fn(), review: vi.fn(), writeReview: vi.fn(), deleteReview: vi.fn(), applyReview: vi.fn(), jobs: vi.fn(), job: vi.fn(), cancelJob: vi.fn(), outputs: vi.fn(), output: vi.fn(), offers: vi.fn(), offerFetch: vi.fn(), offerSave: vi.fn(), setLlmKey: vi.fn(), removeLlmKey: vi.fn(), applyImportProposal: vi.fn(), importLinkedIn: vi.fn(), importCv: vi.fn(), startJob: vi.fn(), jobEvents: vi.fn(), duplicates: vi.fn(), resolveDuplicate: vi.fn(),
    drafts: vi.fn(async () => DRAFTS),
    draftFiles: vi.fn(async () => ({ name: 'cv-lucas', entries: [{ path: 'README.md', bytes: 900, mtimeMs: 0, sha256: 'a'.repeat(64) }, { path: 'experience/acme.md', bytes: 120, mtimeMs: 0, sha256: 'b'.repeat(64) }] })),
    draftFile: vi.fn(async () => ({ path: 'experience/acme.md', content: '---\ncompany: Acme\n---\n', sha256: 'b'.repeat(64) })),
    writeDraftFile: vi.fn(async () => ({ path: 'experience/acme.md', sha256: 'c'.repeat(64) })),
    adoptDraftEntries: vi.fn(async () => ({ root: '/work/data/sources', adopted: [{ draft: 'cv-lucas', section: 'experience' as const, id: 'exp-acme', title: 'Backend Senior · Acme', path: 'experience/acme.md' }], skipped: [], dryRun: false })),
    ...overrides,
  };
}

describe('Borradores', () => {
  it('lista los borradores con su origen y sus cuentas, y señala el que no carga', async () => {
    render(Borradores, { props: { api: fakeApi(), item: undefined, onsession: vi.fn(), navigate: vi.fn(), plainEditor: true } });
    await waitFor(() => expect(screen.getByText('cv-lucas')).toBeTruthy());
    expect(screen.getByText('CV Lucas.pdf')).toBeTruthy();
    expect(screen.getByText('no carga')).toBeTruthy();
  });

  it('sin borradores invita a importar en lugar de dejar la pantalla vacía', async () => {
    const api = fakeApi({ drafts: vi.fn(async () => ({ drafts: [], duplicates: { groups: [], compared: 0 } })) });
    const navigate = vi.fn();
    render(Borradores, { props: { api, item: undefined, onsession: vi.fn(), navigate, plainEditor: true } });
    await waitFor(() => expect(screen.getByText('Todavía no hay borradores')).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Ir a «Importar CV»' }));
    expect(navigate).toHaveBeenCalledWith({ page: 'importar' });
  });

  it('con un borrador abierto, marcar entradas y pulsar adopta exactamente lo marcado', async () => {
    const api = fakeApi();
    render(Borradores, { props: { api, item: 'cv-lucas', onsession: vi.fn(), navigate: vi.fn(), plainEditor: true } });
    await waitFor(() => expect(screen.getByText('Backend Senior · Acme')).toBeTruthy());
    // Nada viene marcado: el botón de adoptar ni siquiera está.
    expect(screen.queryByRole('button', { name: /Adoptar/ })).toBeNull();
    await fireEvent.click(screen.getAllByRole('checkbox')[0] as HTMLInputElement);
    const adopt = await screen.findByRole('button', { name: 'Adoptar 1 en mis fuentes' });
    await fireEvent.click(adopt);
    await waitFor(() => expect(api.adoptDraftEntries).toHaveBeenCalledWith({ entries: [{ draft: 'cv-lucas', section: 'experience', id: 'exp-acme' }] }));
    expect(screen.getByText(/1 entrada adoptada en tus fuentes/)).toBeTruthy();
  });

  it('«Todas» marca la sección entera y adopta sus tres entradas de una vez', async () => {
    const api = fakeApi();
    render(Borradores, { props: { api, item: 'cv-lucas', onsession: vi.fn(), navigate: vi.fn(), plainEditor: true } });
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Todas' }).length).toBe(2));
    for (const button of screen.getAllByRole('button', { name: 'Todas' })) {
      await fireEvent.click(button);
    }
    await fireEvent.click(await screen.findByRole('button', { name: 'Adoptar 3 en mis fuentes' }));
    await waitFor(() => expect((api.adoptDraftEntries as unknown as { mock: { calls: Array<[{ entries: readonly unknown[] }]> } }).mock.calls[0]?.[0].entries).toHaveLength(3));
  });

  it('los duplicados se enseñan sin decidir: lo que ya está en tus fuentes no se puede marcar', async () => {
    render(Borradores, { props: { api: fakeApi(), item: undefined, onsession: vi.fn(), navigate: vi.fn(), plainEditor: true } });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Duplicados (1)' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('tab', { name: 'Duplicados (1)' }));
    expect(screen.getByText('Ya tienes una en tus fuentes')).toBeTruthy();
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    // El miembro que viene de las fuentes no es adoptable: adoptarlo sería duplicarlo de verdad.
    expect(boxes[0]?.disabled).toBe(true);
    expect(boxes[1]?.disabled).toBe(false);
  });

  it('un fichero del borrador se abre y se guarda con su huella, sin tocar las fuentes', async () => {
    const api = fakeApi();
    render(Borradores, { props: { api, item: 'cv-lucas', onsession: vi.fn(), navigate: vi.fn(), plainEditor: true } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'experience/acme.md' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'experience/acme.md' }));
    await waitFor(() => expect(screen.getByText('import/cv-lucas/experience/acme.md')).toBeTruthy());
    const save = screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: '---\ncompany: Acme S.L.\n---\n' } });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement).disabled).toBe(false));
    await fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.writeDraftFile).toHaveBeenCalledWith('cv-lucas', 'experience/acme.md', '---\ncompany: Acme S.L.\n---\n', 'b'.repeat(64)));
    expect(screen.getByText(/no toca tus fuentes/)).toBeTruthy();
    expect(api.writeSource).not.toHaveBeenCalled();
  });
});
