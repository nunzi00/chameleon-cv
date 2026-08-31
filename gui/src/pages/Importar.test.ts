/**
 * Pantalla «Importar CV» (T-8.4b): subir un PDF/DOCX como borrador — resumen con cuentas, README como
 * informe, conflicto 409 con «Sustituir», y los errores explicados sin tocar nada.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import { ApiError, type ApiClient } from '../lib/api/client';
import type { ImportCvResponse } from '../lib/api/types';
import Importar from './Importar.svelte';

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
    status: vi.fn(), validate: vi.fn(), build: vi.fn(), profile: vi.fn(), sources: vi.fn(), source: vi.fn(), writeSource: vi.fn(), generate: vi.fn(), analyze: vi.fn(), extractOffer: vi.fn(), themes: vi.fn(), createTheme: vi.fn(), installTheme: vi.fn(), verifyTheme: vi.fn(), exportProfile: vi.fn(), importProfile: vi.fn(), llmConfig: vi.fn(), writeLlmConfig: vi.fn(), checkLlm: vi.fn(), offerHistory: vi.fn(), shutdown: vi.fn(), llmRuntime: vi.fn(), llmModels: vi.fn(), llmRuntimeAction: vi.fn(), sourceHistory: vi.fn(), sourceVersion: vi.fn(), restoreSourceVersion: vi.fn(), writeServeConfig: vi.fn(), reviews: vi.fn(), review: vi.fn(), writeReview: vi.fn(), deleteReview: vi.fn(), applyReview: vi.fn(), jobs: vi.fn(), job: vi.fn(), startJob: vi.fn(), cancelJob: vi.fn(), jobEvents: vi.fn(), outputs: vi.fn(), output: vi.fn(),
    offers: vi.fn(), offerFetch: vi.fn(), offerSave: vi.fn(),
    importCv: vi.fn(async () => RESULT),
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
});
