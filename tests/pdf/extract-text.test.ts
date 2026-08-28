import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_PDF_LIMITS, createWorkerRunner, extractPdfText, workerScriptPath, type ExtractionRunner, type PdfLimits } from '../../src/pdf';
import { makePdf } from '../helpers/pdf';

const limits = (overrides: Partial<PdfLimits>): PdfLimits => ({ ...DEFAULT_PDF_LIMITS, ...overrides });

describe('extractPdfText (worker real)', () => {
  it('extrae el texto línea a línea de un PDF de una página', async () => {
    const pdf = await makePdf([['Senior Backend Engineer (PHP/Symfony)', '', 'Requisitos:', '- 5+ años de experiencia con PHP y Symfony.']]);
    const result = await extractPdfText(pdf);
    expect(result).toEqual({
      ok: true,
      pages: 1,
      text: 'Senior Backend Engineer (PHP/Symfony)\nRequisitos:\n- 5+ años de experiencia con PHP y Symfony.',
    });
  });

  it('une varias páginas con una línea en blanco y es determinista', async () => {
    const pdf = await makePdf([['Página uno'], ['Página dos']]);
    const first = await extractPdfText(pdf);
    const second = await extractPdfText(pdf);
    expect(first).toEqual({ ok: true, pages: 2, text: 'Página uno\n\nPágina dos' });
    expect(second).toEqual(first);
  });

  it('respeta el límite de páginas y el de bytes de texto', async () => {
    const pdf = await makePdf([['Uno'], ['Dos']]);
    expect(await extractPdfText(pdf, limits({ maxPages: 1 }))).toEqual({ ok: false, code: 'too-many-pages', message: 'El PDF tiene 2 páginas (máximo 1)' });
    expect(await extractPdfText(pdf, limits({ maxTextBytes: 3 }))).toEqual({
      ok: false,
      code: 'too-large',
      message: expect.stringMatching(/^El texto extraído ocupa \d+ bytes \(máximo 3\)$/),
    });
  });

  it('rechaza un fichero que no es PDF con un error controlado', async () => {
    const result = await extractPdfText(Buffer.from('no soy un pdf', 'utf8'));
    expect(result).toEqual({ ok: false, code: 'invalid', message: 'Invalid PDF structure.' });
  });

  it('rechaza un PDF demasiado grande sin arrancar el worker', async () => {
    let started = false;
    const runner: ExtractionRunner = () => {
      started = true;
      return { reply: Promise.resolve({ ok: true, text: '', pages: 0 }), terminate: () => Promise.resolve() };
    };
    expect(await extractPdfText(new Uint8Array(11), limits({ maxBytes: 10 }), runner)).toEqual({
      ok: false,
      code: 'too-large',
      message: 'El PDF ocupa 11 bytes (máximo 10)',
    });
    expect(started).toBe(false);
  });

  it('el script del worker existe (fuente en desarrollo, compilado en dist)', async () => {
    expect(workerScriptPath()).toMatch(/worker\.m(ts|js)$/);
    const directory = await mkdtemp(join(tmpdir(), 'chameleon-worker-'));
    try {
      expect(workerScriptPath(directory)).toBe(join(directory, 'worker.mts'));
      await writeFile(join(directory, 'worker.mjs'), '', 'utf8');
      expect(workerScriptPath(directory)).toBe(join(directory, 'worker.mjs'));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('extractPdfText (runners simulados y workers que fallan)', () => {
  let temporary = '';

  beforeAll(async () => {
    temporary = await mkdtemp(join(tmpdir(), 'chameleon-pdf-'));
    await writeFile(join(temporary, 'throwing.js'), "throw new Error('boom en el worker');", 'utf8');
    await writeFile(join(temporary, 'exiting.js'), 'process.exit(3);', 'utf8');
  });

  afterAll(async () => {
    await rm(temporary, { recursive: true, force: true });
  });

  it('agota el tiempo y termina el worker si no responde', async () => {
    let terminated = false;
    const runner: ExtractionRunner = () => ({
      reply: new Promise(() => undefined),
      terminate: () => {
        terminated = true;
        return Promise.resolve();
      },
    });
    expect(await extractPdfText(new Uint8Array(1), limits({ timeoutMs: 10 }), runner)).toEqual({
      ok: false,
      code: 'timeout',
      message: 'La extracción superó los 10 ms permitidos',
    });
    expect(terminated).toBe(true);
  });

  it('traduce un worker que lanza y otro que termina con código distinto de cero', async () => {
    const throwing = await extractPdfText(new Uint8Array(1), DEFAULT_PDF_LIMITS, createWorkerRunner(join(temporary, 'throwing.js')));
    expect(throwing).toEqual({ ok: false, code: 'failed', message: 'boom en el worker' });
    const exiting = await extractPdfText(new Uint8Array(1), DEFAULT_PDF_LIMITS, createWorkerRunner(join(temporary, 'exiting.js')));
    expect(exiting).toEqual({ ok: false, code: 'failed', message: 'el worker de extracción terminó con código 3' });
  });
});
