import { describe, expect, it } from 'vitest';

import { serializeProfile } from '../../src/artifact';
import { inspectWorkspace, readVersion } from '../../src/app';
import { parseMasterProfile } from '../../src/core/schema';
import type { LlmStatus } from '../../src/llm';
import { defaultAssets } from '../../src/shared/assets';
import type { TypstStatus } from '../../src/typst';
import { fullProfileInput } from '../fixtures/master-profile';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem, type MemoryEntry } from '../helpers/memory-file-system';

const NO_SETTINGS = { path: undefined, present: false, configured: false, error: undefined } as const;

const TYPST: TypstStatus = { required: '0.15.1', candidates: [], selected: undefined, usable: false };
const LLM: LlmStatus = { config: undefined, configError: undefined, health: undefined, keys: { openai: 'none', anthropic: 'none', groq: 'none', gemini: 'none' }, keysFile: '/home/x/.config/chameleon-cv/keys.json', settings: NO_SETTINGS, providers: [], allowedHosts: [], remote: undefined, usable: false };
const OPTIONS = { profile: 'data/dist/profile.json', data: 'data/sources' };

function inspect(tree: Record<string, string | MemoryEntry>, failures: readonly ('readFile')[] = []) {
  const fs = new MemoryFileSystem(tree);
  for (const failure of failures) {
    fs.failures.add(failure);
  }
  return inspectWorkspace(appContext(fs, { typstStatus: () => Promise.resolve(TYPST), llmStatus: () => Promise.resolve(LLM) }), OPTIONS);
}

describe('inspectWorkspace', () => {
  const sources = { '/work/data/sources/profile.md': { kind: 'file' as const, content: '---\nfullName: Ada Ejemplo\n---\n', mtimeMs: 100 } };
  const artifact = serializeProfile(parseMasterProfile(fullProfileInput()));

  it('informa de la versión, el espacio de trabajo, Typst, el proveedor local y los temas', async () => {
    const status = await inspect(sources);
    expect(status.version).toBe(readVersion(await defaultAssets().text('package.json')));
    expect(status.cwd).toBe('/work');
    expect(status.typst).toBe(TYPST);
    expect(status.llm).toBe(LLM);
    expect(status.themes.defaultName).toBe('default');
    expect(status.themes.entries.map((entry) => entry.name)).toEqual(expect.arrayContaining(['default', 'classic']));
  });

  it('sin artefacto: «missing»; con un artefacto que no valida: «invalid» con el motivo', async () => {
    expect((await inspect(sources)).artifact).toEqual({ status: 'missing', detail: undefined, specialties: [] });
    const invalid = (await inspect({ ...sources, '/work/data/dist/profile.json': '{"esto": "no es un perfil"}' })).artifact;
    expect(invalid.status).toBe('invalid');
    expect(invalid.detail).toBeTruthy();
    expect(invalid.specialties).toEqual([]);
  });

  it('con un artefacto válido: al día, obsoleto o sin poder saberlo, con las especialidades', async () => {
    const specialties = parseMasterProfile(fullProfileInput()).specialties.map((specialty) => specialty.id);
    const fresh = (await inspect({ ...sources, '/work/data/dist/profile.json': { kind: 'file', content: artifact, mtimeMs: 500 } })).artifact;
    expect(fresh).toEqual({ status: 'fresh', detail: undefined, specialties });
    const stale = (await inspect({ '/work/data/sources/profile.md': { kind: 'file', content: '---\nfullName: Ada\n---\n', mtimeMs: 900 }, '/work/data/dist/profile.json': { kind: 'file', content: artifact, mtimeMs: 500 } })).artifact;
    expect(stale).toEqual({ status: 'stale', detail: 'profile.md', specialties });
    const unknown = (await inspect({ '/work/data/dist/profile.json': { kind: 'file', content: artifact, mtimeMs: 500 } })).artifact;
    expect(unknown.status).toBe('unknown');
    expect(unknown.detail).toContain('problema');
  });

  it('un fallo de lectura que no sea «no existe» se informa como «unknown»', async () => {
    const status = await inspect({ ...sources, '/work/data/dist/profile.json': artifact }, ['readFile']);
    expect(status.artifact).toEqual({ status: 'unknown', detail: 'Error: fallo simulado en readFile', specialties: [] });
  });
});
