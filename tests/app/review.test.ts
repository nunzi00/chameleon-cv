import { describe, expect, it } from 'vitest';

import { contentHash, listReviews, locateReview, readReview, removeReview, reviewDirectoryOf, setReviewArchived } from '../../src/app';
import { fingerprint, formatReview, type ReviewHeader, type ReviewItem } from '../../src/llm';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const HEADER: ReviewHeader = { task: 'improve', generatedAt: '2026-08-29T10:00:00.000Z', dataDir: 'data/sources', provider: { id: 'ollama', baseUrl: 'u', model: 'm' }, promptVersion: 'improve.v1', temperature: 0, seed: 7 };
const OK = { accepted: true, violations: [] } as const;
const item = (id: string, original: string, text: string): ReviewItem => ({ id, location: 'x', original, source: { file: 'experience/acme.md', line: 3, hash: 'abc' }, proposals: [{ text, rationale: 'r', verdict: OK }], fromCache: false, elapsedMs: 1, usage: {} });
const REVIEW = formatReview(HEADER, [item('ach-1', 'Original uno', 'Propuesta uno'), item('ach-2', 'Original dos', 'Propuesta dos')]).replace('- [ ] Propuesta 1:', '- [x] Propuesta 1:');
const NAME = 'revision-improve-2026-08-29.md';

describe('listReviews', () => {
  it('sin directorio de salida devuelve una lista vacía', async () => {
    expect(await listReviews(appContext(new MemoryFileSystem({})), 'output')).toEqual({ reviews: [], archived: [] });
  });

  it('lista solo revision-*.md con huella, tarea, ítems y marcadas, y anota las que no se pueden interpretar', async () => {
    const context = appContext(new MemoryFileSystem({ [`/work/output/${NAME}`]: REVIEW, '/work/output/revision-rota.md': 'sin cabecera', '/work/output/cv.md': 'x', '/work/output/notas.txt': 'y' }));
    const { reviews } = await listReviews(context, 'output');
    expect(reviews.map((review) => review.name)).toEqual([NAME, 'revision-rota.md']);
    // Sin las fuentes delante no se puede saber si algo se aplicó ya: se dice «unknown», no se supone.
    expect(reviews[0]).toEqual({ name: NAME, path: `/work/output/${NAME}`, sha256: contentHash(REVIEW), task: 'improve', items: 2, marked: 1, error: undefined, progress: { applied: 0, pending: 0, changed: 0, unknown: 2 }, archived: false });
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
    expect(result).toMatchObject({ ok: false, error: { code: 'unsafe-path' } });
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

describe('reviewStatus: qué queda por aplicar de una revisión (encargo del PO del 1-sep)', () => {
  const SOURCE = ['---', 'company: ACME', 'role: Dev', 'start: 2020-01', '---', '', '## Logros', '', '- Original uno', '- Original dos', ''].join('\n');

  it('distingue lo aplicado de lo pendiente mirando la fuente, no una marca en el fichero', async () => {
    // «ach-1» ya tiene su propuesta escrita; «ach-2» sigue con su original.
    const aplicado = SOURCE.replace('- Original uno', '- Propuesta uno');
    const context = appContext(new MemoryFileSystem({ [`/work/output/${NAME}`]: REVIEW, '/work/data/sources/experience/acme.md': aplicado }));
    const result = await readReview(context, 'output', NAME);
    expect(result.ok && result.file.statuses).toEqual([
      { id: 'ach-1', state: 'applied' },
      { id: 'ach-2', state: 'pending' },
    ]);
    expect(result.ok && result.file.progress).toEqual({ applied: 1, pending: 1, changed: 0, unknown: 0 });
    // Y en la lista, lo mismo resumido: es lo que cabe al lado del nombre.
    expect((await listReviews(context, 'output')).reviews[0]?.progress).toEqual({ applied: 1, pending: 1, changed: 0, unknown: 0 });
  });

  it('al listar, la misma fuente se lee UNA vez para todas las revisiones', async () => {
    const otra = 'revision-improve-2026-08-30.md';
    const fs = new MemoryFileSystem({ [`/work/output/${NAME}`]: REVIEW, [`/work/output/${otra}`]: REVIEW, '/work/data/sources/experience/acme.md': SOURCE });
    let lecturas = 0;
    const contando = new Proxy(fs, {
      get: (target, key) =>
        key === 'readTextFile'
          ? (path: string) => {
              lecturas += path.endsWith('experience/acme.md') ? 1 : 0;
              return target.readTextFile(path);
            }
          : Reflect.get(target, key, target),
    });
    const { reviews } = await listReviews(appContext(contando), 'output');
    expect(reviews).toHaveLength(2);
    expect(lecturas).toBe(1);
  });

  it('una fuente que cambió por otro camino no es «aplicada» ni «pendiente», y se dice', async () => {
    const context = appContext(new MemoryFileSystem({ [`/work/output/${NAME}`]: REVIEW, '/work/data/sources/experience/acme.md': SOURCE.replace('- Original uno', '- Otra cosa distinta') }));
    const result = await readReview(context, 'output', NAME);
    expect(result.ok && result.file.statuses[0]).toEqual({ id: 'ach-1', state: 'changed' });
  });

  it('un resumen ya escrito se reconoce igual, y sin fuente legible no se adivina', async () => {
    const summaryHeader: ReviewHeader = { ...HEADER, task: 'summarize' };
    const summaryItem: ReviewItem = { id: 'profile', location: 'perfil', original: 'Resumen viejo', source: { file: 'profile.md', line: 1, hash: fingerprint('Resumen viejo') }, proposals: [{ text: 'Resumen nuevo', rationale: 'r', verdict: OK }], fromCache: false, elapsedMs: 1, usage: {} };
    const review = formatReview(summaryHeader, [summaryItem]);
    const name = 'revision-summarize-2026-08-29.md';
    const escrito = appContext(new MemoryFileSystem({ [`/work/output/${name}`]: review, '/work/data/sources/profile.md': '---\nfullName: Ada\n---\n\nResumen nuevo\n' }));
    expect((await readReview(escrito, 'output', name)) as { file: { statuses: unknown } }).toMatchObject({ file: { statuses: [{ id: 'profile', state: 'applied' }] } });
    const viejo = appContext(new MemoryFileSystem({ [`/work/output/${name}`]: review, '/work/data/sources/profile.md': '---\nfullName: Ada\n---\n\nResumen viejo\n' }));
    expect((await readReview(viejo, 'output', name)) as { file: { statuses: unknown } }).toMatchObject({ file: { statuses: [{ id: 'profile', state: 'pending' }] } });
    const sinFuente = appContext(new MemoryFileSystem({ [`/work/output/${name}`]: review }));
    expect((await readReview(sinFuente, 'output', name)) as { file: { statuses: unknown } }).toMatchObject({ file: { statuses: [{ id: 'profile', state: 'unknown' }] } });
    // Un perfil que se quedó SIN resumen: ni es la propuesta ni es el que la revisión vio.
    const vacio = appContext(new MemoryFileSystem({ [`/work/output/${name}`]: review, '/work/data/sources/profile.md': '---\nfullName: Ada\n---\n' }));
    expect((await readReview(vacio, 'output', name)) as { file: { statuses: unknown } }).toMatchObject({ file: { statuses: [{ id: 'profile', state: 'changed' }] } });
  });

  it('una revisión sin directorio de fuentes en la cabecera mira el de siempre, data/sources', async () => {
    const review = formatReview({ ...HEADER, dataDir: undefined }, [item('ach-1', 'Original uno', 'Propuesta uno')]);
    const name = 'revision-improve-2026-08-31.md';
    const context = appContext(new MemoryFileSystem({ [`/work/output/${name}`]: review, '/work/data/sources/experience/acme.md': SOURCE.replace('- Original uno', '- Propuesta uno') }));
    expect((await readReview(context, 'output', name)) as { file: { statuses: unknown } }).toMatchObject({ file: { statuses: [{ id: 'ach-1', state: 'applied' }] } });
  });

  it('un ítem sin fuente registrada, o con una ruta que no se admite, es «unknown»', async () => {
    const sinFuente: ReviewItem = { id: 'ach-9', location: 'x', original: 'Original nueve', proposals: [{ text: 'Propuesta nueve', rationale: 'r', verdict: OK }], fromCache: false, elapsedMs: 1, usage: {} };
    const fuera: ReviewItem = { ...sinFuente, id: 'ach-8', source: { file: '../fuera.md', line: 1, hash: 'abc' } };
    const review = formatReview(HEADER, [sinFuente, fuera]);
    const name = 'revision-improve-2026-08-30.md';
    const context = appContext(new MemoryFileSystem({ [`/work/output/${name}`]: review }));
    expect((await readReview(context, 'output', name)) as { file: { progress: unknown } }).toMatchObject({ file: { progress: { unknown: 2 } } });
  });
});

describe('archivar, desarchivar y eliminar revisiones (T-9.24)', () => {
  const ARCHIVED = '/work/output/revisiones-archivadas';

  it('archivar mueve el fichero fuera de la lista sin borrarlo, y desarchivar lo devuelve', async () => {
    const fs = new MemoryFileSystem({ [`/work/output/${NAME}`]: REVIEW });
    const context = appContext(fs);
    const archivada = await setReviewArchived(context, 'output', NAME, true);
    expect(archivada).toEqual({ ok: true, name: NAME, path: `${ARCHIVED}/${NAME}`, archived: true, moved: true });
    expect(fs.file(`/work/output/${NAME}`)).toBeUndefined();
    expect(fs.file(`${ARCHIVED}/${NAME}`)?.content).toBe(REVIEW);

    // Sale de la lista principal, pero no desaparece: el listado la devuelve aparte, marcada.
    const listado = await listReviews(context, 'output');
    expect(listado.reviews).toEqual([]);
    expect(listado.archived.map((entry) => [entry.name, entry.archived])).toEqual([[NAME, true]]);
    // Y se sigue pudiendo abrir por su nombre de siempre: archivar no cambia la URL.
    expect(await readReview(context, 'output', NAME)).toMatchObject({ ok: true, file: { archived: true, text: REVIEW } });

    expect(await setReviewArchived(context, 'output', NAME, false)).toMatchObject({ ok: true, path: `/work/output/${NAME}`, archived: false, moved: true });
    expect(fs.file(`/work/output/${NAME}`)?.content).toBe(REVIEW);
  });

  it('pedir lo que ya es no mueve nada; y en el destino nunca se sobrescribe: la que llega toma -2', async () => {
    const fs = new MemoryFileSystem({ [`/work/output/${NAME}`]: REVIEW, [`${ARCHIVED}/${NAME}`]: 'una archivada anterior con el mismo nombre' });
    const context = appContext(fs);
    expect(await setReviewArchived(context, 'output', NAME, true)).toMatchObject({ ok: true, name: 'revision-improve-2026-08-29-2.md', moved: true });
    expect(fs.file(`${ARCHIVED}/${NAME}`)?.content).toBe('una archivada anterior con el mismo nombre');
    expect(fs.file(`${ARCHIVED}/revision-improve-2026-08-29-2.md`)?.content).toBe(REVIEW);
    // La primera ya estaba archivada: pedirlo otra vez no la mueve ni falla.
    expect(await setReviewArchived(context, 'output', NAME, true)).toMatchObject({ ok: true, moved: false, archived: true });
  });

  it('se niega a nombres que no son revisiones, avisa si no existe y explica un fallo al mover', async () => {
    const fs = new MemoryFileSystem({ [`/work/output/${NAME}`]: REVIEW });
    const context = appContext(fs);
    expect(await setReviewArchived(context, 'output', '../fuera.md', true)).toMatchObject({ ok: false, error: { code: 'unsafe-path' } });
    expect(await setReviewArchived(context, 'output', 'revision-no.md', true)).toMatchObject({ ok: false, error: { code: 'not-found' } });
    fs.failures.add('rename');
    expect(await setReviewArchived(context, 'output', NAME, true)).toMatchObject({ ok: false, error: { code: 'environment', message: expect.stringContaining('No se pudo archivar') as string } });
    fs.failures.delete('rename');
    await setReviewArchived(context, 'output', NAME, true);
    fs.failures.add('rename');
    expect(await setReviewArchived(context, 'output', NAME, false)).toMatchObject({ ok: false, error: { code: 'environment', message: expect.stringContaining('No se pudo desarchivar') as string } });
  });

  it('eliminar encuentra la revisión esté donde esté, y no confunde un directorio con ella', async () => {
    const fs = new MemoryFileSystem({ [`${ARCHIVED}/${NAME}`]: REVIEW, '/work/output/revision-dir.md/x': 'y' });
    const context = appContext(fs);
    expect(await locateReview(context, 'output', 'revision-dir.md')).toBeUndefined();
    expect(await removeReview(context, 'output', '../fuera.md')).toMatchObject({ ok: false, error: { code: 'unsafe-path' } });
    expect(await removeReview(context, 'output', 'revision-no.md')).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(await removeReview(context, 'output', NAME)).toEqual({ ok: true, name: NAME, path: `${ARCHIVED}/${NAME}` });
    expect(fs.file(`${ARCHIVED}/${NAME}`)).toBeUndefined();
    const roto = new MemoryFileSystem({ [`/work/output/${NAME}`]: REVIEW });
    roto.failures.add('remove');
    expect(await removeReview(appContext(roto), 'output', NAME)).toMatchObject({ ok: false, error: { code: 'environment' } });
  });

  it('una revisión archivada pertenece al directorio de arriba, no a la carpeta del archivo', () => {
    expect(reviewDirectoryOf(`/work/output/${NAME}`)).toEqual({ directory: '/work/output', name: NAME });
    expect(reviewDirectoryOf(`${ARCHIVED}/${NAME}`)).toEqual({ directory: '/work/output', name: NAME });
  });
});
