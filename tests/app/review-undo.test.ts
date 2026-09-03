import { describe, expect, it } from 'vitest';

import { applyReview, listReviews, readSourceHistory, undoReviewApply } from '../../src/app';
import { fingerprint, formatReview, type ReviewHeader, type ReviewItem } from '../../src/llm';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const NOW = new Date('2026-08-29T10:00:00.000Z');
const HEADER: ReviewHeader = { task: 'improve', generatedAt: NOW.toISOString(), dataDir: 'data/sources', provider: { id: 'ollama', baseUrl: 'u', model: 'm' }, promptVersion: 'improve.v1', temperature: 0, seed: 7 };
const OK = { accepted: true, violations: [] } as const;
const SOURCE = ['---', 'company: ACME', 'role: Dev', 'start: 2020-01', '---', '', '## Logros', '', '- Original uno', '- Original dos', ''].join('\n');
const NAME = 'revision-improve-2026-08-29.md';
const ARCHIVED = '/work/output/revisiones-archivadas';

const item = (id: string, original: string, text: string, line: number): ReviewItem => ({
  id,
  location: 'Dev · ACME',
  original,
  source: { file: 'experience/acme.md', line, hash: fingerprint(original) },
  proposals: [{ text, rationale: 'r', verdict: OK }],
  fromCache: false,
  elapsedMs: 1,
  usage: {},
});

/** Una revisión con las dos propuestas marcadas, ya aplicada a la fuente: el punto de partida de deshacer. */
async function applied(): Promise<{ readonly fs: MemoryFileSystem; readonly context: ReturnType<typeof appContext> }> {
  const review = formatReview(HEADER, [item('ach-1', 'Original uno', 'Propuesta uno', 9), item('ach-2', 'Original dos', 'Propuesta dos', 10)])
    .replaceAll('- [ ] Propuesta 1:', '- [x] Propuesta 1:');
  const fs = new MemoryFileSystem({ [`/work/output/${NAME}`]: review, '/work/data/sources/experience/acme.md': SOURCE });
  const context = appContext(fs, { now: () => NOW });
  const result = await applyReview(context, { review: `output/${NAME}`, dryRun: false, deleteReview: false });
  expect(result.ok && result.outcome.changes).toBe(2);
  return { fs, context };
}

describe('undoReviewApply: restaurar los cambios aplicados (T-9.24)', () => {
  it('devuelve la fuente a como estaba, guarda lo que había y saca la revisión del archivo', async () => {
    const { fs, context } = await applied();
    // Aplicarla no dejó nada pendiente: se archivó sola.
    expect(fs.file(`${ARCHIVED}/${NAME}`)).toBeDefined();
    expect(fs.file('/work/data/sources/experience/acme.md')?.content).toContain('- Propuesta uno');

    const undone = await undoReviewApply(context, { directory: 'output', name: NAME, at: new Date('2026-08-30T10:00:00.000Z') });
    expect(undone.ok && undone.outcome.restored).toEqual(['experience/acme.md']);
    expect(fs.file('/work/data/sources/experience/acme.md')?.content).toBe(SOURCE);
    // La revisión vuelve a la vista: sus cambios ya no están, así que vuelve a estar pendiente.
    expect(undone.ok && undone.outcome.unarchived).toBe(`/work/output/${NAME}`);
    const listado = await listReviews(context, 'output');
    expect(listado.reviews.map((entry) => entry.name)).toEqual([NAME]);
    expect(listado.reviews[0]?.progress).toEqual({ applied: 0, pending: 2, changed: 0, unknown: 0 });
    // Y lo deshecho también se guarda: la entrada nueva es de tipo restore.
    expect(undone.ok && undone.outcome.entry?.action).toBe('restore');
    expect((await readSourceHistory(context)).map((entry) => entry.action)).toEqual(['restore', 'apply']);
  });

  it('deshacer dos veces no cambia nada y lo dice, sin ensuciar el histórico', async () => {
    const { fs, context } = await applied();
    await undoReviewApply(context, { directory: 'output', name: NAME, at: new Date('2026-08-30T10:00:00.000Z') });
    const entradas = (await readSourceHistory(context)).length;
    const otra = await undoReviewApply(context, { directory: 'output', name: NAME, at: new Date('2026-08-31T10:00:00.000Z') });
    expect(otra.ok && { restored: otra.outcome.restored, entry: otra.outcome.entry, unarchived: otra.outcome.unarchived }).toEqual({ restored: [], entry: undefined, unarchived: undefined });
    expect(await readSourceHistory(context)).toHaveLength(entradas);
    expect(fs.file('/work/data/sources/experience/acme.md')?.content).toBe(SOURCE);
  });

  it('sin ninguna aplicación de esa revisión en el histórico no hay nada que deshacer, y el nombre se comprueba', async () => {
    const context = appContext(new MemoryFileSystem({}), { now: () => NOW });
    expect(await undoReviewApply(context, { directory: 'output', name: '../fuera.md' })).toMatchObject({ ok: false, error: { code: 'unsafe-path' } });
    expect(await undoReviewApply(context, { directory: 'output', name: NAME })).toMatchObject({ ok: false, error: { code: 'invalid-data', message: expect.stringContaining('no hay nada que deshacer') as string } });
  });

  it('una revisión que se eliminó tras aplicarla se sigue pudiendo deshacer: lo que importa son las fuentes', async () => {
    const { fs, context } = await applied();
    await fs.remove(`${ARCHIVED}/${NAME}`);
    const undone = await undoReviewApply(context, { directory: 'output', name: NAME, at: new Date('2026-08-30T10:00:00.000Z') });
    expect(undone.ok && undone.outcome.unarchived).toBeUndefined();
    expect(fs.file('/work/data/sources/experience/acme.md')?.content).toBe(SOURCE);
  });

  it('un fallo al restaurar se devuelve como error, sin tocar la fuente', async () => {
    const { fs, context } = await applied();
    fs.failures.add('mkdir');
    expect(await undoReviewApply(context, { directory: 'output', name: NAME })).toMatchObject({ ok: false, error: { code: 'environment' } });
    expect(fs.file('/work/data/sources/experience/acme.md')?.content).toContain('- Propuesta uno');
  });
});
