import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ARTIFACT_MODE, NodeWritableFileSystem, readProfileArtifact, serializeProfile, writeProfileArtifact } from '../../src/artifact';
import { parseMasterProfile } from '../../src/core/schema';
import { MemoryWritableFileSystem } from '../helpers/memory-writable-file-system';
import { selectionProfile } from '../fixtures/selection';

describe('writeProfileArtifact (memoria)', () => {
  it('crea el directorio, escribe un temporal con 0600 y lo renombra al destino', async () => {
    const fs = new MemoryWritableFileSystem();
    const profile = selectionProfile();
    await writeProfileArtifact(fs, '/work/data/dist/profile.json', profile, () => 'abc');
    expect(fs.directories.has('/work/data/dist')).toBe(true);
    expect(fs.files.get('/work/data/dist/profile.json')).toEqual({ content: serializeProfile(profile), mode: ARTIFACT_MODE });
    expect(fs.files.has('/work/data/dist/profile.json.abc.tmp')).toBe(false);
    expect(fs.log).toEqual([
      'mkdir /work/data/dist',
      'writeFile /work/data/dist/profile.json.abc.tmp',
      'chmod /work/data/dist/profile.json.abc.tmp',
      'rename /work/data/dist/profile.json.abc.tmp',
    ]);
  });

  it('si falla el renombrado, elimina el temporal y propaga el error', async () => {
    const fs = new MemoryWritableFileSystem();
    fs.failures.add('rename');
    await expect(writeProfileArtifact(fs, '/work/profile.json', selectionProfile(), () => 'x')).rejects.toThrow('fallo simulado en rename');
    expect(fs.files.size).toBe(0);
    expect(fs.log.at(-1)).toBe('remove /work/profile.json.x.tmp');
  });

  it('si además falla la limpieza del temporal, conserva el error original', async () => {
    const fs = new MemoryWritableFileSystem();
    fs.failures.add('chmod');
    fs.failures.add('remove');
    await expect(writeProfileArtifact(fs, '/work/profile.json', selectionProfile(), () => 'x')).rejects.toThrow('fallo simulado en chmod');
  });

  it('usa un sufijo aleatorio por defecto', async () => {
    const fs = new MemoryWritableFileSystem();
    await writeProfileArtifact(fs, '/work/profile.json', selectionProfile());
    expect(fs.log[1]).toMatch(/^writeFile \/work\/profile\.json\.[0-9a-f]{12}\.tmp$/);
  });
});

describe('readProfileArtifact (memoria)', () => {
  it('lee y re-valida el artefacto', async () => {
    const fs = new MemoryWritableFileSystem();
    const profile = selectionProfile();
    await writeProfileArtifact(fs, '/work/profile.json', profile, () => 'x');
    expect(await readProfileArtifact(fs, '/work/profile.json')).toEqual({ ok: true, profile });
  });

  it('explica la ausencia, los fallos de lectura, el JSON inválido y los datos que no cumplen el esquema', async () => {
    const fs = new MemoryWritableFileSystem();
    expect(await readProfileArtifact(fs, '/work/profile.json')).toEqual({
      ok: false,
      errors: ['No existe el artefacto «/work/profile.json»: ejecuta «cv build-profile» para generarlo'],
    });
    fs.files.set('/work/roto.json', { content: '{ no es json', mode: 0o600 });
    const invalid = await readProfileArtifact(fs, '/work/roto.json');
    expect(invalid.ok).toBe(false);
    expect(!invalid.ok && invalid.errors[0]).toMatch(/^El artefacto «\/work\/roto\.json» no es JSON válido: /);
    fs.files.set('/work/malo.json', { content: JSON.stringify({ personal: { fullName: '' }, extra: 1 }), mode: 0o600 });
    const bad = await readProfileArtifact(fs, '/work/malo.json');
    expect(!bad.ok && bad.errors).toHaveLength(2);
    expect(!bad.ok && bad.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^\/work\/malo\.json: <raíz>: /),
        expect.stringMatching(/^\/work\/malo\.json: personal\.fullName: /),
      ]),
    );
    fs.failures.add('readFile');
    expect(await readProfileArtifact(fs, '/work/profile.json')).toEqual({
      ok: false,
      errors: ['No se pudo leer el artefacto «/work/profile.json»: fallo simulado en readFile'],
    });
  });
});

describe('NodeWritableFileSystem (disco real)', () => {
  const fs = new NodeWritableFileSystem();
  let temporary = '';

  beforeAll(async () => {
    temporary = await mkdtemp(join(tmpdir(), 'chameleon-artifact-'));
  });

  afterAll(async () => {
    await rm(temporary, { recursive: true, force: true });
  });

  it('escribe el artefacto con permisos 0600 en un directorio nuevo y lo vuelve a leer validado', async () => {
    const path = join(temporary, 'nested', 'dist', 'profile.json');
    const profile = parseMasterProfile({ personal: { fullName: 'Ada' } });
    await writeProfileArtifact(fs, path, profile);
    expect((await stat(path)).mode & 0o777).toBe(ARTIFACT_MODE);
    expect(await readFile(path, 'utf8')).toBe(serializeProfile(profile));
    expect(await readProfileArtifact(fs, path)).toEqual({ ok: true, profile });
    await fs.remove(path);
    await fs.remove(path);
    expect(await readProfileArtifact(fs, path)).toMatchObject({ ok: false, errors: [expect.stringContaining('No existe el artefacto')] });
  });
});
