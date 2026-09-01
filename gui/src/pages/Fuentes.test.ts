import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import { ApiError, type ApiClient } from '../lib/api/client';
import type { SourceHistoryEntry, SourceHistoryFile } from '../lib/api/types';
import Fuentes from './Fuentes.svelte';

const ENTRIES = [
  { path: 'profile.md', bytes: 10, mtimeMs: 0, sha256: 'p' },
  { path: 'experience/acme.md', bytes: 20, mtimeMs: 0, sha256: 'a' },
];

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    status: vi.fn(),
    validate: vi.fn(async () => ({ root: '/work/data/sources', files: [{ path: 'x' }] as never, summary: 'ok' })),
    build: vi.fn(),
    profile: vi.fn(),
    sources: vi.fn(async () => ({ root: '/work/data/sources', entries: ENTRIES })),
    source: vi.fn(async (path: string) => ({ path, content: `# ${path}\n`, sha256: 'sha-1' })),
    writeSource: vi.fn(async (path: string) => ({ path, sha256: 'sha-2' })),
    generate: vi.fn(),
    analyze: vi.fn(), saveAliases: vi.fn(),
    extractOffer: vi.fn(),
    setLlmKey: vi.fn(), removeLlmKey: vi.fn(), applyImportProposal: vi.fn(), importLinkedIn: vi.fn(), importCv: vi.fn(),
    offers: vi.fn(),
    offerFetch: vi.fn(),
    offerSave: vi.fn(),
    themes: vi.fn(),
    createTheme: vi.fn(), installTheme: vi.fn(), verifyTheme: vi.fn(),
    outputs: vi.fn(),
    output: vi.fn(),
    jobs: vi.fn(),
    job: vi.fn(),
    startJob: vi.fn(),
    cancelJob: vi.fn(),
    jobEvents: vi.fn(),
    exportProfile: vi.fn(), importProfile: vi.fn(), llmConfig: vi.fn(), writeLlmConfig: vi.fn(), checkLlm: vi.fn(), offerHistory: vi.fn(), shutdown: vi.fn(), llmRuntime: vi.fn(), llmModels: vi.fn(), llmRuntimeAction: vi.fn(), sourceHistory: vi.fn(), sourceVersion: vi.fn(), restoreSourceVersion: vi.fn(), writeServeConfig: vi.fn(), reviews: vi.fn(), review: vi.fn(), writeReview: vi.fn(), deleteReview: vi.fn(), applyReview: vi.fn(),
    ...overrides,
  };
}

const textarea = (): HTMLTextAreaElement => screen.getByRole('textbox', { name: 'Contenido de experience/acme.md' }) as HTMLTextAreaElement;

describe('Fuentes', () => {
  it('lista el árbol, abre el fichero de la ruta, guarda con la huella leída y valida después', async () => {
    const api = fakeApi();
    const navigate = vi.fn();
    render(Fuentes, { props: { api, item: 'experience/acme.md', onsession: vi.fn(), navigate, plainEditor: true } });
    await waitFor(() => expect(screen.getByText('2 ficheros · sin incidencias')).toBeTruthy());
    expect(screen.getByText('experience/')).toBeTruthy();
    await waitFor(() => expect(textarea().value).toBe('# experience/acme.md\n'));
    const save = screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await fireEvent.input(textarea(), { target: { value: '# editado\n' } });
    expect(screen.getByText(/cambios sin guardar/)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(screen.getByText(/Guardado\. Fuentes válidas \(1 fichero\)/)).toBeTruthy());
    expect(api.writeSource).toHaveBeenCalledWith('experience/acme.md', '# editado\n', 'sha-1');
    // Una validación al cargar el árbol (badges), otra tras guardar y otra al recargar el árbol.
    expect(api.validate).toHaveBeenCalledTimes(3);
    expect(screen.getByText('Markdown · UTF-8 · LF')).toBeTruthy();
    await fireEvent.input(screen.getByLabelText('Filtrar ficheros'), { target: { value: 'prof' } });
    expect(screen.queryByRole('button', { name: 'experience/acme.md' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'profile.md' }));
    expect(navigate).toHaveBeenCalledWith({ page: 'fuentes', item: 'profile.md' });
  });

  it('un 409 abre el diálogo de conflicto: recargar descarta; sobrescribir relee la huella y vuelve a guardar', async () => {
    const writeSource = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, { code: 'conflict', message: 'huella distinta' }))
      .mockRejectedValueOnce(new ApiError(409, { code: 'conflict', message: 'huella distinta' }))
      .mockResolvedValueOnce({ path: 'experience/acme.md', sha256: 'sha-3' });
    const source = vi.fn().mockResolvedValueOnce({ path: 'experience/acme.md', content: 'v1', sha256: 'sha-1' }).mockResolvedValueOnce({ path: 'experience/acme.md', content: 'v2', sha256: 'sha-2' }).mockResolvedValue({ path: 'experience/acme.md', content: 'v2', sha256: 'sha-2' });
    const api = fakeApi({ writeSource, source });
    render(Fuentes, { props: { api, item: 'experience/acme.md', onsession: vi.fn(), navigate: vi.fn(), plainEditor: true } });
    await waitFor(() => expect(textarea().value).toBe('v1'));
    await fireEvent.input(textarea(), { target: { value: 'mío' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(screen.getByRole('dialog').textContent).toContain('Huella en disco');
    await fireEvent.click(screen.getByRole('button', { name: 'Recargar del disco (descarta mis cambios)' }));
    await waitFor(() => expect(textarea().value).toBe('v2'));
    await fireEvent.input(textarea(), { target: { value: 'mío otra vez' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Sobrescribir con mi versión' }));
    await waitFor(() => expect(writeSource).toHaveBeenCalledTimes(3));
    expect(writeSource.mock.calls[2]).toEqual(['experience/acme.md', 'mío otra vez', 'sha-2']);
  });

  it('guardar con problemas de validación los muestra; crear un fichero escribe con «*» y navega a él; un 401 avisa', async () => {
    const onsession = vi.fn();
    const navigate = vi.fn();
    const api = fakeApi({
      validate: vi.fn(async () => {
        throw new ApiError(422, { code: 'invalid-data', message: '1 problema', issues: [{ file: 'experience/acme.md', line: 2, message: 'falta role' }] });
      }),
    });
    render(Fuentes, { props: { api, item: 'experience/acme.md', onsession, navigate, plainEditor: true } });
    await waitFor(() => expect(textarea().value).toContain('acme'));
    await fireEvent.input(textarea(), { target: { value: 'sin role' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(screen.getByText('Guardado, pero las fuentes tienen problemas.')).toBeTruthy());
    expect(screen.getByText('2 ficheros · 1 con incidencias')).toBeTruthy();
    expect(screen.getByLabelText('1 incidencias').textContent).toBe('1');
    await fireEvent.click(screen.getByRole('button', { name: 'experience/acme.md:2' }));
    expect(navigate).toHaveBeenCalledWith({ page: 'fuentes', item: 'experience/acme.md' });
    await fireEvent.click(screen.getByRole('button', { name: 'Nuevo fichero' }));
    await fireEvent.input(screen.getByLabelText(/Ruta relativa/), { target: { value: ' projects/nuevo.md ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(api.writeSource).toHaveBeenCalledWith('projects/nuevo.md', '', '*'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ page: 'fuentes', item: 'projects/nuevo.md' }));
    (api.sources as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new ApiError(401, { code: 'unauthorized', message: 'caducó' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Nuevo fichero' }));
    await fireEvent.input(screen.getByLabelText(/Ruta relativa/), { target: { value: 'otro.md' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(onsession).toHaveBeenCalled());
  });
});

describe('Fuentes · historial de versiones (T-8.10)', () => {
  const FILE: SourceHistoryFile = { path: 'experience/acme.md', sha256Before: 'a', sha256After: 'b', ids: ['exp-acme-1'] };
  const ENTRY: SourceHistoryEntry = { id: '20260830T100000000Z-r', at: '2026-08-30T10:00:00.000Z', action: 'apply', origin: 'revision-improve.md', root: '/work/data/sources', files: [FILE] };

  it('lista las versiones de la fuente abierta, compara con el editor y restaura tras confirmar', async () => {
    const api = fakeApi({
      sourceHistory: vi.fn(async () => ({ entries: [ENTRY, { ...ENTRY, id: 'otra', files: [{ ...FILE, path: 'profile.md' }] }] })),
      sourceVersion: vi.fn(async () => ({ entry: ENTRY, file: FILE, content: '# experience/acme.md\nlínea vieja\n' })),
      restoreSourceVersion: vi.fn(async () => ({ path: '/work/data/sources/experience/acme.md', entry: { ...ENTRY, id: 'nueva', action: 'restore' as const } })),
    });
    render(Fuentes, { props: { api, item: 'experience/acme.md', onsession: vi.fn(), navigate: vi.fn(), plainEditor: true } });
    await waitFor(() => expect(screen.getByText('· 1 versión guardada')).toBeTruthy());
    expect(screen.getByText(/aplicación de/).textContent).toContain('exp-acme-1');
    await fireEvent.click(screen.getByRole('button', { name: 'Ver diferencias' }));
    await waitFor(() => expect(screen.getByLabelText('Versión guardada: 20260830T100000000Z-r')).toBeTruthy());
    expect(api.sourceVersion).toHaveBeenCalledWith({ entry: '20260830T100000000Z-r', path: 'experience/acme.md' });
    expect(screen.getByText(/−1 \+0 líneas/)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Restaurar esta versión' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(api.restoreSourceVersion).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Restaurar esta versión' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Restaurar' }));
    await waitFor(() => expect(screen.getByText(/queda en el histórico \(nueva\)/)).toBeTruthy());
    expect(api.restoreSourceVersion).toHaveBeenCalledWith({ entry: '20260830T100000000Z-r', path: 'experience/acme.md' });
    expect(api.source).toHaveBeenCalledTimes(2);
  });

  it('sin historial lo dice; un fallo al listarlo no rompe la pantalla', async () => {
    const api = fakeApi({ sourceHistory: vi.fn(async () => { throw new Error('sin índice'); }) });
    render(Fuentes, { props: { api, item: 'experience/acme.md', onsession: vi.fn(), navigate: vi.fn(), plainEditor: true } });
    await waitFor(() => expect(screen.getByText('· sin versiones guardadas')).toBeTruthy());
  });
});

