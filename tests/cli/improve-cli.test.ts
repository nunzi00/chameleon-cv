import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultAssets } from '../../src/shared/assets';
import { serializeProfile } from '../../src/artifact';
import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK, achievementIds, defaultReviewPath, runCli, type CliContext, type LlmProviderResult } from '../../src/cli';
import { MemoryLlmCache, type LlmHealth, type LlmProvider, type LlmRequest } from '../../src/llm';
import { NodeFileSystem, defaultSourceParsers, loadDataset } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import { renderTypstCv } from '../../src/renderers/typst';
import { installTypst, typstStatus } from '../../src/typst';
import { BACKEND_OFFER } from '../fixtures/offer';
import { MemoryFileSystem, type MemoryEntry } from '../helpers/memory-file-system';

interface Harness {
  readonly context: CliContext;
  readonly fs: MemoryFileSystem;
  readonly calls: LlmRequest[];
  readonly cache: MemoryLlmCache;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

const NOW = new Date('2026-08-28T20:00:00.000Z');
let artifact = '';

async function loadArtifact(): Promise<string> {
  if (artifact === '') {
    const dataset = await loadDataset(join(__dirname, '../fixtures/dataset'), { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
    if (!dataset.ok) {
      throw new Error('dataset');
    }
    artifact = serializeProfile(dataset.profile);
  }
  return artifact;
}

/** Proveedor simulado: devuelve para cada logro una propuesta fiel (el texto original con otro verbo) y una inventada. */
function fakeProvider(calls: LlmRequest[], health: LlmHealth = { ok: true, version: undefined, models: ['fake'], modelAvailable: true }, failIds: readonly string[] = []): LlmProvider {
  return {
    id: 'ollama',
    kind: 'local',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'fake',
    complete: (request) => {
      calls.push(request);
      const input = JSON.parse(request.messages[1]?.content ?? '{}') as { id: string; text: string };
      if (failIds.includes(input.id)) {
        return Promise.resolve({ ok: false, code: 'timeout', message: 'tarde' });
      }
      const faithful = `Logré: ${input.text.replace(/\*\*/g, '')}`;
      const json = { proposals: [{ text: faithful, rationale: 'fiel' }, { text: `${faithful} con Kubernetes y 99 %`, rationale: 'inventa' }] };
      return Promise.resolve({ ok: true, json, raw: JSON.stringify(json), model: 'fake-1', usage: { promptTokens: 10, completionTokens: 5 }, elapsedMs: 7 });
    },
    health: () => Promise.resolve(health),
  };
}

async function harness(provider: LlmProviderResult | undefined, extra: Record<string, string | MemoryEntry> = {}): Promise<Harness> {
  const out: string[] = [];
  const err: string[] = [];
  const calls: LlmRequest[] = [];
  const cache = new MemoryLlmCache();
  const fs = new MemoryFileSystem({
    '/work/data/sources/profile.md': { kind: 'file', content: '---\nfullName: Ada\n---\n', mtimeMs: 100 },
    '/work/data/dist/profile.json': { kind: 'file', content: await loadArtifact(), mode: 0o600, mtimeMs: 500 },
    '/work/offers/acme-backend.txt': BACKEND_OFFER,
    ...extra,
  });
  const context: CliContext = {
    cwd: '/work',
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
    stdin: () => Promise.resolve(''),
    datasetFileSystem: fs,
    artifactFileSystem: fs,
    parsers: defaultSourceParsers(),
    pdfExtractor: (bytes) => extractPdfText(bytes),
    typstRenderer: (profile, options) => renderTypstCv(profile, options),
    typstInstall: (options, report) => installTypst(options, report),
    typstStatus: (options) => typstStatus(options),
    llmStatus: () => Promise.reject(new Error('no usado')),
    llmProvider: () => Promise.resolve(provider ?? { ok: true as const, provider: fakeProvider(calls) }),
    llmCache: cache,
    assets: defaultAssets(),
    now: () => NOW,
  };
  return { context, fs, calls, cache, stdout: () => out.join(''), stderr: () => err.join('') };
}

describe('cv improve (T-4.3)', () => {
  it('escribe el fichero de revisión (0600) con las propuestas verificadas, avisa de lo que sale, cachea y no toca las fuentes', async () => {
    const h = await harness(undefined);
    expect(await runCli(['improve', '-s', 'backend', '--top-n', '2'], h.context)).toBe(EXIT_OK);
    const path = '/work/output/revision-improve-2026-08-28-backend.md';
    expect(defaultReviewPath(NOW, 'backend', undefined)).toBe('output/revision-improve-2026-08-28-backend.md');
    expect(h.stdout()).toBe(`Revisión escrita en ${path}: 2 logros · 4 propuestas · 2 aceptadas · 2 rechazadas (C2) · 0 fallidos · 0 desde caché\n`);
    expect(h.stderr()).toContain('Saldrán 2 logros seudonimizados (');
    expect(h.stderr()).toContain('sin nombre ni datos de contacto) hacia ollama (http://127.0.0.1:11434, local; modelo fake)\n');
    expect(h.stderr()).toContain('[1/2] exp-acme-1: 1/2 aceptadas · 7 ms\n');
    const review = h.fs.file(path);
    expect(review?.mode).toBe(0o600);
    expect(review?.content).toContain('## exp-acme-1 · Senior Backend Engineer · ACME Corp');
    expect(review?.content).toContain('- [ ] Propuesta 1: Logré: Reduje la latencia p95 del checkout un 40 % rediseñando la capa de caché.');
    expect(review?.content).toContain('  - verificación: ✗ VIOLATION_C2_NUMBER_ADDED (99) · VIOLATION_C2_ENTITY_ADDED (Kubernetes, kubernetes)');
    expect(review?.content).toContain('- especialidad: backend · oferta: ninguna');
    expect(h.calls).toHaveLength(2);
    expect(h.calls.every((call) => !call.messages[1]?.content.includes('ada@example.com'))).toBe(true);
    expect(h.cache.size).toBe(2);
    expect(h.fs.file('/work/data/sources/profile.md')?.content).toBe('---\nfullName: Ada\n---\n');

    // Segunda ejecución: todo desde caché, sin llamadas nuevas.
    const again = await harness(undefined);
    for (const [key] of (h.cache as unknown as { entries: Map<string, unknown> }).entries) {
      const entry = await h.cache.get(key);
      if (entry !== undefined) await again.cache.set(key, entry);
    }
    expect(await runCli(['improve', '-s', 'backend', '--top-n', '2'], again.context)).toBe(EXIT_OK);
    expect(again.stdout()).toContain('· 2 desde caché\n');
    expect(again.calls).toHaveLength(0);
    // --no-cache ignora la caché.
    const fresh = await harness(undefined);
    expect(await runCli(['improve', '--only', 'exp-acme-1', '--no-cache'], fresh.context)).toBe(EXIT_OK);
    expect(fresh.calls).toHaveLength(1);
    expect(fresh.cache.size).toBe(0);
  });

  it('con oferta usa sus términos, respeta --only, --max-items y --redact-companies, y admite -o', async () => {
    const h = await harness(undefined);
    expect(await runCli(['improve', '-f', 'offers/acme-backend.txt', '--only', 'exp-acme-1,ach-1', '--max-items', '1', '--redact-companies', '-o', 'rev/mia.md', '--proposals', '1', '--max-length', '150', '-l', 'en'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain('Aviso: 2 logros superan el máximo por ejecución (1); se procesan los 1 primeros');
    expect(h.stderr()).toContain(', sin empresas) hacia');
    const input = JSON.parse(h.calls[0]?.messages[1]?.content ?? '{}') as { context: { offerTerms: string[]; company: string }; proposals: number; maxLength: number; locale: string };
    expect(input.context.offerTerms).toContain('kubernetes');
    expect(input.context.company).toBe('[EMPRESA-1]');
    expect(input).toMatchObject({ proposals: 1, maxLength: 150, locale: 'en' });
    expect(h.fs.file('/work/rev/mia.md')?.content).toContain('- especialidad: ninguna (perfil completo) · oferta: acme-backend');
    expect(defaultReviewPath(NOW, undefined, 'acme-backend')).toBe('output/revision-improve-2026-08-28-acme-backend.md');

    // Sin reloj inyectado usa el del sistema y el nombre por defecto lleva la fecha de hoy y la oferta.
    const clockless = await harness(undefined);
    expect(await runCli(['improve', '-f', 'offers/acme-backend.txt', '--only', 'exp-acme-1'], { ...clockless.context, now: undefined })).toBe(EXIT_OK);
    expect(clockless.stdout()).toMatch(/revision-improve-\d{4}-\d{2}-\d{2}-acme-backend\.md/);
  });

  it('--show-prompt imprime el prompt sin leer nada; --dry-run y --show-payload muestran lo que saldría sin enviar', async () => {
    const prompt = await harness(undefined);
    expect(await runCli(['improve', '--show-prompt'], prompt.context)).toBe(EXIT_OK);
    expect(prompt.stdout()).toContain('NO añadas ninguno');
    expect(prompt.calls).toHaveLength(0);

    const dry = await harness(undefined);
    expect(await runCli(['improve', '--only', 'exp-acme-1', '--dry-run', '--show-payload'], dry.context)).toBe(EXIT_OK);
    expect(dry.stdout()).toContain('"id": "exp-acme-1"');
    expect(dry.stdout()).not.toContain('Ada');
    expect(dry.stderr()).toContain('Ejecución en seco: no se ha enviado nada\n');
    expect(dry.calls).toHaveLength(0);
    expect(dry.fs.file('/work/output/revision-improve-2026-08-28.md')).toBeUndefined();
  });

  it('falla con claridad: proveedor mal configurado, no alcanzable, sin el modelo, todos los logros fallidos, sin logros, o sin poder escribir', async () => {
    const config = await harness({ ok: false, message: 'CHAMELEON_LLM_PROVIDER=«x» no es un proveedor conocido' });
    expect(await runCli(['improve'], config.context)).toBe(EXIT_FAILURE);
    expect(config.stderr()).toContain('no es un proveedor conocido\n');

    const down = await harness({ ok: true, provider: fakeProvider([], { ok: false, code: 'unreachable', message: 'Ollama no responde' }) });
    expect(await runCli(['improve'], down.context)).toBe(EXIT_FAILURE);
    expect(down.stderr()).toContain('Ollama no responde\nComprueba el proveedor con «cv llm status»\n');

    const missing = await harness({ ok: true, provider: fakeProvider([], { ok: true, version: undefined, models: ['otro'], modelAvailable: false }) });
    expect(await runCli(['improve'], missing.context)).toBe(EXIT_FAILURE);
    expect(missing.stderr()).toContain('El modelo «fake» no está disponible en http://127.0.0.1:11434 (sirve: otro); comprueba «cv llm status»\n');
    const none = await harness({ ok: true, provider: fakeProvider([], { ok: true, version: undefined, models: [], modelAvailable: false }) });
    expect(await runCli(['improve'], none.context)).toBe(EXIT_FAILURE);
    expect(none.stderr()).toContain('(no sirve ningún modelo)');

    const calls: LlmRequest[] = [];
    const failing = await harness({ ok: true, provider: fakeProvider(calls, undefined, ['exp-acme-1']) });
    expect(await runCli(['improve', '--only', 'exp-acme-1'], failing.context)).toBe(EXIT_FAILURE);
    expect(failing.stdout()).toContain('· 1 fallidos ·');

    const empty = await harness(undefined);
    expect(await runCli(['improve', '-s', 'engineering-manager', '--top-n', '0'], empty.context)).toBe(EXIT_DATA_ERROR);
    expect(empty.stderr()).toContain('No hay logros que mejorar con esta selección\n');

    const unwritable = await harness(undefined);
    unwritable.fs.failures.add('mkdir');
    expect(await runCli(['improve', '--only', 'exp-acme-1'], unwritable.context)).toBe(EXIT_FAILURE);
    expect(unwritable.stderr()).toContain('No se pudo escribir la revisión en «/work/output/revision-improve-2026-08-28.md»: fallo simulado en mkdir\n');

    const unknownSpecialty = await harness(undefined);
    expect(await runCli(['improve', '-s', 'devops'], unknownSpecialty.context)).toBe(EXIT_DATA_ERROR);
    const badOffer = await harness(undefined);
    expect(await runCli(['improve', '-f', 'offers/no-existe.txt'], badOffer.context)).toBe(EXIT_FAILURE);
    const badOfferSpecialty = await harness(undefined);
    expect(await runCli(['improve', '-f', 'offers/acme-backend.txt', '-s', 'devops'], badOfferSpecialty.context)).toBe(EXIT_DATA_ERROR);
    const noArtifact = await harness(undefined, { '/work/data/dist/profile.json': { kind: 'file', content: '{"personal":{}}' } });
    expect(await runCli(['improve'], noArtifact.context)).toBe(EXIT_DATA_ERROR);
    const proposals = await harness(undefined);
    expect(await runCli(['improve', '--proposals', '9'], proposals.context)).toBe(EXIT_FAILURE);
    expect(proposals.stderr()).toContain('debe ser un entero entre 1 y 3');
  });

  it('--build recompila antes; sin --build avisa si el artefacto está obsoleto; achievementIds recorre todo el perfil', async () => {
    const stale = await harness(undefined);
    stale.fs.touch('/work/data/sources/profile.md', 900);
    expect(await runCli(['improve', '--only', 'exp-acme-1'], stale.context)).toBe(EXIT_OK);
    expect(stale.stderr()).toContain('Aviso: profile.md es más reciente que el artefacto');

    const built = await harness(undefined);
    expect(await runCli(['improve', '--build'], built.context)).toBe(EXIT_DATA_ERROR);
    expect(built.stderr()).toContain('No hay logros que mejorar');
    const brokenBuild = await harness(undefined, { '/work/data/sources/notas.md': '' });
    expect(await runCli(['improve', '--build'], brokenBuild.context)).toBe(EXIT_DATA_ERROR);
    expect(brokenBuild.stderr()).toMatch(/problemas? en \/work\/data\/sources/);

    const dataset = await loadDataset(join(__dirname, '../fixtures/dataset'), { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
    expect(dataset.ok && achievementIds(dataset.profile)).toEqual(['exp-acme-1', 'exp-acme-k8s', 'exp-acme-3', 'proj-chameleon-1', 'ach-1', 'ach-2']);
  });
});

describe('cv llm cache clear', () => {
  it('vacía la caché y lo cuenta', async () => {
    const h = await harness(undefined);
    await h.cache.set('k', { createdAt: 'x', model: 'm', raw: '{}', json: {}, usage: {}, elapsedMs: 0 });
    expect(await runCli(['llm', 'cache', 'clear'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe('Caché de respuestas vaciada: 1 entrada\n');
    expect(h.cache.size).toBe(0);
  });
});
