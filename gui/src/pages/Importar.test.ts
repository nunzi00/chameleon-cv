/**
 * Pantalla «Importar CV» (T-8.4b): subir un PDF/DOCX como borrador — resumen con cuentas, README como
 * informe, conflicto 409 con «Sustituir», y los errores explicados sin tocar nada.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import { ApiError, type ApiClient } from '../lib/api/client';
import type { SseEvent } from '../lib/api/sse';
import type { ImportCvResponse, JobResponse, LlmConfigResponse } from '../lib/api/types';
import Importar from './Importar.svelte';

async function* events(list: SseEvent[]): AsyncGenerator<SseEvent, void, undefined> {
  for (const event of list) {
    yield event;
  }
}

const JOB: JobResponse['job'] = { id: 'j1', kind: 'import-map', status: 'running', createdAt: '2026-08-31T09:00:00.000Z', startedAt: '2026-08-31T09:00:00.000Z', finishedAt: undefined, result: undefined, error: undefined, lines: [] };
const REPORT = '# Informe del borrador importado\n\n## Propuestas del co-piloto (no aplicadas)\n\n- línea 9 → **experiencia**: algo suelto';
const DONE = { ...JOB, status: 'done' as const, lines: ['Enviando 1 línea(s) sin situar a ollama (qwen3:8b)'], result: { name: 'ada-ejemplo', proposals: [{ n: 9, section: 'experiencia', reason: 'entidad con fechas', text: 'algo suelto' }], rejected: 1, skipped: 2, report: REPORT } };

const RESULT: ImportCvResponse = {
  name: 'ada-ejemplo',
  files: 4,
  counts: { experience: 1, projects: 0, education: 0, certifications: 0, skills: 2, achievements: 0, languages: 0 },
  issues: [{ reason: 'experiencia sin empresa reconocida', line: 3 }],
  unparsed: [{ line: 9, text: 'algo suelto' }],
  readme: '# Informe del borrador importado\n\n- Origen: cv.pdf',
};

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    status: vi.fn(), validate: vi.fn(), build: vi.fn(), profile: vi.fn(), sources: vi.fn(), source: vi.fn(), writeSource: vi.fn(), generate: vi.fn(), analyze: vi.fn(), extractOffer: vi.fn(), themes: vi.fn(), createTheme: vi.fn(), installTheme: vi.fn(), verifyTheme: vi.fn(), exportProfile: vi.fn(), importProfile: vi.fn(), llmConfig: vi.fn(), writeLlmConfig: vi.fn(), checkLlm: vi.fn(), offerHistory: vi.fn(), shutdown: vi.fn(), llmRuntime: vi.fn(), llmModels: vi.fn(), llmRuntimeAction: vi.fn(), sourceHistory: vi.fn(), sourceVersion: vi.fn(), restoreSourceVersion: vi.fn(), writeServeConfig: vi.fn(), reviews: vi.fn(), review: vi.fn(), writeReview: vi.fn(), deleteReview: vi.fn(), applyReview: vi.fn(), jobs: vi.fn(), job: vi.fn(), cancelJob: vi.fn(), outputs: vi.fn(), output: vi.fn(),
    offers: vi.fn(), offerFetch: vi.fn(), offerSave: vi.fn(),
    importCv: vi.fn(async () => RESULT),
    startJob: vi.fn(async () => ({ job: JOB, sending: { destination: 'ollama (local)', items: 1, words: 2, redactCompanies: false }, warnings: [] })),
    jobEvents: vi.fn(() => events([{ event: 'line', data: { line: 'Enviando 1 línea(s) sin situar a ollama (qwen3:8b)' }, raw: '' }, { event: 'status', data: DONE, raw: '' }])),
    ...overrides,
  };
}

async function pickFile(): Promise<File> {
  const file = new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' });
  const input = screen.getByLabelText(/Fichero/) as HTMLInputElement;
  await fireEvent.change(input, { target: { files: [file] } });
  return file;
}

describe('Importar', () => {
  it('sube el fichero, muestra el resumen con cuentas y el README, y respeta el nombre opcional', async () => {
    const api = fakeApi();
    render(Importar, { props: { api, onsession: vi.fn() } });
    const button = screen.getByRole('button', { name: 'Importar como borrador' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    const file = await pickFile();
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.input(screen.getByLabelText(/Nombre del borrador/), { target: { value: ' mio ' } });
    await fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(/Borrador escrito en import\/ada-ejemplo/)).toBeTruthy());
    expect(api.importCv).toHaveBeenCalledWith(file, { name: 'mio' });
    expect(screen.getByText(/1 experiencia · 2 habilidades/)).toBeTruthy();
    expect(screen.getByText(/1 aviso y 1 línea sin situar/)).toBeTruthy();
    expect(screen.getByLabelText('Informe del borrador').textContent).toContain('# Informe del borrador importado');
  });

  it('un 409 ofrece sustituir y la segunda llamada va con replace; otros errores solo se explican', async () => {
    const api = fakeApi({
      importCv: vi.fn()
        .mockRejectedValueOnce(new ApiError(409, { code: 'conflict', message: 'Ya existe import/ada-ejemplo' }))
        .mockResolvedValueOnce(RESULT),
    });
    render(Importar, { props: { api, onsession: vi.fn() } });
    await pickFile();
    await fireEvent.click(screen.getByRole('button', { name: 'Importar como borrador' }));
    await waitFor(() => expect(screen.getByText('Ya existe un borrador con ese nombre')).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Sustituir el borrador existente' }));
    await waitFor(() => expect(screen.getByText(/Borrador escrito en/)).toBeTruthy());
    expect(api.importCv).toHaveBeenLastCalledWith(expect.any(File), { replace: true });
    const failing = fakeApi({ importCv: vi.fn(async () => { throw new ApiError(422, { code: 'invalid-data', message: 'no es un PDF' }); }) });
    render(Importar, { props: { api: failing, onsession: vi.fn() } });
    const inputs = screen.getAllByLabelText(/Fichero/);
    await fireEvent.change(inputs[inputs.length - 1]!, { target: { files: [new File(['x'], 'x.txt')] } });
    const buttons = screen.getAllByRole('button', { name: 'Importar como borrador' });
    await fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(screen.getByText('Los datos no son válidos')).toBeTruthy());
  });

  it('refina con el co-piloto: propone sin aplicar, avisa de lo rechazado y de lo que no cupo, y refresca el informe (T-8.18)', async () => {
    const api = fakeApi();
    render(Importar, { props: { api, onsession: vi.fn() } });
    await pickFile();
    await fireEvent.click(screen.getByRole('button', { name: 'Importar como borrador' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refinar con el co-piloto' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Refinar con el co-piloto' }));
    await waitFor(() => expect(screen.getByText('1 propuesta en el informe (sin aplicar)')).toBeTruthy());
    expect(api.startJob).toHaveBeenCalledWith({ kind: 'import-map', body: { name: 'ada-ejemplo' } });
    expect(screen.getByText(/línea 9: algo suelto \(entidad con fechas\)/)).toBeTruthy();
    expect(screen.getByText(/1 propuesta rechazada por el código/)).toBeTruthy();
    expect(screen.getByText(/2 líneas sin situar fuera del lote/)).toBeTruthy();
    // El informe de la página queda como lo dejó el trabajo.
    expect(screen.getByLabelText('Informe del borrador').textContent).toContain('## Propuestas del co-piloto (no aplicadas)');
  });

  it('un servidor sin remotos lo explica y un remoto pide confirmar el coste antes de enviar (T-8.18)', async () => {
    const forbidden = fakeApi({ startJob: vi.fn(async () => { throw new ApiError(403, { code: 'remote-disabled', message: 'Este servidor no envía nada a proveedores remotos' }); }) });
    render(Importar, { props: { api: forbidden, onsession: vi.fn() } });
    await pickFile();
    await fireEvent.click(screen.getByRole('button', { name: 'Importar como borrador' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refinar con el co-piloto' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Refinar con el co-piloto' }));
    await waitFor(() => expect(screen.getByText('Este servidor no admite proveedores remotos')).toBeTruthy());

    const config: LlmConfigResponse = {
      llm: { config: undefined, configError: undefined, health: undefined, keys: { openai: 'env', anthropic: 'none', groq: 'none', gemini: 'none' }, keysFile: '', allowedHosts: [], remote: undefined, usable: true, settings: { path: undefined, present: false, configured: false, error: undefined, values: undefined }, providers: [{ id: 'openai', plan: 'paid', availability: 'available', availabilityNote: undefined, dataNote: undefined, host: 'api.openai.com', baseUrl: 'https://api.openai.com', defaultModel: 'gpt-4o-mini', models: [], keyPresence: 'env', quota: undefined, rateLimitsUrl: 'https://x', c7: { sourceUrl: 'https://x', verifiedAt: '2026-08-30', quote: 'q' }, live: undefined }] },
      file: { path: '/work/cv.toml', present: false, sha256: undefined },
      remote: { allowed: true, configured: undefined, pending: false },
    } as unknown as LlmConfigResponse;
    const startJob = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, { code: 'consent-required', message: 'confirma', estimateId: 'e1', warning: 'Aviso de coste: 1 petición', estimate: { requests: 1 }, dataNote: 'el plan gratuito usa tus peticiones' }))
      .mockResolvedValueOnce({ job: JOB, sending: { destination: 'openai', items: 1, words: 2, redactCompanies: false }, warnings: [] });
    const remote = fakeApi({ llmConfig: vi.fn(async () => config), startJob });
    render(Importar, { props: { api: remote, onsession: vi.fn() } });
    const inputs = screen.getAllByLabelText(/Fichero/);
    await fireEvent.change(inputs[inputs.length - 1]!, { target: { files: [new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' })] } });
    const importButtons = screen.getAllByRole('button', { name: 'Importar como borrador' });
    await fireEvent.click(importButtons[importButtons.length - 1]!);
    const refineButtons = await waitFor(() => screen.getAllByRole('button', { name: 'Refinar con el co-piloto' }));
    const selects = screen.getAllByLabelText('Proveedor');
    await fireEvent.focus(selects[selects.length - 1]!);
    await waitFor(() => expect(remote.llmConfig).toHaveBeenCalled());
    await fireEvent.change(selects[selects.length - 1]!, { target: { value: 'openai' } });
    await fireEvent.click(refineButtons[refineButtons.length - 1]!);
    await waitFor(() => expect(screen.getByText(/Aviso de coste: 1 petición/)).toBeTruthy());
    expect(screen.getByText(/el plan gratuito usa tus peticiones/)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));
    await waitFor(() => expect(startJob).toHaveBeenLastCalledWith({ kind: 'import-map', body: { name: 'ada-ejemplo', provider: 'openai', consent: { estimateId: 'e1' } } }));
  });
});
