/** Refinado de un borrador con el co-piloto (T-8.18): plan desde el informe, verificación y actualización. */
import { describe, expect, it } from 'vitest';

import { executeImportMap, importMapEstimate, planImportMap } from '../../src/app/import-map';
import type { LlmProvider } from '../../src/llm/provider';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const REPORT = [
  '# Informe del borrador importado',
  '',
  '- Origen: cv.pdf',
  '',
  '## Sin situar (revísalo a mano)',
  '',
  '- línea 31: C A M P U S I N V O L V M E N T',
  '- línea 32: Finance Chair, Green Club | sept 2018',
  '',
].join('\n');

function provider(json: unknown): LlmProvider {
  return {
    id: 'ollama',
    kind: 'local',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen3:8b',
    complete: () => Promise.resolve({ ok: true as const, json, raw: JSON.stringify(json), model: 'qwen3:8b', usage: {}, elapsedMs: 3 }),
    health: () => Promise.resolve({ ok: true as const, version: undefined, models: ['qwen3:8b'], modelAvailable: true }),
  };
}

describe('planImportMap', () => {
  it('lee las líneas sin situar del informe del borrador', async () => {
    const fs = new MemoryFileSystem({ '/work/import/mio/README.md': REPORT });
    const planned = await planImportMap(appContext(fs), { name: 'mio' });
    expect(planned.ok && planned.plan).toMatchObject({ name: 'mio', report: '/work/import/mio/README.md', skipped: 0 });
    expect(planned.ok && planned.plan.lines.map((line) => line.n)).toEqual([31, 32]);
  });

  it('explica el nombre inválido, el borrador inexistente y el que no tiene nada que refinar', async () => {
    const fs = new MemoryFileSystem({ '/work/import/vacio/README.md': '# Informe\n\n- Origen: cv.pdf\n' });
    const context = appContext(fs);
    expect(await planImportMap(context, { name: '///' })).toMatchObject({ ok: false, error: { code: 'invalid-data' } });
    expect(await planImportMap(context, { name: 'nada' })).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(await planImportMap(context, { name: 'vacio' })).toMatchObject({ ok: false, error: { code: 'invalid-data', message: expect.stringContaining('no tiene líneas sin situar') as string } });
  });

  it('la estimación cuenta una sola petición con el lote entero', async () => {
    const fs = new MemoryFileSystem({ '/work/import/mio/README.md': REPORT });
    const context = appContext(fs);
    const planned = await planImportMap(context, { name: 'mio' });
    expect(planned.ok).toBe(true);
    const estimate = await importMapEstimate(context, planned.ok ? planned.plan : (undefined as never), 4000);
    expect(estimate).toMatchObject({ requests: 1, maxOutputTokens: 4000 });
  });
});

describe('executeImportMap', () => {
  it('verifica las propuestas y las deja en el informe, sin tocar el resto del borrador', async () => {
    const fs = new MemoryFileSystem({ '/work/import/mio/README.md': REPORT });
    const context = appContext(fs);
    const planned = await planImportMap(context, { name: 'mio' });
    const plan = planned.ok ? planned.plan : (undefined as never);
    const lines: string[] = [];
    const result = await executeImportMap(context, plan, {
      provider: provider({ proposals: [{ n: 31, section: 'descartar', reason: 'cabecera' }, { n: 99, section: 'experiencia', reason: 'no se envió' }] }),
      cache: false,
      progress: (line) => lines.push(line),
    });
    expect(result).toMatchObject({ ok: true, outcome: { name: 'mio', rejected: 1, skipped: 0 } });
    expect(lines).toEqual(['Enviando 2 línea(s) sin situar a ollama (qwen3:8b)', '1 propuesta(s) verificadas, 1 rechazada(s) por el código']);
    const written = fs.file('/work/import/mio/README.md');
    expect(written?.mode).toBe(0o600);
    expect(written?.content).toContain('## Propuestas del co-piloto (no aplicadas)');
    expect(written?.content).toContain('- línea 31 → **descartar**: C A M P U S I N V O L V M E N T _(cabecera)_');
    // La sección de «sin situar» se conserva tal cual: el refinado no borra nada.
    expect(written?.content).toContain('- línea 32: Finance Chair, Green Club | sept 2018');
  });

  it('un refinado repetido sustituye la sección en vez de acumularla', async () => {
    const fs = new MemoryFileSystem({ '/work/import/mio/README.md': REPORT });
    const context = appContext(fs);
    const planned = await planImportMap(context, { name: 'mio' });
    const plan = planned.ok ? planned.plan : (undefined as never);
    const options = { provider: provider({ proposals: [{ n: 31, section: 'descartar', reason: '' }] }), cache: false };
    expect((await executeImportMap(context, plan, options)).ok).toBe(true);
    const second = await executeImportMap(context, plan, options);
    expect(second.ok).toBe(true);
    const content = fs.file('/work/import/mio/README.md')?.content ?? '';
    expect(content.match(/## Propuestas del co-piloto/g)).toHaveLength(1);
    expect(content).toContain('- línea 31 → **descartar**: C A M P U S I N V O L V M E N T\n');
  });

  it('un informe ilegible o un fichero que no se puede escribir se explican como error de entorno', async () => {
    const fs = new MemoryFileSystem({ '/work/import/mio/README.md': REPORT });
    const context = appContext(fs);
    const planned = await planImportMap(context, { name: 'mio' });
    const plan = planned.ok ? planned.plan : (undefined as never);
    const options = { provider: provider({ proposals: [{ n: 31, section: 'descartar', reason: '' }] }), cache: false };

    // El informe desaparece entre el plan y la escritura (otro proceso lo borró).
    await fs.remove('/work/import/mio/README.md');
    expect(await executeImportMap(context, plan, options)).toMatchObject({ ok: false, error: { code: 'environment', message: expect.stringContaining('No se pudo releer') as string } });

    await fs.writeFile('/work/import/mio/README.md', REPORT, 0o600);
    const readOnly = appContext(fs, { artifactFileSystem: Object.assign(Object.create(fs) as typeof fs, { writeFile: () => Promise.reject(new Error('EROFS: solo lectura')) }) });
    expect(await executeImportMap(readOnly, plan, options)).toMatchObject({ ok: false, error: { code: 'environment', message: expect.stringContaining('No se pudo actualizar') as string } });
  });

  it('propaga el fallo del proveedor y el de escritura con su clase de error', async () => {
    const fs = new MemoryFileSystem({ '/work/import/mio/README.md': REPORT });
    const context = appContext(fs);
    const planned = await planImportMap(context, { name: 'mio' });
    const plan = planned.ok ? planned.plan : (undefined as never);
    const broken: LlmProvider = { ...provider({}), complete: () => Promise.resolve({ ok: false as const, code: 'timeout' as const, message: 'tardó' }) };
    expect(await executeImportMap(context, plan, { provider: broken, cache: false })).toMatchObject({ ok: false, error: { code: 'environment' } });
    const invalid: LlmProvider = { ...provider({ proposals: 'no' }) };
    expect(await executeImportMap(context, plan, { provider: invalid, cache: false })).toMatchObject({ ok: false, error: { code: 'invalid-data' } });
  });
});
