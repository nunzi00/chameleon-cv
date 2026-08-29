import { describe, expect, it } from 'vitest';

import { contentHash, listSources, readSource, writeSource } from '../../src/app';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem, datasetTree } from '../helpers/memory-file-system';

const ACME = '---\ncompany: ACME\nrole: Dev\nstart: 2020\n---\n\nTexto.\n';

function workspace(extra: Record<string, string> = {}): { fs: MemoryFileSystem; context: ReturnType<typeof appContext> } {
  const fs = new MemoryFileSystem(datasetTree({ '/data/experience/acme.md': ACME, ...extra }));
  return { fs, context: appContext(fs) };
}

describe('listSources', () => {
  it('lista los ficheros que el cargador reconoce, con tamaño, fecha y huella', async () => {
    const { context } = workspace();
    const result = await listSources(context, '/data');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.root).toBe('/data');
      expect(result.entries.map((entry) => entry.path).sort()).toEqual(['experience/acme.md', 'profile.md']);
      const acme = result.entries.find((entry) => entry.path === 'experience/acme.md');
      expect(acme).toEqual({ path: 'experience/acme.md', bytes: Buffer.byteLength(ACME), mtimeMs: 0, sha256: contentHash(ACME) });
    }
  });

  it('con un dataset mal formado devuelve los problemas como la CLI, todos a la vez', async () => {
    const { context } = workspace({ '/data/desconocido.txt': 'x' });
    const result = await listSources(context, '/data');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid-data');
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.error.lines?.at(-1)).toBe(`${result.issues.length === 1 ? '1 problema' : `${result.issues.length} problemas`} en /data`);
    }
  });
});

describe('readSource', () => {
  it('devuelve el contenido y su huella; rechaza identificadores inseguros; distingue «no existe» de otros fallos', async () => {
    const { context } = workspace();
    expect(await readSource(context, '/data', 'experience/acme.md')).toEqual({ ok: true, file: { path: 'experience/acme.md', content: ACME, sha256: contentHash(ACME) } });
    for (const unsafe of ['../secreto.md', '/etc/passwd', 'a\\b.md', 'experience//acme.md', './profile.md']) {
      const result = await readSource(context, '/data', unsafe);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('unsafe-path');
      }
    }
    const missing = await readSource(context, '/data', 'projects/nada.md');
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error).toEqual({ code: 'not-found', message: 'No existe la fuente «projects/nada.md»', exitCode: 2 });
    }
    const directory = await readSource(context, '/data', 'experience');
    expect(directory.ok).toBe(false);
    if (!directory.ok) {
      expect(directory.error.code).toBe('environment');
      expect(directory.error.message).toContain('No se pudo leer la fuente «experience»');
    }
  });
});

describe('writeSource (el usuario edita sus fuentes con concurrencia optimista; canon C9)', () => {
  it('crea un fichero nuevo con «*», atómicamente y con permisos 0600', async () => {
    const { fs, context } = workspace();
    const result = await writeSource(context, '/data', { path: 'projects/nuevo.md', content: 'contenido', expectedSha256: '*' });
    expect(result).toEqual({ ok: true, file: { path: 'projects/nuevo.md', content: 'contenido', sha256: contentHash('contenido') } });
    expect(fs.file('/data/projects/nuevo.md')).toMatchObject({ content: 'contenido', mode: 0o600 });
    expect((await fs.readDirectory('/data/projects')).map((entry) => entry.name)).toEqual(['nuevo.md']);
  });

  it('sustituye solo si la huella coincide con el contenido actual', async () => {
    const { fs, context } = workspace();
    const stale = await writeSource(context, '/data', { path: 'experience/acme.md', content: 'otro', expectedSha256: contentHash('viejo') });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error.code).toBe('conflict');
      expect(stale.error.message).toContain('cambió desde que se leyó');
    }
    const fresh = await writeSource(context, '/data', { path: 'experience/acme.md', content: 'otro', expectedSha256: contentHash(ACME) });
    expect(fresh.ok).toBe(true);
    expect(fs.file('/data/experience/acme.md')?.content).toBe('otro');
  });

  it('rechaza crear sobre un fichero existente, sustituir uno que no existe y los identificadores inseguros', async () => {
    const { context } = workspace();
    const existing = await writeSource(context, '/data', { path: 'experience/acme.md', content: 'x', expectedSha256: '*' });
    expect(existing.ok).toBe(false);
    if (!existing.ok) {
      expect(existing.error.message).toBe('Ya existe la fuente «experience/acme.md»: envía su huella actual para sustituirla');
    }
    const missing = await writeSource(context, '/data', { path: 'projects/nada.md', content: 'x', expectedSha256: contentHash('x') });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.message).toBe('No existe la fuente «projects/nada.md»: envía «*» como huella para crearla');
    }
    const unsafe = await writeSource(context, '/data', { path: '../fuera.md', content: 'x', expectedSha256: '*' });
    expect(unsafe.ok).toBe(false);
    if (!unsafe.ok) {
      expect(unsafe.error.code).toBe('unsafe-path');
    }
  });

  it('propaga un fallo de lectura y convierte un fallo de escritura en error del entorno', async () => {
    const { fs, context } = workspace();
    const directory = await writeSource(context, '/data', { path: 'experience', content: 'x', expectedSha256: contentHash('x') });
    expect(directory.ok).toBe(false);
    if (!directory.ok) {
      expect(directory.error.code).toBe('environment');
    }
    fs.failures.add('writeFile');
    const failed = await writeSource(context, '/data', { path: 'projects/nuevo.md', content: 'x', expectedSha256: '*' });
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error).toEqual({ code: 'environment', message: 'No se pudo escribir la fuente «projects/nuevo.md»: fallo simulado en writeFile', exitCode: 2 });
    }
  });
});
