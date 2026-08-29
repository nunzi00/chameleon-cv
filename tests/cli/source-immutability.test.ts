/**
 * Canon C9 (2026-08-28): inmutabilidad de la fuente de datos. Ningún comando que genere contenido
 * derivado toca `data/sources/`: todo va a `output/` o al artefacto. Este test lo garantiza para
 * todos ellos con un sistema de ficheros en memoria que registra cada operación de escritura.
 */
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultAssets } from '../../src/shared/assets';
import { serializeProfile } from '../../src/artifact';
import { EXIT_OK, runCli, type CliContext } from '../../src/cli';
import { MemoryLlmCache, type LlmProvider, type LlmRequest } from '../../src/llm';
import { NodeFileSystem, defaultSourceParsers, loadDataset } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import { renderTypstCv } from '../../src/renderers/typst';
import { installTypst, typstStatus } from '../../src/typst';
import { BACKEND_OFFER } from '../fixtures/offer';
import { MemoryFileSystem, type MemoryEntry } from '../helpers/memory-file-system';

const SOURCES = '/work/data/sources';
const WRITE_OPERATIONS = ['mkdir', 'writeFile', 'rename', 'chmod', 'remove'];

function provider(): LlmProvider {
  return {
    id: 'ollama',
    kind: 'local',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'fake',
    complete: (request: LlmRequest) => {
      const input = JSON.parse(request.messages[1]?.content ?? '{}') as { text?: string };
      if (request.schemaName === 'suggest-tags') {
        const tags = { suggestions: [{ tag: 'kubernetes', reason: 'r' }] };
        return Promise.resolve({ ok: true, json: tags, raw: JSON.stringify(tags), model: 'fake', usage: {}, elapsedMs: 1 });
      }
      const json = { proposals: [{ text: input.text === undefined ? 'Senior Backend Engineer con PHP y Kubernetes; reduje la latencia p95 un 40 %.' : `Logré: ${input.text.replace(/\*\*/g, '')}`, rationale: 'r' }] };
      return Promise.resolve({ ok: true, json, raw: JSON.stringify(json), model: 'fake', usage: {}, elapsedMs: 1 });
    },
    health: () => Promise.resolve({ ok: true, version: undefined, models: ['fake'], modelAvailable: true }),
  };
}

async function workspace(): Promise<{ context: CliContext; fs: MemoryFileSystem }> {
  const dataset = await loadDataset(join(__dirname, '../fixtures/dataset'), { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
  if (!dataset.ok) {
    throw new Error('dataset');
  }
  const tree: Record<string, string | MemoryEntry> = {
    [`${SOURCES}/profile.md`]: { kind: 'file', content: '---\nfullName: Ada Ejemplo\n---\n', mtimeMs: 100 },
    [`${SOURCES}/skills.csv`]: { kind: 'file', content: 'name\nPHP\n', mtimeMs: 100 },
    '/work/data/dist/profile.json': { kind: 'file', content: serializeProfile(dataset.profile), mode: 0o600, mtimeMs: 500 },
    '/work/offers/acme-backend.txt': BACKEND_OFFER,
  };
  const fs = new MemoryFileSystem(tree);
  const context: CliContext = {
    cwd: '/work',
    stdout: () => undefined,
    stderr: () => undefined,
    stdin: () => Promise.resolve(''),
    datasetFileSystem: fs,
    artifactFileSystem: fs,
    parsers: defaultSourceParsers(),
    pdfExtractor: (bytes) => extractPdfText(bytes),
    typstRenderer: (profile, options) => renderTypstCv(profile, options),
    typstInstall: (options, report) => installTypst(options, report),
    typstStatus: (options) => typstStatus(options),
    llmStatus: () => Promise.reject(new Error('no usado')),
    llmProvider: () => Promise.resolve({ ok: true as const, provider: provider() }),
    llmCache: new MemoryLlmCache(),
    assets: defaultAssets(),
    now: () => new Date('2026-08-28T20:00:00.000Z'),
  };
  return { context, fs };
}

const COMMANDS: ReadonlyArray<readonly string[]> = [
  ['build'],
  ['validate'],
  ['generate-cv', '-s', 'backend'],
  ['generate-cv', '-f', 'offers/acme-backend.txt', '--compact', '--format', 'pdf'],
  ['analyze-offer', 'offers/acme-backend.txt', '--explain'],
  ['improve', '--only', 'exp-acme-1'],
  ['summarize', '-s', 'backend'],
  ['suggest', 'tags', 'Migré la plataforma a Kubernetes'],
  ['suggest', 'tags', '--only', 'exp-acme-1'],
];

describe('canon C9: inmutabilidad de la fuente de datos', () => {
  it.each(COMMANDS)('«cv %s %s %s %s %s» no escribe nada bajo data/sources', async (...args) => {
    const { context, fs } = await workspace();
    const before = new Map([...Object.entries({ profile: fs.file(`${SOURCES}/profile.md`)?.content, skills: fs.file(`${SOURCES}/skills.csv`)?.content })]);
    expect(await runCli([...args], context)).toBe(EXIT_OK);
    const writesToSources = fs.log.filter((entry) => WRITE_OPERATIONS.some((operation) => entry.startsWith(`${operation} `)) && entry.includes(SOURCES));
    expect(writesToSources).toEqual([]);
    expect(fs.file(`${SOURCES}/profile.md`)?.content).toBe(before.get('profile'));
    expect(fs.file(`${SOURCES}/skills.csv`)?.content).toBe(before.get('skills'));
  });
});
