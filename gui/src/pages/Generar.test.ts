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

const MD: GenerateResponse = { history: [],
  output: { name: 'cv-ada-backend.md', kind: 'md', path: 'output/cv-ada-backend.md', markdown: '# Ada Ejemplo\n' },
  report: { selection: { specialtyId: 'backend', vocabulary: ['php'], decisions: [] }, match: undefined, limits: {}, removed: [], kept: [], theme: undefined },
  warnings: [],
};

const ANALYSIS = { history: [],
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
    validate: vi.fn(), build: vi.fn(), profile: vi.fn(), sources: vi.fn(), source: vi.fn(), writeSource: vi.fn(), deleteSourcePlan: vi.fn(), deleteSource: vi.fn(), exportProfile: vi.fn(), importProfile: vi.fn(), llmConfig: vi.fn(), writeLlmConfig: vi.fn(), checkLlm: vi.fn(), shutdown: vi.fn(), llmRuntime: vi.fn(), llmModels: vi.fn(), llmRuntimeAction: vi.fn(), sourceHistory: vi.fn(), sourceVersion: vi.fn(), restoreSourceVersion: vi.fn(), writeServeConfig: vi.fn(), reviews: vi.fn(), review: vi.fn(), writeReview: vi.fn(), deleteReview: vi.fn(), archiveReview: vi.fn(), undoReview: vi.fn(), applyReview: vi.fn(), outputs: vi.fn(), jobs: vi.fn(), job: vi.fn(), startJob: vi.fn(), cancelJob: vi.fn(), jobEvents: vi.fn(),
    themes: vi.fn(async () => ({ defaultName: 'default', configWarning: undefined, roots: [], entries: [{ name: 'default' }, { name: 'classic' }] as never })),
    generate: vi.fn(async () => MD),
    analyze: vi.fn(async () => ANALYSIS), saveAliases: vi.fn(), applyTags: vi.fn(), rankOffers: vi.fn(), importFolder: vi.fn(), cvFolders: vi.fn(), linkedinPlan: vi.fn(), vidaLaboral: vi.fn(),
    offerHistory: vi.fn(async () => ({ entries: [] })),
    extractOffer: vi.fn(async () => ({ text: 'Texto del PDF' })),
    setLlmKey: vi.fn(), removeLlmKey: vi.fn(), applyImportProposal: vi.fn(), drafts: vi.fn(), draftFiles: vi.fn(), draftFile: vi.fn(), writeDraftFile: vi.fn(), adoptDraftEntries: vi.fn(), duplicates: vi.fn(), resolveDuplicate: vi.fn(), importLinkedIn: vi.fn(), importManfred: vi.fn(), importCv: vi.fn(),
    offers: vi.fn(),
    offerFetch: vi.fn(),
    offerSave: vi.fn(),
    createTheme: vi.fn(async () => ({ name: 'mio', directory: '/work/themes/mio', from: 'classic' } as never)),
    installTheme: vi.fn(),
    verifyTheme: vi.fn(),
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
    const PDF: GenerateResponse = { history: [], output: { name: 'cv.pdf', kind: 'pdf', path: 'output/cv.pdf', bytes: 4 }, report: undefined, warnings: [{ kind: 'freshness-unknown', reason: 'x' }] };
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

  it('compara varias ofertas guardadas y deja quedarse con una (T-9.13)', async () => {
    const rankOffers = vi.fn(async () => ({
      ranked: [
        { name: 'acme', recognized: 5, demonstrated: 4, ratio: 0.8, requiredTotal: 3, requiredDemonstrated: 3, gaps: ['kafka'], suggestedSpecialty: 'backend' },
        { name: 'beta', recognized: 2, demonstrated: 1, ratio: 0.5, requiredTotal: 2, requiredDemonstrated: 1, gaps: [], suggestedSpecialty: undefined },
      ],
      failed: [],
      warnings: [],
    }));
    const api = fakeApi({
      offers: vi.fn(async () => ({
        files: [
          { path: 'offers/acme.txt', bytes: 10, modifiedAt: '2026-08-31T00:00:00.000Z', kind: 'text' as const },
          { path: 'offers/beta.txt', bytes: 10, modifiedAt: '2026-08-31T00:00:00.000Z', kind: 'text' as const },
        ],
      })),
      rankOffers: rankOffers as never,
    });
    render(Generar, { props: { api, onsession: vi.fn(), navigate: vi.fn() } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'backend' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('tab', { name: 'Del espacio' }));
    await fireEvent.focus(screen.getByLabelText('Oferta guardada en offers/'));
    await waitFor(() => expect(screen.getByText(/Comparar varias ofertas/)).toBeTruthy());
    // Con una sola marcada no hay nada que comparar: el botón lo dice y no llama a nada.
    await fireEvent.click(screen.getByRole('checkbox', { name: 'offers/acme.txt' }));
    expect((screen.getByRole('button', { name: 'Comparar (marca al menos dos)' }) as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(screen.getByRole('checkbox', { name: 'offers/beta.txt' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Comparar 2 ofertas' }));
    await waitFor(() => expect(screen.getByText('4/5 (80 %)')).toBeTruthy());
    expect(rankOffers).toHaveBeenCalledWith({ offers: [{ workspaceFile: 'offers/acme.txt' }, { workspaceFile: 'offers/beta.txt' }] });
    // «Usar esta» deja la oferta elegida en el formulario, lista para analizar o generar.
    await fireEvent.click(screen.getAllByRole('button', { name: 'Usar esta' })[0]!);
    expect((screen.getByPlaceholderText('offers/acme.txt') as HTMLInputElement).value).toBe('offers/acme.txt');
  });

  it('S2: el selector lista offers/, la URL pasa por consentimiento y el texto llega con procedencia; guardar llama a offerSave', async () => {
    const api = fakeApi({
      offers: vi.fn(async () => ({ files: [{ path: 'offers/acme.txt', bytes: 10, modifiedAt: '2026-08-31T00:00:00.000Z', kind: 'text' as const }] })),
      offerFetch: vi.fn()
        .mockRejectedValueOnce(new ApiError(409, { code: 'consent-required', message: 'confirma', estimateId: 'e-1', host: 'empresa.com', limitBytes: 2 * 1024 * 1024 } as never))
        .mockResolvedValueOnce({ text: 'Título: Backend Senior\n\nCuerpo de la oferta', title: 'Backend Senior', source: 'json-ld', warnings: ['aviso de prueba'], origin: { url: 'https://empresa.com/oferta', fetchedAt: 'x', kind: 'html' as const, bytes: 345 } }),
      offerSave: vi.fn(async () => ({ path: 'offers/backend.txt' })),
    });
    render(Generar, { props: { api, onsession: vi.fn(), navigate: vi.fn() } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'backend' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('tab', { name: 'Del espacio' }));
    await fireEvent.focus(screen.getByLabelText('Oferta guardada en offers/'));
    await waitFor(() => expect(screen.getByRole('option', { name: 'offers/acme.txt' })).toBeTruthy());
    await fireEvent.change(screen.getByLabelText('Oferta guardada en offers/'), { target: { value: 'offers/acme.txt' } });
    expect((screen.getByPlaceholderText('offers/acme.txt') as HTMLInputElement).value).toBe('offers/acme.txt');
    await fireEvent.click(screen.getByRole('tab', { name: 'URL' }));
    await fireEvent.input(screen.getByLabelText('URL de la oferta (https)'), { target: { value: 'https://empresa.com/oferta' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Descargar' }));
    await waitFor(() => expect(screen.getByText('empresa.com')).toBeTruthy());
    await fireEvent.click(screen.getAllByRole('button', { name: 'Descargar' }).at(-1)!);
    await waitFor(() => expect(screen.getByText(/procedencia: json-ld/)).toBeTruthy());
    expect(api.offerFetch).toHaveBeenLastCalledWith({ url: 'https://empresa.com/oferta', consent: { estimateId: 'e-1' } });
    expect((screen.getByLabelText('Texto de la oferta') as HTMLTextAreaElement).value).toContain('Backend Senior');
    expect(screen.getByText('aviso de prueba')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.offerSave).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('Backend Senior') as string, origin: { url: 'https://empresa.com/oferta' } })));
  });

  it('S2: sin --allow-remote, el 403 explica cómo arrancar el servidor', async () => {
    const api = fakeApi({ offerFetch: vi.fn(async () => { throw new ApiError(403, { code: 'remote-disabled', message: 'arráncalo con «cv serve --allow-remote»' }); }) });
    render(Generar, { props: { api, onsession: vi.fn(), navigate: vi.fn() } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'backend' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('tab', { name: 'URL' }));
    await fireEvent.input(screen.getByLabelText('URL de la oferta (https)'), { target: { value: 'https://x.com/y' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Descargar' }));
    await waitFor(() => expect(screen.getByText(/--allow-remote/)).toBeTruthy());
  });

  it('analiza una oferta pegada, extrae el texto de un PDF y rechaza lo incompleto sin llamar a la API', async () => {
    const api = fakeApi();
    render(Generar, { props: { api, onsession: vi.fn(), navigate: vi.fn() } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'backend' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('tab', { name: 'Texto' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Analizar oferta' }));
    expect(screen.getByText('Falta algo')).toBeTruthy();
    expect(api.analyze).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('tab', { name: 'PDF' }));
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

describe('Generar · selección explícita de skills y proyectos', () => {
  it('con perfil, ofrece selectores múltiples y envía las listas elegidas', async () => {
    const profile = { specialties: [], experience: [], skills: [{ name: 'PHP', category: 'language' }, { name: 'Kubernetes', category: 'platform' }], projects: [{ id: 'proj-a', name: 'Proyecto A', achievements: [] }, { id: 'proj-b', name: 'Proyecto B', achievements: [] }] } as never;
    const api = fakeApi({ profile: vi.fn(async () => profile) });
    render(Generar, { props: { api, onsession: vi.fn(), navigate: vi.fn() } });
    await waitFor(() => expect(screen.getByRole('group', { name: 'Skills' })).toBeTruthy());
    expect(screen.getByText('language')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Kubernetes' }));
    await fireEvent.click(screen.getByRole('button', { name: 'PHP' }));
    await fireEvent.click(screen.getByRole('button', { name: /PHP/ }));
    expect((screen.getByRole('button', { name: /Kubernetes/ }) as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(screen.getByRole('button', { name: 'Proyecto B' }));
    await fireEvent.change(screen.getByLabelText('Formato'), { target: { value: 'md' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Generar CV' }));
    await waitFor(() => expect(api.generate).toHaveBeenCalledWith({ format: 'md', skills: ['Kubernetes'], projects: ['proj-b'] }));
    expect(screen.getByText(/Skills \(1\)/)).toBeTruthy();
  });

  it('la misma lista, en modo «todas menos estas», se envía como exclusión', async () => {
    const profile = { specialties: [], experience: [], skills: [{ name: 'PHP', category: 'language' }, { name: 'Kubernetes', category: 'platform' }], projects: [{ id: 'proj-a', name: 'Proyecto A', achievements: [] }] } as never;
    const api = fakeApi({ profile: vi.fn(async () => profile) });
    render(Generar, { props: { api, onsession: vi.fn(), navigate: vi.fn() } });
    await waitFor(() => expect(screen.getByRole('group', { name: 'Skills' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('radio', { name: 'Todas menos estas' }));
    await fireEvent.click(screen.getByRole('button', { name: 'PHP' }));
    await fireEvent.click(screen.getByRole('radio', { name: 'Todos menos estos' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Proyecto A' }));
    await fireEvent.change(screen.getByLabelText('Formato'), { target: { value: 'md' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Generar CV' }));
    await waitFor(() => expect(api.generate).toHaveBeenCalledWith({ format: 'md', excludeSkills: ['PHP'], excludeProjects: ['proj-a'] }));
    expect(screen.getByText(/Skills \(todas menos 1\)/)).toBeTruthy();
  });
});

describe('Generar · historial de la oferta', () => {
  it('al añadir una oferta ya procesada avisa de cuándo y con qué CV', async () => {
    const entries = [{ at: '2026-08-30T12:10:00.000Z', action: 'generate', offer: { name: 'nexo', sha256: 'x' }, specialty: 'backend', output: { path: 'output/cv-nexo.pdf', format: 'pdf' } }];
    const api = fakeApi({ offerHistory: vi.fn(async () => ({ entries })) as never });
    render(Generar, { props: { api, onsession: vi.fn(), navigate: vi.fn() } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'backend' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('tab', { name: 'Texto' }));
    await fireEvent.input(screen.getByLabelText('Texto de la oferta'), { target: { value: 'Buscamos Kubernetes' } });
    await waitFor(() => expect(screen.getByText('Esta oferta ya se procesó una vez')).toBeTruthy(), { timeout: 3000 });
    expect(api.offerHistory).toHaveBeenCalledWith({ offer: { text: 'Buscamos Kubernetes' } });
    expect(screen.getByText('2026-08-30 12:10 · Generar CV (backend) → output/cv-nexo.pdf')).toBeTruthy();
  });
});

describe('Generar · generar con la adecuación (T-8.9)', () => {
  it('tras analizar, rellena la especialidad sugerida si estaba vacía y el botón genera con ella y la oferta', async () => {
    const api = fakeApi({
      analyze: vi.fn(async () => ({
        offer: { source: 'texto', terms: [], gaps: [], experienceYears: undefined },
        history: [],
        summary: { recognized: 2, demonstrated: 1, ratio: 0.5, requiredTotal: 1, requiredDemonstrated: 1 },
        coverage: {},
        decisions: [],
        ranking: [],
        suggestedSpecialty: { id: 'backend', title: 'Backend', covered: 2, total: 3 },
        selection: { specialtyId: 'backend', vocabulary: [], decisions: [] },
        warnings: [],
      }) as never),
    });
    render(Generar, { props: { api, onsession: vi.fn(), navigate: vi.fn() } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'backend' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('tab', { name: 'Texto' }));
    await fireEvent.input(screen.getByLabelText('Texto de la oferta'), { target: { value: 'Buscamos backend con PHP' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Analizar oferta' }));
    await waitFor(() => expect(screen.getByText(/Especialidad sugerida por la oferta: «backend»/)).toBeTruthy());
    expect((screen.getByLabelText('Especialidad') as HTMLSelectElement).value).toBe('backend');
    await fireEvent.change(screen.getByLabelText('Formato'), { target: { value: 'md' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Generar con esta adecuación' }));
    await waitFor(() => expect(api.generate).toHaveBeenCalledWith({ specialty: 'backend', offer: { text: 'Buscamos backend con PHP' }, format: 'md' }));
  });
});


describe('Generar · el co-piloto lee la oferta (T-9.10)', () => {
  const REFINADO = {
    ...ANALYSIS,
    offer: { source: 'texto', terms: [{ term: 'sistemas de mensajería', emphasis: 'desirable', occurrences: 1, weight: 0.75, source: 'copiloto' }], gaps: [], experienceYears: undefined },
    coverage: {},
    copilot: { mappings: [{ tag: 'arquitectura', emphasis: 'desirable', evidence: 'sistemas de mensajería' }], rejected: { unknownTag: 1, unverifiedEvidence: 0, alreadyKnown: 0, duplicate: 0 } },
  } as unknown as AnalyzeResponse;

  it('con la casilla marcada pide la segunda lectura y enseña cada etiqueta CON su evidencia', async () => {
    const api = fakeApi({ analyze: vi.fn(async () => REFINADO) });
    render(Generar, { props: { api, onsession: vi.fn(), navigate: vi.fn() } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'backend' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('tab', { name: 'Texto' }));
    await fireEvent.input(screen.getByLabelText('Texto de la oferta'), { target: { value: 'Buscamos sistemas de mensajería' } });
    await fireEvent.click(screen.getByLabelText(/Refinar la lectura con el co-piloto/));
    await fireEvent.click(screen.getByRole('button', { name: 'Analizar oferta' }));
    await waitFor(() => expect(screen.getByText(/añadió 1 etiqueta\(s\)/)).toBeTruthy());
    expect(api.analyze).toHaveBeenCalledWith({ offer: { text: 'Buscamos sistemas de mensajería' }, copilot: {} });
    // La evidencia se enseña entera: el código verifica que la frase está, no que sostenga la etiqueta.
    expect(screen.getByText(/«sistemas de mensajería»/)).toBeTruthy();
    expect(screen.getByText(/desirable · 0.75 · co-piloto/)).toBeTruthy();
  });

  it('«Guardar como alias» escribe lo que el modelo tendió y enseña qué se guardó y qué no', async () => {
    const saveAliases = vi.fn(async () => ({
      plan: [
        { ok: true, tag: 'arquitectura', alias: 'sistemas de mensajeria', skill: 'Apache Kafka' },
        { ok: false, tag: 'otra', alias: 'x', reason: 'ninguna skill lleva la etiqueta «otra»' },
      ],
      written: [{ ok: true, tag: 'arquitectura', alias: 'sistemas de mensajeria', skill: 'Apache Kafka' }],
      path: 'data/sources/skills.csv',
    }));
    const api = fakeApi({ analyze: vi.fn(async () => REFINADO), saveAliases: saveAliases as never });
    render(Generar, { props: { api, onsession: vi.fn(), navigate: vi.fn() } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'backend' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('tab', { name: 'Texto' }));
    await fireEvent.input(screen.getByLabelText('Texto de la oferta'), { target: { value: 'Buscamos sistemas de mensajería' } });
    await fireEvent.click(screen.getByLabelText(/Refinar la lectura con el co-piloto/));
    await fireEvent.click(screen.getByRole('button', { name: 'Analizar oferta' }));
    // Ninguna viene marcada: el botón no hace nada hasta que se elige.
    await waitFor(() => expect((screen.getByRole('button', { name: 'Guardar como alias' }) as HTMLButtonElement).disabled).toBe(true));
    await fireEvent.click(screen.getByRole('checkbox', { name: /arquitectura/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Guardar 1 como alias' }));
    await waitFor(() => expect(screen.getByText(/«sistemas de mensajeria» → Apache Kafka/)).toBeTruthy());
    // Lo que NO se guardó también se enseña, con su motivo: el usuario decide qué hacer con ello.
    expect(screen.getByText(/no se guardó: ninguna skill/)).toBeTruthy();
    expect(screen.getByText(/Recompila el artefacto/)).toBeTruthy();
    expect(saveAliases).toHaveBeenCalledWith({ proposals: [{ tag: 'arquitectura', evidence: 'sistemas de mensajería' }] });
  });

  it('solo viaja lo marcado: desmarcar una etiqueta la deja fuera', async () => {
    const dos = {
      ...REFINADO,
      copilot: {
        mappings: [
          { tag: 'arquitectura', emphasis: 'desirable', evidence: 'sistemas de mensajería' },
          { tag: 'ci-cd', emphasis: 'required', evidence: 'despliegue continuo' },
        ],
        rejected: { unknownTag: 0, unverifiedEvidence: 0, alreadyKnown: 0, duplicate: 0 },
      },
    } as unknown as AnalyzeResponse;
    const saveAliases = vi.fn(async () => ({ plan: [], written: [], path: 'data/sources/skills.csv' }));
    const api = fakeApi({ analyze: vi.fn(async () => dos), saveAliases: saveAliases as never });
    render(Generar, { props: { api, onsession: vi.fn(), navigate: vi.fn() } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'backend' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('tab', { name: 'Texto' }));
    await fireEvent.input(screen.getByLabelText('Texto de la oferta'), { target: { value: 'Buscamos de todo' } });
    await fireEvent.click(screen.getByLabelText(/Refinar la lectura con el co-piloto/));
    await fireEvent.click(screen.getByRole('button', { name: 'Analizar oferta' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /ci-cd/ })).toBeTruthy());
    await fireEvent.click(screen.getByRole('checkbox', { name: /arquitectura/ }));
    await fireEvent.click(screen.getByRole('checkbox', { name: /ci-cd/ }));
    await fireEvent.click(screen.getByRole('checkbox', { name: /arquitectura/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Guardar 1 como alias' }));
    await waitFor(() => expect(saveAliases).toHaveBeenCalledWith({ proposals: [{ tag: 'ci-cd', evidence: 'despliegue continuo' }] }));
  });

  it('un remoto no se envía sin confirmar el coste: el diálogo lo dice y «Enviar y analizar» reenvía con el estimateId', async () => {
    let first = true;
    const analyze = vi.fn(async () => {
      if (first) {
        first = false;
        throw new ApiError(409, { code: 'consent-required', message: 'confirma', estimateId: 'e-7', estimate: { requests: 1, inputTokens: 900 }, warning: 'Aviso de coste: 1 petición a groq' });
      }
      return REFINADO;
    });
    const api = fakeApi({
      analyze: analyze as never,
      llmConfig: vi.fn(async () => ({
        llm: { providers: [{ id: 'groq', keyPresence: 'file', availability: 'available', plan: 'free', defaultModel: 'gpt-oss' }] },
        remote: { allowed: true },
      }) as never),
    });
    render(Generar, { props: { api, onsession: vi.fn(), navigate: vi.fn() } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'backend' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('tab', { name: 'Texto' }));
    await fireEvent.input(screen.getByLabelText('Texto de la oferta'), { target: { value: 'Buscamos sistemas de mensajería' } });
    await fireEvent.click(screen.getByLabelText(/Refinar la lectura con el co-piloto/));
    await fireEvent.change(screen.getByLabelText('Proveedor'), { target: { value: 'groq' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Analizar oferta' }));
    await waitFor(() => expect(screen.getByText('Aviso de coste: 1 petición a groq')).toBeTruthy());
    expect(screen.getAllByText(/nada más del perfil/).length).toBeGreaterThan(1);
    await fireEvent.click(screen.getByRole('button', { name: 'Enviar y analizar' }));
    await waitFor(() => expect(analyze).toHaveBeenLastCalledWith({ offer: { text: 'Buscamos sistemas de mensajería' }, copilot: { provider: 'groq', consent: { estimateId: 'e-7' } } }));
    await waitFor(() => expect(screen.getByText(/añadió 1 etiqueta\(s\)/)).toBeTruthy());
  });

  it('sin --allow-remote no se envía nada y se explica en la propia pantalla', async () => {
    const api = fakeApi({
      analyze: vi.fn(async () => { throw new ApiError(403, { code: 'remote-disabled', message: 'arráncalo con «cv serve --allow-remote»' }); }) as never,
    });
    render(Generar, { props: { api, onsession: vi.fn(), navigate: vi.fn() } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'backend' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('tab', { name: 'Texto' }));
    await fireEvent.input(screen.getByLabelText('Texto de la oferta'), { target: { value: 'Buscamos Kubernetes' } });
    await fireEvent.click(screen.getByLabelText(/Refinar la lectura con el co-piloto/));
    await fireEvent.click(screen.getByRole('button', { name: 'Analizar oferta' }));
    await waitFor(() => expect(screen.getByText(/--allow-remote/)).toBeTruthy());
  });
});
