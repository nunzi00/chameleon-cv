import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../lib/api/client';
import Salidas from './Salidas.svelte';

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:vista');
  URL.revokeObjectURL = vi.fn();
});

function fakeApi(): ApiClient {
  return {
    status: vi.fn(), validate: vi.fn(), build: vi.fn(), profile: vi.fn(), sources: vi.fn(), source: vi.fn(), writeSource: vi.fn(), generate: vi.fn(), analyze: vi.fn(), extractOffer: vi.fn(), themes: vi.fn(), createTheme: vi.fn(), installTheme: vi.fn(), verifyTheme: vi.fn(), exportProfile: vi.fn(), importProfile: vi.fn(), llmConfig: vi.fn(), writeLlmConfig: vi.fn(), checkLlm: vi.fn(), offerHistory: vi.fn(), shutdown: vi.fn(), reviews: vi.fn(), review: vi.fn(), writeReview: vi.fn(), deleteReview: vi.fn(), applyReview: vi.fn(), jobs: vi.fn(), job: vi.fn(), startJob: vi.fn(), cancelJob: vi.fn(), jobEvents: vi.fn(),
    outputs: vi.fn(async () => ({ files: [{ name: 'revision-improve.md', bytes: 300 }, { name: 'cv-ada.pdf', bytes: 2048 }, { name: 'cv-ada.md', bytes: 100 }] })),
    output: vi.fn(async (name: string) => (name.endsWith('.pdf') ? { name, contentType: 'application/pdf', blob: new Blob(['%PDF'], { type: 'application/pdf' }) } : { name, contentType: 'text/markdown; charset=utf-8', blob: new Blob(['# CV de Ada'], { type: 'text/markdown' }) })),
  };
}

describe('Salidas', () => {
  it('lista los ficheros ordenados por tipo, muestra el Markdown como texto y el PDF en el visor', async () => {
    const api = fakeApi();
    const navigate = vi.fn();
    const { rerender } = render(Salidas, { props: { api, item: undefined, onsession: vi.fn(), navigate } });
    await waitFor(() => expect(screen.getByText('3 ficheros en')).toBeTruthy());
    const buttons = screen.getAllByRole('button').map((button) => button.textContent?.replace(/\s+/g, ' ').trim());
    expect(buttons.slice(0, 3)).toEqual(['PDF cv-ada.pdf (2.0 KB)', 'Markdown cv-ada.md (100 B)', 'Revisión revision-improve.md (300 B)']);
    await fireEvent.click(screen.getByRole('button', { name: /cv-ada\.md/ }));
    expect(navigate).toHaveBeenCalledWith({ page: 'salidas', item: 'cv-ada.md' });
    await rerender({ api, item: 'cv-ada.md', onsession: vi.fn(), navigate });
    await waitFor(() => expect(screen.getByText('# CV de Ada')).toBeTruthy());
    expect((screen.getByRole('link', { name: 'Descargar' }) as HTMLAnchorElement).getAttribute('download')).toBe('cv-ada.md');
    await rerender({ api, item: 'cv-ada.pdf', onsession: vi.fn(), navigate });
    await waitFor(() => expect(screen.getByTitle('Vista previa de cv-ada.pdf')).toBeTruthy());
    expect((screen.getByTitle('Vista previa de cv-ada.pdf') as HTMLIFrameElement).getAttribute('src')).toBe('blob:vista');
    expect(screen.getByRole('link', { name: 'Descargar cv-ada.pdf' })).toBeTruthy();
  });

  it('sin salidas lo dice; un fallo al listar se muestra', async () => {
    const api = fakeApi();
    (api.outputs as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ files: [] }).mockRejectedValueOnce(new Error('disco'));
    render(Salidas, { props: { api, item: undefined, onsession: vi.fn(), navigate: vi.fn() } });
    await waitFor(() => expect(screen.getByText(/Todavía no hay nada/)).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    await waitFor(() => expect(screen.getByText('Error inesperado')).toBeTruthy());
  });
});
