import { describe, expect, it } from 'vitest';

import {
  SOURCE_HISTORY_LIMIT,
  describeSourceHistory,
  findHistoryEntry,
  historyDirectory,
  historyEntryId,
  historyVersionPath,
  readSourceHistory,
  readSourceVersion,
  recordSourceVersions,
  restoreSourceVersion,
} from '../../src/app/source-history';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const ROOT = '/work/data/sources';
const AT = new Date('2026-08-30T18:12:05.123Z');

function context(fs: MemoryFileSystem) {
  return { cwd: '/work', artifactFileSystem: fs };
}

describe('historyEntryId', () => {
  it('combina la marca compacta con un slug del origen', () => {
    expect(historyEntryId(AT, 'revision-improve-2026-08-30.md')).toBe('20260830T181205123Z-revision-improve-2026-08-30');
    expect(historyEntryId(AT, 'Ñandú & cía.MD')).toBe('20260830T181205123Z-nandu-cia');
    expect(historyEntryId(AT, '***')).toBe('20260830T181205123Z');
    expect(historyEntryId(AT, '20260830T100000000Z-revision-improve')).toBe('20260830T181205123Z-revision-improve');
  });
});

describe('recordSourceVersions / readSourceHistory', () => {
  it('guarda el fichero entero, cambio.json e index.json con 0600; el índice va de la más reciente a la más antigua', async () => {
    const fs = new MemoryFileSystem({ [`${ROOT}/experience/acme.md`]: 'v1' });
    const first = await recordSourceVersions(context(fs), { action: 'apply', origin: 'revision-improve.md', root: ROOT, versions: [{ path: `${ROOT}/experience/acme.md`, before: 'v1', after: 'v2', ids: ['exp-acme-1'] }], at: AT });
    expect(first.ok).toBe(true);
    const entry = first.ok ? first.entry : undefined;
    expect(entry).toMatchObject({ id: '20260830T181205123Z-revision-improve', action: 'apply', origin: 'revision-improve.md', root: ROOT });
    expect(entry?.files).toEqual([{ path: 'experience/acme.md', sha256Before: expect.any(String) as string, sha256After: expect.any(String) as string, ids: ['exp-acme-1'] }]);
    const saved = fs.file(historyVersionPath('/work', '20260830T181205123Z-revision-improve', 'experience/acme.md'));
    expect(saved?.content).toBe('v1');
    expect(saved?.mode).toBe(0o600);
    expect(fs.file(`${historyDirectory('/work')}/20260830T181205123Z-revision-improve/cambio.json`)?.content).toContain('"sha256Before"');
    const later = new Date('2026-08-31T09:00:00.000Z');
    await recordSourceVersions(context(fs), { action: 'restore', origin: '20260830T181205123Z-revision-improve', root: ROOT, versions: [{ path: `${ROOT}/experience/acme.md`, before: 'v2', after: 'v1', ids: ['20260830T181205123Z-revision-improve'] }], at: later });
    const entries = await readSourceHistory(context(fs));
    expect(entries.map((item) => item.action)).toEqual(['restore', 'apply']);
    expect(fs.file(`${historyDirectory('/work')}/index.json`)?.mode).toBe(0o600);
  });

  it('rechaza rutas fuera del directorio de fuentes y explica un fallo de escritura', async () => {
    const fs = new MemoryFileSystem();
    const outside = await recordSourceVersions(context(fs), { action: 'apply', origin: 'r.md', root: ROOT, versions: [{ path: '/etc/passwd', before: '', after: '', ids: [] }], at: AT });
    expect(outside).toMatchObject({ ok: false, error: { code: 'invalid-data' } });
    const broken = { cwd: '/work', artifactFileSystem: { ...fs, mkdir: async () => undefined, writeFile: async () => { throw new Error('disco lleno'); }, readFile: fs.readFile.bind(fs) } as unknown as MemoryFileSystem };
    const failed = await recordSourceVersions(broken, { action: 'apply', origin: 'r.md', root: ROOT, versions: [{ path: `${ROOT}/a.md`, before: '', after: '', ids: [] }], at: AT });
    expect(failed).toMatchObject({ ok: false, error: { code: 'environment' } });
    expect(failed.ok || failed.error.message).toContain('disco lleno');
  });

  it('un índice ausente, inválido o con entradas malformadas equivale a no tener historial; se conservan 500 entradas', async () => {
    expect(await readSourceHistory(context(new MemoryFileSystem()))).toEqual([]);
    expect(await readSourceHistory(context(new MemoryFileSystem({ [`${historyDirectory('/work')}/index.json`]: '{no json' })))).toEqual([]);
    expect(await readSourceHistory(context(new MemoryFileSystem({ [`${historyDirectory('/work')}/index.json`]: '{"version":1,"entries":[{"id":"x"},{"id":"y","at":"2","action":"apply","origin":"o","root":"/r","files":[{"path":"p"}]}]}' })))).toEqual([]);
    expect(await readSourceHistory(context(new MemoryFileSystem({ [`${historyDirectory('/work')}/index.json`]: '{"version":1}' })))).toEqual([]);
    const fs = new MemoryFileSystem();
    for (let index = 0; index < SOURCE_HISTORY_LIMIT + 2; index += 1) {
      await recordSourceVersions(context(fs), { action: 'apply', origin: `r${index}.md`, root: ROOT, versions: [], at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)) });
    }
    const entries = await readSourceHistory(context(fs));
    expect(entries).toHaveLength(SOURCE_HISTORY_LIMIT);
    expect(entries[0]?.origin).toBe(`r${SOURCE_HISTORY_LIMIT + 1}.md`);
  });
});

describe('readSourceVersion / restoreSourceVersion', () => {
  it('lee una versión guardada, se queja de entradas o rutas que no existen y de una versión ilegible', async () => {
    const fs = new MemoryFileSystem({ [`${ROOT}/experience/acme.md`]: 'v1' });
    const recorded = await recordSourceVersions(context(fs), { action: 'apply', origin: 'r.md', root: ROOT, versions: [{ path: `${ROOT}/experience/acme.md`, before: 'v1', after: 'v2', ids: ['a'] }], at: AT });
    const id = recorded.ok ? recorded.entry.id : '';
    const version = await readSourceVersion(context(fs), id, 'experience/acme.md');
    expect(version.ok && version.content).toBe('v1');
    expect(await readSourceVersion(context(fs), 'no-existe', 'experience/acme.md')).toMatchObject({ ok: false, error: { code: 'invalid-data' } });
    expect(await readSourceVersion(context(fs), id, 'otra.md')).toMatchObject({ ok: false, error: { code: 'invalid-data' } });
    await fs.remove(historyVersionPath('/work', id, 'experience/acme.md'));
    expect(await readSourceVersion(context(fs), id, 'experience/acme.md')).toMatchObject({ ok: false, error: { code: 'environment' } });
  });

  it('restaurar escribe la versión guardada y deja la actual en una entrada nueva; los fallos se explican', async () => {
    const fs = new MemoryFileSystem({ [`${ROOT}/experience/acme.md`]: 'v2' });
    const recorded = await recordSourceVersions(context(fs), { action: 'apply', origin: 'r.md', root: ROOT, versions: [{ path: `${ROOT}/experience/acme.md`, before: 'v1', after: 'v2', ids: ['a'] }], at: AT });
    const id = recorded.ok ? recorded.entry.id : '';
    const restored = await restoreSourceVersion(context(fs), id, 'experience/acme.md', new Date('2026-08-31T10:00:00.000Z'));
    expect(restored.ok).toBe(true);
    expect(fs.file(`${ROOT}/experience/acme.md`)?.content).toBe('v1');
    const entries = await readSourceHistory(context(fs));
    expect(entries[0]).toMatchObject({ action: 'restore', origin: id, files: [{ path: 'experience/acme.md', ids: [id] }] });
    expect(fs.file(historyVersionPath('/work', entries[0]?.id ?? '', 'experience/acme.md'))?.content).toBe('v2');
    expect(await restoreSourceVersion(context(fs), 'no', 'experience/acme.md')).toMatchObject({ ok: false });
    await fs.remove(`${ROOT}/experience/acme.md`);
    expect(await restoreSourceVersion(context(fs), id, 'experience/acme.md')).toMatchObject({ ok: false, error: { code: 'environment' } });
  });

  it('describeSourceHistory resume las entradas o dice que el histórico está vacío', async () => {
    expect(describeSourceHistory([])).toContain('vacío');
    const fs = new MemoryFileSystem();
    await recordSourceVersions(context(fs), { action: 'apply', origin: 'r.md', root: ROOT, versions: [{ path: `${ROOT}/a.md`, before: '', after: 'x', ids: ['a-1', 'a-2'] }], at: AT });
    expect(describeSourceHistory(await readSourceHistory(context(fs)))).toBe('2026-08-30T18:12:05.123Z · apply r.md · a.md (a-1, a-2) · 20260830T181205123Z-r\n');
  });
});

describe('ramas de error del histórico', () => {
  function failingWrites(fs: MemoryFileSystem, shouldFail: (path: string) => boolean, thrown: unknown = new Error('sin permisos')) {
    return {
      cwd: '/work',
      artifactFileSystem: {
        ...fs,
        mkdir: fs.mkdir.bind(fs),
        readFile: fs.readFile.bind(fs),
        writeFile: async (path: string, content: string, mode: number) => {
          if (shouldFail(path)) {
            throw thrown;
          }
          await fs.writeFile(path, content, mode);
        },
      } as unknown as MemoryFileSystem,
    };
  }

  it('restaurar: si no se puede guardar la versión actual o escribir la fuente, lo dice y no deja el histórico a medias', async () => {
    const fs = new MemoryFileSystem({ [`${ROOT}/a.md`]: 'v2' });
    const recorded = await recordSourceVersions(context(fs), { action: 'apply', origin: 'r.md', root: ROOT, versions: [{ path: `${ROOT}/a.md`, before: 'v1', after: 'v2', ids: ['a'] }] });
    const id = recorded.ok ? recorded.entry.id : '';
    const historyFails = failingWrites(fs, (path) => path.includes('historial-fuentes'));
    expect(await restoreSourceVersion(historyFails, id, 'a.md')).toMatchObject({ ok: false, error: { code: 'environment' } });
    expect(fs.file(`${ROOT}/a.md`)?.content).toBe('v2');
    const sourceFails = failingWrites(fs, (path) => path === `${ROOT}/a.md`, 'cadena');
    const failed = await restoreSourceVersion(sourceFails, id, 'a.md');
    expect(failed).toMatchObject({ ok: false, error: { code: 'environment' } });
    expect(failed.ok || failed.error.message).toContain('cadena');
  });

  it('los errores que no son Error se muestran como texto al guardar y al leer', async () => {
    const fs = new MemoryFileSystem();
    const stringThrow = failingWrites(fs, () => true, 'cadena');
    const failed = await recordSourceVersions(stringThrow, { action: 'apply', origin: 'r.md', root: ROOT, versions: [{ path: `${ROOT}/a.md`, before: '', after: '', ids: [] }] });
    expect(failed.ok || failed.error.message).toContain('cadena');
    const ok = await recordSourceVersions(context(fs), { action: 'apply', origin: 'r.md', root: ROOT, versions: [{ path: `${ROOT}/a.md`, before: 'x', after: 'y', ids: [] }] });
    const id = ok.ok ? ok.entry.id : '';
    const readerFails = { cwd: '/work', artifactFileSystem: { ...fs, readFile: async (path: string) => { if (path.endsWith('index.json')) { return fs.readFile(path); } throw 'ilegible'; } } as unknown as MemoryFileSystem };
    const version = await readSourceVersion(readerFails, id, 'a.md');
    expect(version.ok || version.error.message).toContain('ilegible');
  });
});

describe('latest y los últimos errores', () => {
  it('«latest» elige la entrada más reciente que guarde la ruta; sin ninguna, lo dice', async () => {
    const fs = new MemoryFileSystem({ [`${ROOT}/a.md`]: 'v3' });
    await recordSourceVersions(context(fs), { action: 'apply', origin: 'r1.md', root: ROOT, versions: [{ path: `${ROOT}/a.md`, before: 'v1', after: 'v2', ids: ['x'] }], at: new Date('2026-08-30T10:00:00.000Z') });
    await recordSourceVersions(context(fs), { action: 'apply', origin: 'r2.md', root: ROOT, versions: [{ path: `${ROOT}/a.md`, before: 'v2', after: 'v3', ids: ['y'] }], at: new Date('2026-08-30T11:00:00.000Z') });
    const latest = await readSourceVersion(context(fs), 'latest', 'a.md');
    expect(latest.ok && latest.content).toBe('v2');
    expect(latest.ok && latest.entry.origin).toBe('r2.md');
    expect(findHistoryEntry([], 'latest', 'a.md')).toBeUndefined();
    const missing = await readSourceVersion(context(fs), 'latest', 'otra.md');
    expect(missing.ok || missing.error.message).toContain('otra.md');
    const restored = await restoreSourceVersion(context(fs), 'latest', 'a.md', new Date('2026-08-30T12:00:00.000Z'));
    expect(restored.ok && restored.entry.origin).toBe('20260830T110000000Z-r2');
    expect(fs.file(`${ROOT}/a.md`)?.content).toBe('v2');
  });

  it('restaurar: la fuente ilegible con un error que no es Error y la escritura que falla con un Error', async () => {
    const fs = new MemoryFileSystem({ [`${ROOT}/a.md`]: 'v2' });
    const recorded = await recordSourceVersions(context(fs), { action: 'apply', origin: 'r.md', root: ROOT, versions: [{ path: `${ROOT}/a.md`, before: 'v1', after: 'v2', ids: ['a'] }] });
    const id = recorded.ok ? recorded.entry.id : '';
    const unreadable = { cwd: '/work', artifactFileSystem: { ...fs, mkdir: fs.mkdir.bind(fs), writeFile: fs.writeFile.bind(fs), readFile: async (path: string) => { if (path === `${ROOT}/a.md`) { throw 'sin lectura'; } return fs.readFile(path); } } as unknown as MemoryFileSystem };
    const failed = await restoreSourceVersion(unreadable, id, 'a.md');
    expect(failed.ok || failed.error.message).toContain('sin lectura');
    const unwritable = { cwd: '/work', artifactFileSystem: { ...fs, mkdir: fs.mkdir.bind(fs), readFile: fs.readFile.bind(fs), writeFile: async (path: string, content: string, mode: number) => { if (path === `${ROOT}/a.md`) { throw new Error('solo lectura'); } await fs.writeFile(path, content, mode); } } as unknown as MemoryFileSystem };
    const failedWrite = await restoreSourceVersion(unwritable, id, 'a.md');
    expect(failedWrite.ok || failedWrite.error.message).toContain('solo lectura');
  });
});
