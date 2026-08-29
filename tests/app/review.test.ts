import { describe, expect, it } from 'vitest';

import { contentHash, listReviews, readReview } from '../../src/app';
import { formatReview, type ReviewHeader, type ReviewItem } from '../../src/llm';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const HEADER: ReviewHeader = { task: 'improve', generatedAt: '2026-08-29T10:00:00.000Z', dataDir: 'data/sources', provider: { id: 'ollama', baseUrl: 'u', model: 'm' }, promptVersion: 'improve.v1', temperature: 0, seed: 7 };
const OK = { accepted: true, violations: [] } as const;
const item = (id: string, original: string, text: string): ReviewItem => ({ id, location: 'x', original, source: { file: 'experience/acme.md', line: 3, hash: 'abc' }, proposals: [{ text, rationale: 'r', verdict: OK }], fromCache: false, elapsedMs: 1, usage: {} });
const REVIEW = formatReview(HEADER, [item('ach-1', 'Original uno', 'Propuesta uno'), item('ach-2', 'Original dos', 'Propuesta dos')]).replace('- [ ] Propuesta 1:', '- [x] Propuesta 1:');
const NAME = 'revision-improve-2026-08-29.md';

describe('listReviews', () => {
  it('sin directorio de salida devuelve una lista vacía', async () => {
    expect(await listReviews(appContext(new MemoryFileSystem({})), 'output')).toEqual([]);
  });

  it('lista solo revision-*.md con huella, tarea, ítems y marcadas, y anota las que no se pueden interpretar', async () => {
    const context = appContext(new MemoryFileSystem({ [`/work/output/${NAME}`]: REVIEW, '/work/output/revision-rota.md': 'sin cabecera', '/work/output/cv.md': 'x', '/work/output/notas.txt': 'y' }));
    const reviews = await listReviews(context, 'output');
    expect(reviews.map((review) => review.name)).toEqual([NAME, 'revision-rota.md']);
    expect(reviews[0]).toEqual({ name: NAME, path: `/work/output/${NAME}`, sha256: contentHash(REVIEW), task: 'improve', items: 2, marked: 1, error: undefined });
    expect(reviews[1]).toMatchObject({ name: 'revision-rota.md', task: undefined, items: 0, marked: 0 });
    expect(reviews[1]?.error).toEqual(expect.any(String));
  });

  it('propaga los errores del disco que no sean «no existe»', async () => {
    const context = appContext(new MemoryFileSystem({ '/work/output': 'un fichero, no un directorio' }));
    await expect(listReviews(context, 'output')).rejects.toThrow();
  });
});

describe('readReview', () => {
  it('solo admite nombres revision-<…>.md, sin rutas', async () => {
    const result = await readReview(appContext(new MemoryFileSystem({})), 'output', '../revision-x.md');
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-data', exitCode: 1 } });
  });

  it('distingue la revisión inexistente del fallo de lectura', async () => {
    const context = appContext(new MemoryFileSystem({ '/work/output/revision-dir.md/x': 'y' }));
    expect(await readReview(context, 'output', 'revision-no.md')).toMatchObject({ ok: false, error: { code: 'not-found', message: 'No existe la revisión «revision-no.md»' } });
    expect(await readReview(context, 'output', 'revision-dir.md')).toMatchObject({ ok: false, error: { code: 'environment', exitCode: 2 } });
  });

  it('una revisión que no se puede interpretar se devuelve con su texto y el motivo, sin estructura', async () => {
    const context = appContext(new MemoryFileSystem({ '/work/output/revision-rota.md': 'sin cabecera' }));
    const result = await readReview(context, 'output', 'revision-rota.md');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file).toMatchObject({ text: 'sin cabecera', task: undefined, review: undefined, error: expect.any(String) });
    }
  });

  it('devuelve el texto, la huella y la estructura interpretada', async () => {
    const context = appContext(new MemoryFileSystem({ [`/work/output/${NAME}`]: REVIEW }));
    const result = await readReview(context, 'output', NAME);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file).toMatchObject({ name: NAME, text: REVIEW, sha256: contentHash(REVIEW), task: 'improve', items: 2, marked: 1 });
      expect(result.file.review?.items.map((entry) => entry.id)).toEqual(['ach-1', 'ach-2']);
    }
  });
});
