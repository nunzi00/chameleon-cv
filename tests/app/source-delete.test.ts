import { describe, expect, it } from 'vitest';

import { contentHash, deleteSource, describeRemoved, hidingFile, readSourceHistory } from '../../src/app';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const ROOT = '/work/data/sources';
const PROFILE = ['---', 'fullName: Ada Lovelace', 'headline: Ingeniera', 'email: ada@example.com', '---', '', 'Resumen profesional de ejemplo.', ''].join('\n');
const ACME = ['---', 'company: ACME', 'role: Backend Engineer', 'start: 2020-01', 'end: 2022-12', 'id: exp-acme', '---', '', '## Logros', '', '- Reduje la latencia un 40 %', ''].join('\n');
const OTRA = ['---', 'company: Otra', 'role: Dev', 'start: 2018-01', 'end: 2019-12', 'id: exp-otra', '---', '', '## Logros', '', '- Hice cosas', ''].join('\n');

function workspace(extra: Record<string, string> = {}): MemoryFileSystem {
  return new MemoryFileSystem({ [`${ROOT}/profile.md`]: PROFILE, [`${ROOT}/experience/acme.md`]: ACME, [`${ROOT}/experience/otra.md`]: OTRA, ...extra });
}

describe('deleteSource: eliminar una fuente (T-9.25)', () => {
  it('dice qué entradas del perfil desaparecen, las borra y las deja recuperables en el histórico', async () => {
    const fs = workspace();
    const context = appContext(fs, { now: () => new Date('2026-09-03T10:00:00.000Z') });

    // En seco: se sabe qué se lleva por delante SIN tocar el disco.
    const plan = await deleteSource(context, ROOT, { path: 'experience/acme.md', dryRun: true });
    expect(plan.ok && plan.outcome.removed).toEqual([{ section: 'experience', id: 'exp-acme', title: 'Backend Engineer · ACME' }]);
    expect(plan.ok && plan.outcome.historyId).toBeUndefined();
    expect(fs.file(`${ROOT}/experience/acme.md`)).toBeDefined();

    const result = await deleteSource(context, ROOT, { path: 'experience/acme.md' });
    expect(result.ok && result.outcome.removed).toEqual([{ section: 'experience', id: 'exp-acme', title: 'Backend Engineer · ACME' }]);
    expect(fs.file(`${ROOT}/experience/acme.md`)).toBeUndefined();
    // La otra experiencia sigue intacta: se borra un fichero, no una sección.
    expect(fs.file(`${ROOT}/experience/otra.md`)?.content).toBe(OTRA);

    // Y se recupera: el histórico guarda el fichero entero con «después» vacío.
    const [entry] = await readSourceHistory(context);
    expect(entry).toMatchObject({ action: 'apply', origin: 'borrado-experience/acme.md' });
    expect(entry?.files).toEqual([{ path: 'experience/acme.md', sha256Before: contentHash(ACME), sha256After: contentHash(''), ids: ['exp-acme'] }]);
    expect(result.ok && result.outcome.historyId).toBe(entry?.id);
  });

  it('se niega a borrar lo que dejaría el espacio de trabajo sin cargar, y lo explica', async () => {
    const fs = workspace();
    const context = appContext(fs);
    const result = await deleteSource(context, ROOT, { path: 'profile.md' });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-data', message: expect.stringContaining('dejarían de cargar') as string } });
    expect(fs.file(`${ROOT}/profile.md`)?.content).toBe(PROFILE);
    expect(await readSourceHistory(context)).toEqual([]);
  });

  it('con huella, no se borra lo que cambió por debajo; y una fuente que no existe se dice', async () => {
    const fs = workspace();
    const context = appContext(fs);
    expect(await deleteSource(context, ROOT, { path: 'experience/acme.md', expectedSha256: 'otra-cosa' })).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(fs.file(`${ROOT}/experience/acme.md`)).toBeDefined();
    expect(await deleteSource(context, ROOT, { path: 'experience/acme.md', expectedSha256: contentHash(ACME) })).toMatchObject({ ok: true });

    expect(await deleteSource(context, ROOT, { path: 'experience/no-esta.md' })).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(await deleteSource(context, ROOT, { path: '../fuera.md' })).toMatchObject({ ok: false, error: { code: 'unsafe-path' } });
  });

  it('un fichero que no aporta ninguna entrada se borra igual, y se dice que no quitaba nada', async () => {
    const fs = workspace({ [`${ROOT}/skills.csv`]: 'id,name,category\n' });
    const context = appContext(fs);
    const result = await deleteSource(context, ROOT, { path: 'skills.csv' });
    expect(result.ok && result.outcome.removed).toEqual([]);
    expect(describeRemoved([])).toBe('ninguna entrada del perfil');
    expect(fs.file(`${ROOT}/skills.csv`)).toBeUndefined();
    // Sin entradas que nombrar, el histórico se queda con la ruta como identificador.
    expect((await readSourceHistory(context))[0]?.files[0]?.ids).toEqual(['skills.csv']);
  });

  it('si las fuentes ya no cargan, no se adivina qué pasaría al borrar', async () => {
    const fs = workspace({ [`${ROOT}/experience/rota.md`]: '---\nno: cierra\n' });
    expect(await deleteSource(appContext(fs), ROOT, { path: 'experience/acme.md' })).toMatchObject({ ok: false, error: { code: 'invalid-data', message: expect.stringContaining('no cargan ahora mismo') as string } });
    expect(fs.file(`${ROOT}/experience/acme.md`)).toBeDefined();
  });

  it('los fallos del disco se explican y no dejan el borrado a medias', async () => {
    const sinRaiz = new MemoryFileSystem({ [`${ROOT}/profile.md`]: PROFILE });
    expect(await deleteSource(appContext(sinRaiz), '/work/no-esta', { path: 'x.md' })).toMatchObject({ ok: false, error: { code: 'environment', message: expect.stringContaining('directorio de fuentes') as string } });

    const fs = workspace();
    fs.failures.add('mkdir');
    expect(await deleteSource(appContext(fs), ROOT, { path: 'experience/acme.md' })).toMatchObject({ ok: false, error: { code: 'environment' } });
    expect(fs.file(`${ROOT}/experience/acme.md`)).toBeDefined();
    fs.failures.delete('mkdir');

    fs.failures.add('remove');
    expect(await deleteSource(appContext(fs), ROOT, { path: 'experience/acme.md' })).toMatchObject({ ok: false, error: { code: 'environment', message: expect.stringContaining('No se pudo borrar') as string } });
  });

  it('describeRemoved enumera lo que se lleva por delante', () => {
    expect(describeRemoved([{ section: 'experience', id: 'exp-acme', title: 'Backend Engineer · ACME' }])).toBe('1 entrada: exp-acme (Backend Engineer · ACME)');
  });
});

describe('hidingFile: preguntarle al cargador qué quedaría sin un fichero', () => {
  it('esconde esa ruta de su directorio y de toda lectura, y deja pasar el resto', async () => {
    const fs = new MemoryFileSystem({ '/d/a.md': 'a', '/d/b.md': 'b' });
    const sinA = hidingFile(fs, '/d/a.md');
    expect((await sinA.readDirectory('/d')).map((entry) => entry.name)).toEqual(['b.md']);
    expect(await sinA.readTextFile('/d/b.md')).toBe('b');
    expect((await sinA.stat('/d/b.md')).kind).toBe('file');
    expect(await sinA.realPath('/d')).toBe('/d');
    await expect(sinA.readTextFile('/d/a.md')).rejects.toThrow('ENOENT');
    await expect(sinA.stat('/d/a.md')).rejects.toThrow('ENOENT');
    await expect(sinA.readBinaryFile('/d/a.md')).rejects.toThrow('ENOENT');
    await expect(sinA.readBinaryFile('/d/b.md')).resolves.toBeInstanceOf(Uint8Array);
  });
});
