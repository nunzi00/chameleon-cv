import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import { ApiError, type ApiClient } from '../lib/api/client';
import type { SseEvent } from '../lib/api/sse';
import type { StatusResponse } from '../lib/api/types';
import type { JobSnapshot } from '../lib/copilot/jobs';
import Copiloto from './Copiloto.svelte';

const STATUS = {
  version: '1.3.0',
  workspace: '/work',
  artifact: { status: 'fresh', detail: undefined, specialties: ['backend'] },
  typst: { required: '0.15.1', candidates: [], selected: undefined, usable: false },
  llm: { config: undefined, configError: undefined, health: undefined, keys: {}, keysFile: '', allowedHosts: [], remote: undefined, usable: true, settings: { path: undefined, present: false, configured: false, error: undefined }, providers: [] },
  themes: { defaultName: 'default', configWarning: undefined, roots: [], entries: [] },
} as unknown as StatusResponse;

const running: JobSnapshot = { id: 'job-0001', kind: 'improve', status: 'running', createdAt: 'c', startedAt: 's', finishedAt: undefined, lines: [], result: undefined, error: undefined };

async function* events(list: SseEvent[]): AsyncGenerator<SseEvent, void, undefined> {
  for (const event of list) {
    yield event;
  }
}

const LLM_CONFIG = {
  llm: {
    config: undefined, configError: undefined, health: undefined, keys: { openai: 'env' as const, anthropic: 'none' as const, groq: 'none' as const, gemini: 'none' as const }, keysFile: '', allowedHosts: [], remote: undefined, usable: true,
    settings: { path: undefined, present: false, configured: false, error: undefined, values: { think: true } },
    providers: [{ id: 'openai' as const, plan: 'paid' as const, availability: 'available' as const, availabilityNote: undefined, dataNote: undefined, host: 'api.openai.com', baseUrl: 'https://api.openai.com', defaultModel: 'gpt-4o-mini', models: [], keyPresence: 'env' as const, quota: undefined, rateLimitsUrl: 'https://x', c7: { sourceUrl: 'https://x', verifiedAt: '2026-08-30', quote: 'q' }, live: undefined }],
  },
  file: { path: '/work/cv.toml', present: false, sha256: undefined },
  remote: { allowed: true, configured: undefined, pending: false },
};

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    status: vi.fn(async () => STATUS),
    profile: vi.fn(async () => ({ experience: [{ role: 'Dev', company: 'ACME', achievements: [{ id: 'exp-acme-1', text: 'Hice A' }] }], projects: [], achievements: [] }) as never),
    jobs: vi.fn(async () => ({ jobs: [] })),
    job: vi.fn(),
    startJob: vi.fn(async () => ({ job: running, sending: { destination: 'ollama (local)', items: 1, words: 9, redactCompanies: false }, warnings: [] })),
    cancelJob: vi.fn(async () => ({ job: { ...running, status: 'cancelled' as const } })),
    jobEvents: vi.fn(() => events([{ event: 'line', data: { line: '[1/1] exp-acme-1: 1/1 aceptadas · 30 ms' }, raw: '' }, { event: 'status', data: { ...running, status: 'done', lines: ['[1/1] exp-acme-1: 1/1 aceptadas · 30 ms'], result: { review: { name: 'revision-improve-2026-08-30.md', path: 'output/revision-improve-2026-08-30.md', sha256: 'h' }, stats: { items: 1, proposals: 1, accepted: 1, rejected: 0, failed: 0, fromCache: 0 } } }, raw: '' }])),
    validate: vi.fn(), build: vi.fn(), sources: vi.fn(), source: vi.fn(), writeSource: vi.fn(), generate: vi.fn(), analyze: vi.fn(), saveAliases: vi.fn(), applyTags: vi.fn(), rankOffers: vi.fn(), importFolder: vi.fn(), extractOffer: vi.fn(), setLlmKey: vi.fn(), removeLlmKey: vi.fn(), applyImportProposal: vi.fn(), importLinkedIn: vi.fn(), importCv: vi.fn(), offers: vi.fn(), offerFetch: vi.fn(), offerSave: vi.fn(), themes: vi.fn(), createTheme: vi.fn(), installTheme: vi.fn(), verifyTheme: vi.fn(), outputs: vi.fn(), output: vi.fn(), exportProfile: vi.fn(), importProfile: vi.fn(), llmConfig: vi.fn(async () => LLM_CONFIG), writeLlmConfig: vi.fn(), checkLlm: vi.fn(), offerHistory: vi.fn(), shutdown: vi.fn(), llmRuntime: vi.fn(), llmModels: vi.fn(), llmRuntimeAction: vi.fn(), sourceHistory: vi.fn(), sourceVersion: vi.fn(), restoreSourceVersion: vi.fn(), writeServeConfig: vi.fn(), reviews: vi.fn(), review: vi.fn(), writeReview: vi.fn(), deleteReview: vi.fn(), applyReview: vi.fn(),
    ...overrides,
  };
}

describe('Co-piloto', () => {
  it('lanza un improve, muestra qué sale, sigue el progreso por SSE y ofrece abrir la revisión', async () => {
    const api = fakeApi();
    const navigate = vi.fn();
    render(Copiloto, { props: { api, onsession: vi.fn(), navigate } });
    await waitFor(() => expect(screen.getByText('proveedor local listo')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Razonamiento')).toBeTruthy());
    expect(screen.getByText(/pedido en cv\.toml — las tareas con esquema JSON lo ignoran/)).toBeTruthy();
    expect(screen.getAllByText('Modelo').length).toBeGreaterThanOrEqual(1);
    await fireEvent.input(screen.getByLabelText(/Solo estos logros/), { target: { value: 'exp-acme-1' } });
    await fireEvent.input(screen.getByLabelText(/Propuestas por logro/), { target: { value: '1' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Lanzar trabajo' }));
    await waitFor(() => expect(screen.getByText('hacia ollama (local) · 1 fragmento · 9 palabras · sin nombre ni datos de contacto')).toBeTruthy());
    expect(api.startJob).toHaveBeenCalledWith({ kind: 'improve', body: { only: ['exp-acme-1'], proposals: 1 } });
    await waitFor(() => expect(screen.getByText('terminado')).toBeTruthy());
    expect(screen.getByText(/\[1\/1\] exp-acme-1/)).toBeTruthy();
    expect(screen.getByText(/Revisión escrita en output\/revision-improve-2026-08-30\.md/)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Abrir la revisión' }));
    expect(navigate).toHaveBeenCalledWith({ page: 'revisiones', item: 'revision-improve-2026-08-30.md' });
  });

  it('un 409 abre el consentimiento y confirmar reenvía con el estimateId; un 403 avisa; un fallo del formulario no llama a la API', async () => {
    const startJob = vi.fn().mockRejectedValueOnce(new ApiError(409, { code: 'consent-required', message: 'confirma', estimateId: 'e-1', warning: 'Coste estimado: 2 peticiones', estimate: { requests: 2 } })).mockResolvedValueOnce({ job: { ...running, kind: 'summarize' }, sending: {}, warnings: [] }).mockRejectedValueOnce(new ApiError(403, { code: 'remote-disabled', message: 'arráncalo con --allow-remote' }));
    const api = fakeApi({ startJob, jobEvents: vi.fn(() => events([])) });
    render(Copiloto, { props: { api, onsession: vi.fn(), navigate: vi.fn() } });
    await waitFor(() => expect(screen.getByRole('radio', { name: /Resumen profesional/ })).toBeTruthy());
    await fireEvent.click(screen.getByRole('radio', { name: /Resumen profesional/ }));
    await waitFor(() => expect(screen.getByRole('radio', { name: /^openai/ })).toBeTruthy());
    await fireEvent.click(screen.getByRole('radio', { name: /^openai/ }));
    expect(screen.getByText(/openai \(remoto\) · exige consentimiento/)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Lanzar trabajo' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(screen.getByText('Coste estimado: 2 peticiones')).toBeTruthy();
    expect(screen.getByText('peticiones: 2')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Enviar y lanzar' }));
    await waitFor(() => expect(startJob).toHaveBeenCalledTimes(2));
    expect(startJob.mock.calls[1]?.[0]).toEqual({ kind: 'summarize', body: { provider: 'openai', consent: { estimateId: 'e-1' } } });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await fireEvent.click(screen.getByRole('button', { name: 'Lanzar trabajo' }));
    await waitFor(() => expect(screen.getByText('Los proveedores remotos están desactivados')).toBeTruthy());
    await fireEvent.input(screen.getByLabelText(/Párrafos/), { target: { value: '9' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Lanzar trabajo' }));
    expect(screen.getByText('Párrafos debe estar entre 1 y 3')).toBeTruthy();
    expect(startJob).toHaveBeenCalledTimes(3);
  });

  it('recupera los trabajos de la sesión al entrar, sigue los que corren, cancela y muestra fallos y etiquetas', async () => {
    const failed: JobSnapshot = { ...running, id: 'job-0002', status: 'failed', error: { code: 'environment', message: 'sin disco', lines: ['detalle'] } };
    const tags: JobSnapshot = { ...running, id: 'job-0003', kind: 'suggest-tags', status: 'done', result: { items: [{ id: 'exp-acme-1', line: '#php' }], stats: { items: 1, suggested: 1, fresh: 1, rejected: 0, failed: 0 }, cancelled: false } };
    const api = fakeApi({ jobs: vi.fn(async () => ({ jobs: [running, failed, tags] })), jobEvents: vi.fn(() => events([{ event: 'line', data: { line: 'progreso' }, raw: '' }])) });
    render(Copiloto, { props: { api, onsession: vi.fn(), navigate: vi.fn() } });
    await waitFor(() => expect(screen.getByText('progreso')).toBeTruthy());
    expect(api.jobEvents).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Fallo (environment)')).toBeTruthy();
    expect(screen.getByText('exp-acme-1: #php')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.getByText('cancelado')).toBeTruthy());
    expect(api.cancelJob).toHaveBeenCalledWith('job-0001');
  });

  it('las etiquetas nuevas se marcan una a una y se escriben en las fuentes; el plan se enseña entero (T-9.15)', async () => {
    const sugeridas: JobSnapshot = {
      ...running,
      id: 'job-0004',
      kind: 'suggest-tags',
      status: 'done',
      result: {
        items: [
          { id: 'exp-acme-1', line: '#php #kubernetes', accepted: [{ tag: 'php', isNew: false, reason: 'ya la tenía' }, { tag: 'kubernetes', isNew: true, reason: 'migración a Kubernetes' }, { tag: 'symfony', isNew: true, reason: '' }] },
          { id: undefined, line: '#php' },
        ],
        stats: { items: 2, suggested: 3, fresh: 2, rejected: 0, failed: 0 },
        cancelled: false,
      },
    };
    const applyTags = vi.fn(async () => ({
      plan: [{ ok: true as const, id: 'exp-acme-1', file: 'experience/acme.md', line: 12, text: 'Reduje la latencia.', add: ['kubernetes'] }],
      applied: [{ id: 'exp-acme-1', added: ['kubernetes'] }],
      skipped: [],
      written: [{ file: 'experience/acme.md', backup: 'acme.md.bak', ids: ['exp-acme-1'] }],
    }));
    const api = fakeApi({ jobs: vi.fn(async () => ({ jobs: [sugeridas] })), applyTags: applyTags as never });
    render(Copiloto, { props: { api, onsession: vi.fn(), navigate: vi.fn() } });
    await waitFor(() => expect(screen.getByText('Etiquetas nuevas que puedes escribir en tus fuentes')).toBeTruthy());
    // La que la viñeta ya tenía no se ofrece, y el texto suelto tampoco: no hay dónde escribirlo.
    expect(screen.queryByText('#php')).toBeNull();
    expect(screen.getByText('#symfony')).toBeTruthy();
    // Nada viene marcado: hasta que el usuario elige, el botón no escribe (C2).
    const boton = screen.getByRole('button', { name: 'Aplicar en mis fuentes' });
    expect((boton as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(screen.getByRole('checkbox', { name: /kubernetes/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Aplicar 1 en mis fuentes' }));
    await waitFor(() => expect(applyTags).toHaveBeenCalledWith({ proposals: [{ id: 'exp-acme-1', tags: ['kubernetes'] }] }));
    expect(screen.getByText('exp-acme-1: #kubernetes')).toBeTruthy();
    expect(screen.getByText(/Escrito en experience\/acme\.md/)).toBeTruthy();
    // Escrito lo marcado, se desmarca: no se vuelve a escribir sin volver a elegir.
    await waitFor(() => expect((screen.getByRole('button', { name: 'Aplicar en mis fuentes' }) as HTMLButtonElement).disabled).toBe(true));
  });

  it('si la escritura de etiquetas falla, se explica y no se pierde lo marcado', async () => {
    const sugeridas: JobSnapshot = { ...running, id: 'job-0005', kind: 'suggest-tags', status: 'done', result: { items: [{ id: 'exp-acme-1', line: '#kubernetes', accepted: [{ tag: 'kubernetes', isNew: true, reason: '' }] }], stats: { items: 1, suggested: 1, fresh: 1, rejected: 0, failed: 0 }, cancelled: false } };
    const api = fakeApi({
      jobs: vi.fn(async () => ({ jobs: [sugeridas] })),
      applyTags: vi.fn(async () => { throw new ApiError(503, { code: 'environment', message: 'No se pudo escribir experience/acme.md: solo lectura' }); }) as never,
    });
    render(Copiloto, { props: { api, onsession: vi.fn(), navigate: vi.fn() } });
    await waitFor(() => expect(screen.getByText('Etiquetas nuevas que puedes escribir en tus fuentes')).toBeTruthy());
    await fireEvent.click(screen.getByRole('checkbox', { name: /kubernetes/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Aplicar 1 en mis fuentes' }));
    await waitFor(() => expect(screen.getByText(/solo lectura/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Aplicar 1 en mis fuentes' })).toBeTruthy();
  });

  it('un 401 al cargar devuelve a la puerta de sesión', async () => {
    const onsession = vi.fn();
    const api = fakeApi({ status: vi.fn(async () => { throw new ApiError(401, { code: 'unauthorized', message: 'caducó' }); }) });
    render(Copiloto, { props: { api, onsession, navigate: vi.fn() } });
    await waitFor(() => expect(onsession).toHaveBeenCalled());
  });
});
