/**
 * `cv vida-laboral` (T-9.28): los apuntes agrupados, el resumen de lo leído y el recordatorio de que no se ha
 * cambiado nada. El PDF se lee del disco a través del extractor del contexto.
 */
import { describe, expect, it, vi } from 'vitest';

import { EXIT_OK, runCli, type CliContext } from '../../src/cli';
import { MemoryLlmCache, llmStatus } from '../../src/llm';
import { defaultSourceParsers } from '../../src/parsers';
import { defaultAssets } from '../../src/shared/assets';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const NL = '\n';
const SOURCES = '/work/data/sources';
const PROFILE = ['---', 'schemaVersion: 1', 'locale: es-ES', 'fullName: Ada Ejemplo', 'links: []', '---', ''].join(NL);
const PICAS = ['---', 'company: Picas Rojas', 'role: Dev', 'start: 2013-01', 'end: 2016-09', '---', ''].join(NL);
const INFORME = ['GENERAL 27104248036 PICAS ROJAS, S.L.N.E. 08.01.2015 08.01.2015 31.10.2016 189 --- 07 601'].join(NL);

function harness(text = INFORME, extra: Record<string, string> = {}): { readonly context: CliContext; readonly stdout: () => string; readonly stderr: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  const fs = new MemoryFileSystem({ [`${SOURCES}/profile.md`]: PROFILE, [`${SOURCES}/experience/picas.md`]: PICAS, '/work/informe.pdf': 'PDF falso', ...extra });
  const context: CliContext = {
    cwd: '/work',
    stdout: (chunk) => {
      out.push(chunk);
    },
    stderr: (chunk) => {
      err.push(chunk);
    },
    stdin: () => Promise.resolve(''),
    datasetFileSystem: fs,
    artifactFileSystem: fs,
    parsers: defaultSourceParsers(),
    // El extractor se inyecta: aquí no hace falta un PDF de verdad para probar la comparación.
    pdfExtractor: vi.fn(() => Promise.resolve({ ok: true as const, text, pages: 1 })),
    typstRenderer: () => Promise.reject(new Error('no usado')),
    typstInstall: () => Promise.reject(new Error('no usado')),
    typstStatus: () => Promise.reject(new Error('no usado')),
    llmStatus: (options) => llmStatus(options),
    llmProvider: () => Promise.resolve({ ok: false as const, message: 'sin proveedor en las pruebas' }),
    llmCache: new MemoryLlmCache(),
    assets: defaultAssets(),
  };
  return { context, stdout: () => out.join(''), stderr: () => err.join('') };
}

describe('cv vida-laboral (T-9.28)', () => {
  it('agrupa los apuntes, dice a qué ficheros afectan y recuerda que no ha cambiado nada', async () => {
    const h = harness();
    expect(await runCli(['vida-laboral', 'informe.pdf'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('Fechas de inicio que no cuadran (1)');
    expect(h.stdout()).toContain('Picas Rojas empieza en 2013-01 y el informe dice 2015-01-08');
    expect(h.stdout()).toContain('      exp-picas');
    expect(h.stderr()).toContain('1 alta de empleo leída · 1 empresa');
    expect(h.stderr()).toContain('No se ha cambiado nada');
  });

  it('un apunte sin detalle ni ficheros se imprime igual, en una línea', async () => {
    // Una empresa del informe que no está en las fuentes y no es autónomo: sin detalle que añadir.
    const h = harness('GENERAL 27107937571 BAHIA SOFTWARE, S.L.U. 02.11.2021 02.11.2021 22.04.2022 100 --- 02 172', { '/work/data/sources/experience/picas.md': PICAS });
    expect(await runCli(['vida-laboral', 'informe.pdf'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('En el informe y no en tus fuentes (1)');
    expect(h.stdout()).toContain('En tus fuentes y no en el informe (1)');
  });

  it('--json saca los apuntes tal cual', async () => {
    const h = harness();
    expect(await runCli(['vida-laboral', 'informe.pdf', '--json'], h.context)).toBe(EXIT_OK);
    const parsed = JSON.parse(h.stdout()) as { spells: number; employers: number; items: unknown[] };
    expect(parsed).toMatchObject({ spells: 1, employers: 1 });
    expect(parsed.items.length).toBeGreaterThan(0);
    expect(h.stdout()).not.toContain('Fechas de inicio');
  });

  it('un PDF que no se puede leer, uno que no es un informe y unas fuentes rotas se dicen', async () => {
    const sinFichero = harness();
    expect(await runCli(['vida-laboral', 'no-esta.pdf'], sinFichero.context)).not.toBe(EXIT_OK);
    expect(sinFichero.stderr()).toContain('No se pudo leer el informe');

    const otro = harness('un currículum cualquiera');
    expect(await runCli(['vida-laboral', 'informe.pdf'], otro.context)).not.toBe(EXIT_OK);
    expect(otro.stderr()).toContain('no parece un informe de vida laboral');
  });

  it('si el extractor de PDF falla, se dice con su motivo', async () => {
    const h = harness();
    const roto: CliContext = { ...h.context, pdfExtractor: () => Promise.resolve({ ok: false as const, code: 'invalid' as const, message: 'el PDF no se pudo leer' }) };
    expect(await runCli(['vida-laboral', 'informe.pdf'], roto)).not.toBe(EXIT_OK);
  });
});
