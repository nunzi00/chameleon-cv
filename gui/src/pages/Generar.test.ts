import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ApiError, type ApiClient } from '../lib/api/client';
import type { AnalyzeResponse, GenerateResponse, StatusResponse } from '../lib/api/types';
import Generar from './Generar.svelte';

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:vista');
  URL.revokeObjectURL = vi.fn();
});

const STATUS = {
  version: '1.2.0',
  workspace: '/work',
  artifact: { status: 'fresh', detail: undefined, specialties: ['backend', 'nube'] },
  typst: { required: '0.15.1', candidates: [], selected: undefined, usable: true },
  llm: { config: undefined, configError: undefined, health: undefined, keys: {}, keysFile: '', allowedHosts: [], remote: undefined, usable: false, settings: { path: undefined, present: false, configured: false, error: undefined }, providers: [] },
  themes: { defaultName: 'default', configWarning: undefined, roots: [], entries: [] },
} as unknown as StatusResponse;

const MD: GenerateResponse = {
  output: { name: 'cv-ada-backend.md', kind: 'md', path: 'output/cv-ada-backend.md', markdown: '# Ada Ejemplo\n' },
  report: { selection: { specialtyId: 'backend', vocabulary: ['php'], decisions: [] }, match: undefined, limits: {}, removed: [], theme: undefined },
  warnings: [],
};

const ANALYSIS = {
  offer: { source: 'texto', terms: [{ term: 'kubernetes', emphasis: 'required', occurrences: 1, weight: 1 }], gaps: [], experienceYears: undefined },
  summary: { recognized: 1, demonstrated: 1, ratio: 1, requiredTotal: 1, requiredDemonstrated: 1 },
  coverage: { kubernetes: ['exp-acme'] },
  decisions: [],
  ranking: [],
  selection: { specialtyId: 'backend', vocabulary: [], decisions: [] },
  warnings: [],
} as unknown as AnalyzeResponse;

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    status: vi.fn(async () => STATUS),
    validate: vi.fn(), build: vi.fn(), profile: vi.fn(), sources: vi.fn(), source: vi.fn(), writeSource: vi.fn(), exportProfile: vi.fn(), importProfile: vi.fn(), llmConfig: vi.fn(), writeLlmConfig: vi.fn(), checkLlm: vi.fn(), shutdown: vi.fn(), reviews: vi.fn(), review: vi.fn(), writeReview: vi.fn(), deleteReview: vi.fn(), applyReview: vi.fn(), outputs: vi.fn(), jobs: vi.fn(), job: vi.fn(), startJob: vi.fn(), cancelJob: vi.fn(), jobEvents: vi.fn(),
    themes: vi.fn(async () => ({ defaultName: 'default', configWarning: undefined, roots: [], entries: [{ name: 'default' }, { name: 'classic' }] as never })),
    generate: vi.fn(async () => MD),
    analyze: vi.fn(async () => ANALYSIS),
    extractOffer: vi.fn(async () => ({ text: 'Texto del PDF' })),
    createTheme: vi.fn(async () => ({ name: 'mio', directory: '/work/themes/mio', from: 'classic' } as never)),
    output: vi.fn(async (name: string) => ({ name, contentType: 'application/pdf', blob: new Blob(['%PDF'], { type: 'application/pdf' }) })),
    ...overrides,
  };
}

describe('Generar', () => {
  it('genera Markdown con la especialidad elegida, muestra el resultado y el informe de decisiones', async () => {
    const api = fakeApi();
    render(Generar, { props: { api, onsession: vi.fn(), navigate: vi.fn() } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'backend' })).toBeTruthy());
    await fireEvent.change(screen.getByLabelText('Especialidad'), { target: { value: 'backend' } });
    await fireEvent.change(screen.getByLabelText('Formato'), { target: { value: 'md' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Generar CV' }));
    await waitFor(() => expect(screen.getByText('# Ada Ejemplo')).toBeTruthy());
    expect(api.generate).toHaveBeenCalledWith({ specialty: 'backend', format: 'md' });
    expect(screen.getByText('CV escrito en output/cv-ada-backend.md')).toBeTruthy();
    expect(screen.getByText('Informe de decisiones')).toBeTruthy();
    expect(screen.getByText(/Especialidad «backend»/)).toBeTruthy();
    expect((screen.getByRole('link', { name: 'Descargar' }) as HTMLAnchorElement).getAttribute('download')).toBe('cv-ada-backend.md');
  });

  it('con Typst utilizable propone el motor Typst y el tema; un PDF generado se muestra en el visor', async () => {
    const PDF: GenerateResponse = { output: { name: 'cv.pdf', kind: 'pdf', path: 'output/cv.pdf', bytes: 4 }, report: undefined, warnings: [{ kind: 'freshness-unknown', reason: 'x' }] };
    const api = fakeApi({ generate: vi.fn(async () => PDF) });
    render(Generar, { props: { api, onsession: vi.fn(), navigate: vi.fn() } });
    await waitFor(() => expect(screen.getByLabelText('Tema')).toBeTruthy());
    await fireEvent.change(screen.getByLabelText('Tema'), { target: { value: 'classic' } });
    await fireEvent.input(screen.getByLabelText('Top N logros'), { target: { value: '3' } });
    await fireEvent.click(screen.getByLabelText('Compacto (una página)'));
    await fireEvent.click(screen.getByRole('button', { name: 'Generar CV' }));
    await waitFor(() => expect(screen.getByTitle('Vista previa de cv.pdf')).toBeTruthy());
    expect(api.generate).toHaveBeenCalledWith({ format: 'pdf', engine: 'typst', theme: 'classic', topN: 3, compact: true });
    expect(api.output).toHaveBeenCalledWith('cv.pdf');
    expect(screen.getByText('Avisos')).toBeTruthy();
  });

  it('analiza una oferta pegada, extrae el texto de un PDF y rechaza lo incompleto sin llamar a la API', async () => {
    const api = fakeApi();
    render(Generar, { props: { api, onsession: vi.fn(), navigate: vi.fn() } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'backend' })).toBeTruthy());
    await fireEvent.change(screen.getByLabelText('Oferta'), { target: { value: 'text' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Analizar oferta' }));
    expect(screen.getByText('Falta algo')).toBeTruthy();
    expect(api.analyze).not.toHaveBeenCalled();
    const upload = screen.getByLabelText(/sube su PDF/) as HTMLInputElement;
    const file = new File(['%PDF-1.7'], 'oferta.pdf', { type: 'application/pdf' });
    Object.defineProperty(upload, 'files', { value: [file] });
    await fireEvent.change(upload);
    await waitFor(() => expect((screen.getByLabelText('Texto de la oferta') as HTMLTextAreaElement).value).toBe('Texto del PDF'));
    expect(api.extractOffer).toHaveBeenCalledWith(file);
    await fireEvent.click(screen.getByRole('button', { name: 'Analizar oferta' }));
    await waitFor(() => expect(screen.getByText('Oferta texto · 1 requisitos reconocidos')).toBeTruthy());
    expect(api.analyze).toHaveBeenCalledWith({ offer: { text: 'Texto del PDF' } });
    expect(screen.getByText(/1 de 1 requisitos demostrados/)).toBeTruthy();
  });

  it('crea un tema a partir de otro y lo selecciona; un 401 avisa de la sesión', async () => {
    const onsession = vi.fn();
    const api = fakeApi({ generate: vi.fn(async () => { throw new ApiError(401, { code: 'unauthorized', message: 'caducó' }); }) });
    render(Generar, { props: { api, onsession, navigate: vi.fn() } });
    await waitFor(() => expect(screen.getByLabelText(/Nuevo tema/)).toBeTruthy());
    await fireEvent.input(screen.getByLabelText(/Nuevo tema/), { target: { value: ' mio ' } });
    await fireEvent.change(screen.getByLabelText('A partir de'), { target: { value: 'classic' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Crear tema' }));
    await waitFor(() => expect(screen.getByText(/Tema «mio» creado/)).toBeTruthy());
    expect(api.createTheme).toHaveBeenCalledWith({ name: 'mio', from: 'classic' });
    expect(api.themes).toHaveBeenCalledTimes(2);
    await fireEvent.click(screen.getByRole('button', { name: 'Generar CV' }));
    await waitFor(() => expect(onsession).toHaveBeenCalled());
  });
});
