import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import { ApiError, type ApiClient } from '../lib/api/client';
import type { ReviewResponse } from '../lib/api/types';
import Revisiones from './Revisiones.svelte';

const TEXT = '# Revisión\n\n## ach-1 · Dev · ACME\n\nOriginal: Reduje la latencia.\nFuente: experience/acme.md:15 · sha256 abc\n\n- [ ] Propuesta 1: Reduje la latencia un 40 %.\n- [ ] Propuesta 2: Bajé la latencia.\n';
const PARSED: ReviewResponse['review'] = {
  name: 'revision-improve-2026-08-30.md',
  path: '/work/output/revision-improve-2026-08-30.md',
  sha256: 'sha-1',
  task: 'improve',
  items: 1,
  marked: 0,
  error: undefined,
  text: TEXT,
  review: { task: 'improve', specialty: 'backend', dataDir: 'data/sources', items: [{ id: 'ach-1', location: 'Dev · ACME', original: 'Reduje la latencia.', source: { file: 'experience/acme.md', line: 15, hash: 'abc' }, proposals: [{ number: 1, text: 'Reduje la latencia un 40 %.', accepted: true, checked: false }, { number: 2, text: 'Bajé la latencia.', accepted: false, checked: false }] }] },
};

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    reviews: vi.fn(async () => ({ reviews: [{ name: PARSED.name, path: PARSED.path, sha256: 'sha-1', task: 'improve' as const, items: 1, marked: 0, error: undefined }, { name: 'revision-rota.md', path: '/work/output/revision-rota.md', sha256: 'x', task: undefined, items: 0, marked: 0, error: 'sin cabecera' }] })),
    review: vi.fn(async (name: string) => ({ review: name === 'revision-rota.md' ? { ...PARSED, name, text: 'sin cabecera', review: undefined, error: 'sin cabecera' } : PARSED })),
    writeReview: vi.fn(async (name: string) => ({ name, sha256: 'sha-2' })),
    applyReview: vi.fn(async (_name: string, body: { dryRun?: boolean }) => (body.dryRun === false ? { reviewPath: '/work/output/r.md', plan: [], written: [{ path: '/work/data/sources/experience/acme.md', backup: '/work/data/sources/experience/acme.md.bak', ids: ['ach-1'] }], deleted: false, changes: 1 } : { reviewPath: '/work/output/r.md', plan: [{ path: '/work/data/sources/experience/acme.md', edits: [{ id: 'ach-1', text: 'Reduje la latencia un 40 %.' }] }], written: [], deleted: false, changes: 0 })),
    deleteReview: vi.fn(async (name: string) => ({ deleted: name })),
    status: vi.fn(), validate: vi.fn(), build: vi.fn(), profile: vi.fn(), sources: vi.fn(), source: vi.fn(), writeSource: vi.fn(), generate: vi.fn(), analyze: vi.fn(), extractOffer: vi.fn(), themes: vi.fn(), createTheme: vi.fn(), installTheme: vi.fn(), verifyTheme: vi.fn(), outputs: vi.fn(), output: vi.fn(), jobs: vi.fn(), job: vi.fn(), startJob: vi.fn(), cancelJob: vi.fn(), jobEvents: vi.fn(), exportProfile: vi.fn(), importProfile: vi.fn(), llmConfig: vi.fn(), writeLlmConfig: vi.fn(), checkLlm: vi.fn(), shutdown: vi.fn(),
    ...overrides,
  };
}

describe('Revisiones', () => {
  it('lista, abre antes/después con veredictos, guarda una marca con If-Match, muestra el plan y escribe con confirmación', async () => {
    const api = fakeApi();
    render(Revisiones, { props: { api, item: PARSED.name, onsession: vi.fn(), navigate: vi.fn() } });
    await waitFor(() => expect(screen.getByText('Reduje la latencia.')).toBeTruthy());
    expect(screen.getByText(/revision-rota\.md/)).toBeTruthy();
    expect(screen.getByText('rechazada (C2)')).toBeTruthy();
    expect(screen.getByText('Fuente: experience/acme.md:15')).toBeTruthy();
    const plan = screen.getByRole('button', { name: 'Plan de aplicación' }) as HTMLButtonElement;
    expect(plan.disabled).toBe(false);
    await fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByText('marcas sin guardar')).toBeTruthy();
    expect(plan.disabled).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Guardar marcas' }));
    await waitFor(() => expect(screen.getByText('Marcas guardadas (1 propuesta marcada).')).toBeTruthy());
    expect(api.writeReview).toHaveBeenCalledWith(PARSED.name, TEXT.replace('- [ ] Propuesta 1:', '- [x] Propuesta 1:'), 'sha-1');
    await fireEvent.click(screen.getByRole('button', { name: 'Plan de aplicación' }));
    await waitFor(() => expect(screen.getByText(/ach-1 → Reduje la latencia un 40 %\./)).toBeTruthy());
    expect(api.applyReview).toHaveBeenCalledWith(PARSED.name, {});
    await fireEvent.click(screen.getByRole('button', { name: 'Escribir en las fuentes' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Escribir' }));
    await waitFor(() => expect(screen.getByText('1 cambio aplicado en 1 fichero: recompila el artefacto en Estado.')).toBeTruthy());
    expect(api.applyReview).toHaveBeenLastCalledWith(PARSED.name, { dryRun: false });
    expect(screen.getByText(/acme\.md\.bak/)).toBeTruthy();
  });

  it('un 422 al aplicar muestra las líneas; eliminar pide confirmación y vuelve a la lista; una revisión rota se muestra en crudo; un 401 avisa', async () => {
    const navigate = vi.fn();
    const onsession = vi.fn();
    const api = fakeApi({ applyReview: vi.fn(async () => { throw new ApiError(422, { code: 'invalid-data', message: 'No se ha modificado ningún fichero', lines: ['«ach-1»: el original cambió'], written: [] }); }) });
    const { rerender } = render(Revisiones, { props: { api, item: PARSED.name, onsession, navigate } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Plan de aplicación' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Plan de aplicación' }));
    await waitFor(() => expect(screen.getByText('«ach-1»: el original cambió')).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(api.deleteReview).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    await fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar' }).at(-1) as HTMLElement);
    await waitFor(() => expect(api.deleteReview).toHaveBeenCalledWith(PARSED.name));
    expect(navigate).toHaveBeenCalledWith({ page: 'revisiones' });
    await rerender({ api, item: 'revision-rota.md', onsession, navigate });
    await waitFor(() => expect(screen.getByText('Revisión no interpretable')).toBeTruthy());
    (api.review as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new ApiError(401, { code: 'unauthorized', message: 'caducó' }));
    await rerender({ api, item: PARSED.name, onsession, navigate });
    await waitFor(() => expect(onsession).toHaveBeenCalled());
  });
});
