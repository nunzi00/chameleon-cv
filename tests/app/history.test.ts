import { describe, expect, it } from 'vitest';

import { HISTORY_LIMIT, describeHistory, historyPath, lookupHistory, offerFingerprint, readHistory, recordHistory, type HistoryEntry } from '../../src/app/history';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const entry = (at: string, action: HistoryEntry['action'] = 'analyze', sha256 = 'a'.repeat(64)): HistoryEntry => ({ at, action, offer: { name: 'nexo', sha256 }, specialty: 'backend', ...(action === 'generate' ? { output: { path: 'output/cv.md', format: 'md' as const } } : {}) });

describe('historial de ofertas', () => {
  it('la huella ignora espacios, saltos de línea y mayúsculas', () => {
    expect(offerFingerprint('Buscamos  Kubernetes\n')).toBe(offerFingerprint('buscamos kubernetes'));
    expect(offerFingerprint('a')).not.toBe(offerFingerprint('b'));
  });

  it('sin fichero, corrupto o con entradas inválidas no hay historial; con entradas válidas se leen', async () => {
    const fs = new MemoryFileSystem();
    const context = appContext(fs);
    expect(await readHistory(context)).toEqual([]);
    await fs.writeFile(historyPath('/work'), '{ no es json', 0o600);
    expect(await readHistory(context)).toEqual([]);
    await fs.writeFile(historyPath('/work'), JSON.stringify({ version: 1, entries: [entry('2026-08-30T10:00:00.000Z'), { at: 1 }, 'x', null, { at: 'x', action: 'otra', offer: {} }] }), 0o600);
    expect(await readHistory(context)).toEqual([entry('2026-08-30T10:00:00.000Z')]);
    await fs.writeFile(historyPath('/work'), JSON.stringify({ version: 1 }), 0o600);
    expect(await readHistory(context)).toEqual([]);
    await fs.writeFile(historyPath('/work'), 'null', 0o600);
    expect(await readHistory(context)).toEqual([]);
  });

  it('recordHistory añade, conserva como mucho el límite y escribe con 0600; lookupHistory filtra por huella del más reciente al más antiguo', async () => {
    const fs = new MemoryFileSystem();
    const context = appContext(fs);
    expect(await recordHistory(context, entry('2026-08-30T10:00:00.000Z'))).toBeUndefined();
    expect(await recordHistory(context, entry('2026-08-30T12:00:00.000Z', 'generate'))).toBeUndefined();
    expect(await recordHistory(context, entry('2026-08-30T11:00:00.000Z', 'analyze', 'b'.repeat(64)))).toBeUndefined();
    expect(fs.file(historyPath('/work'))?.mode).toBe(0o600);
    const entries = await readHistory(context);
    expect(entries).toHaveLength(3);
    expect(lookupHistory(entries, 'a'.repeat(64)).map((item) => item.at)).toEqual(['2026-08-30T12:00:00.000Z', '2026-08-30T10:00:00.000Z']);
    expect(lookupHistory(entries, 'c'.repeat(64))).toEqual([]);
    for (let index = 0; index < HISTORY_LIMIT; index += 1) {
      await recordHistory(context, entry(`2027-01-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`));
    }
    expect(await readHistory(context)).toHaveLength(HISTORY_LIMIT);
  });

  it('recordHistory devuelve el error de escritura en vez de fallar', async () => {
    const fs = new MemoryFileSystem();
    const failing = { readFile: (path: string) => fs.readFile(path), mkdir: () => Promise.reject(new Error('solo lectura')) };
    expect(await recordHistory({ cwd: '/work', artifactFileSystem: failing as never }, entry('2026-08-30T10:00:00.000Z'))).toBe('solo lectura');
    const odd = { readFile: (path: string) => fs.readFile(path), mkdir: () => Promise.reject('rareza') };
    expect(await recordHistory({ cwd: '/work', artifactFileSystem: odd as never }, entry('2026-08-30T10:00:00.000Z'))).toBe('rareza');
  });

  it('describeHistory explica cada procesamiento previo', () => {
    expect(describeHistory([])).toBe('');
    expect(describeHistory([entry('2026-08-30T12:00:00.000Z', 'generate')])).toBe('Esta oferta ya se procesó una vez:\n  2026-08-30T12:00:00.000Z · generate-cv (backend) → output/cv.md\n');
    expect(describeHistory([entry('2026-08-30T12:00:00.000Z', 'generate'), { ...entry('2026-08-30T10:00:00.000Z'), specialty: undefined }])).toBe('Esta oferta ya se procesó 2 veces:\n  2026-08-30T12:00:00.000Z · generate-cv (backend) → output/cv.md\n  2026-08-30T10:00:00.000Z · analyze-offer\n');
  });
});
