/**
 * `cv linkedin` (T-9.27): el plan agrupado por acción, el aviso de que sin borrador solo se puede decir qué
 * tienes tú, y el JSON para quien lo quiera tratar.
 */
import { describe, expect, it } from 'vitest';

import { EXIT_OK, runCli, type CliContext } from '../../src/cli';
import { MemoryLlmCache, llmStatus } from '../../src/llm';
import { defaultSourceParsers } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import { defaultAssets } from '../../src/shared/assets';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const SOURCES = '/work/data/sources';
const PROFILE = ['---', 'schemaVersion: 1', 'locale: es-ES', 'fullName: Ada Ejemplo', 'headline: Arquitecta de software', 'links: []', '---', '', 'Resumen de Ada.', ''].join('\n');
const ACME = ['---', 'company: ACME Corp', 'role: Arquitecta', 'start: 2023-01', 'tags: [php]', '---', '', '## Logros', '', '- Hice algo medible #php', ''].join('\n');

function harness(extra: Record<string, string> = {}): { readonly context: CliContext; readonly stdout: () => string; readonly stderr: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  const fs = new MemoryFileSystem({ [`${SOURCES}/profile.md`]: PROFILE, [`${SOURCES}/experience/acme.md`]: ACME, ...extra });
  const context: CliContext = {
    cwd: '/work',
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
    stdin: () => Promise.resolve(''),
    datasetFileSystem: fs,
    artifactFileSystem: fs,
    parsers: defaultSourceParsers(),
    pdfExtractor: (bytes) => extractPdfText(bytes),
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

describe('cv linkedin (T-9.27)', () => {
  it('agrupa por acción, deja el cuerpo listo para copiar y avisa de que sin borrador solo dice qué tienes tú', async () => {
    const h = harness();
    expect(await runCli(['linkedin'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('Añadir en LinkedIn');
    expect(h.stdout()).toContain('Arquitecta · ACME Corp');
    // El cuerpo va sangrado bajo su apunte: se ve qué se copia y qué es la instrucción.
    expect(h.stdout()).toContain('      • Hice algo medible');
    expect(h.stderr()).toContain('Sin un borrador de LinkedIn con el que comparar');
  });

  it('con borrador dice además qué corregir, y no repite el aviso', async () => {
    const h = harness({
      '/work/import/linkedin/profile.md': PROFILE.replace('headline: Arquitecta de software', 'headline: Developer'),
      '/work/import/linkedin/experience/acme.md': ACME.replace('role: Arquitecta', 'role: Developer'),
    });
    expect(await runCli(['linkedin', '--draft', 'linkedin'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('Corregir en LinkedIn');
    expect(h.stdout()).toContain('«Developer · ACME Corp» → «Arquitecta · ACME Corp»');
    expect(h.stderr()).not.toContain('Sin un borrador');
  });

  it('--json saca el plan tal cual, sin el texto agrupado', async () => {
    const h = harness();
    expect(await runCli(['linkedin', '--json'], h.context)).toBe(EXIT_OK);
    const plan = JSON.parse(h.stdout()) as { counts: { add: number }; items: unknown[] };
    expect(plan.counts.add).toBeGreaterThan(0);
    expect(plan.items.length).toBeGreaterThan(0);
    expect(h.stdout()).not.toContain('Añadir en LinkedIn');
  });

  it('unas fuentes que no cargan se dicen, y no se inventa un plan', async () => {
    const h = harness();
    expect(await runCli(['linkedin', '-d', 'no-esta'], h.context)).not.toBe(EXIT_OK);
    expect(h.stdout()).toBe('');
  });
});
