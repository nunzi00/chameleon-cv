import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultAssets } from '../../src/shared/assets';
import { serializeProfile } from '../../src/artifact';
import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK, defaultSummaryReviewPath, runCli, type CliContext, type LlmProviderResult } from '../../src/cli';
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

// La selección backend excluye la experiencia actual: los años calculados por código son 3 (un «5» sería invención).
const FAITHFUL = 'Senior Backend Engineer con 3 años de experiencia en plataformas de pago con PHP, Symfony y Kubernetes; reduje la latencia p95 del checkout un 40 %.\n\nCertificada CKA.';
const INVENTED = 'Senior Backend Engineer con 15 años de experiencia en AWS y Terraform, liderando 40 personas.';

function fakeProvider(calls: LlmRequest[], health: LlmHealth = { ok: true, version: undefined, models: ['fake'], modelAvailable: true }, fail = false): LlmProvider {
  return {
    id: 'ollama',
    kind: 'local',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'fake',
    complete: (request) => {
      calls.push(request);
      if (fail) {
        return Promise.resolve({ ok: false, code: 'timeout', message: 'tarde' });
      }
      const json = { proposals: [{ text: FAITHFUL, rationale: 'fiel' }, { text: INVENTED, rationale: 'inventa' }] };
      return Promise.resolve({ ok: true, json, raw: JSON.stringify(json), model: 'fake-1', usage: { promptTokens: 400, completionTokens: 150 }, elapsedMs: 9 });
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

describe('cv summarize (T-4.4)', () => {
  it('escribe la revisión del resumen (0600) con las propuestas verificadas y su cobertura, avisa de lo que sale y cachea', async () => {
    const h = await harness(undefined);
    expect(await runCli(['summarize', '-s', 'backend', '--redact-companies'], h.context)).toBe(EXIT_OK);
    // Y el mismo interruptor que en improve: sin espera ante una cuota agotada (T-9.16).
    expect(await runCli(['summarize', '-s', 'backend', '--no-wait-quota'], (await harness(undefined)).context)).toBe(EXIT_OK);
    const path = '/work/output/revision-summarize-2026-08-28-backend.md';
    expect(defaultSummaryReviewPath(NOW, 'backend', undefined)).toBe('output/revision-summarize-2026-08-28-backend.md');
    expect(defaultSummaryReviewPath(NOW, undefined, 'acme')).toBe('output/revision-summarize-2026-08-28-acme.md');
    expect(h.stdout()).toBe(`Revisión escrita en ${path}: 2 propuestas · 1 aceptadas · 1 rechazadas (C2) · 9 ms\n`);
    expect(h.stderr()).toContain('Saldrá el perfil filtrado seudonimizado (1 experiencias, 0 proyectos, 3 grupos de skills; ');
    expect(h.stderr()).toContain('sin nombre ni datos de contacto, sin empresas) hacia ollama (http://127.0.0.1:11434, local; modelo fake)\n');
    const review = h.fs.file(path);
    expect(review?.mode).toBe(0o600);
    expect(review?.content).toContain('# Revisión del resumen profesional (cv summarize)');
    expect(review?.content).toContain('## summary · Resumen profesional · backend');
    expect(review?.content).toContain('Original: APIs y sistemas distribuidos para esta especialidad.');
    expect(review?.content).toContain('- [ ] Propuesta 1: Senior Backend Engineer con 3 años de experiencia en plataformas de pago con PHP, Symfony y Kubernetes; reduje la latencia p95 del checkout un 40 %.\n      Certificada CKA.');
    expect(review?.content).toContain('  - cobertura: menciona php, symfony, kubernetes · no menciona: ninguno');
    expect(review?.content).toContain('- ~~Propuesta 2: Senior Backend Engineer con 15 años de experiencia en AWS y Terraform, liderando 40 personas.~~');
    // «40» ya existe en el perfil (40 %): solo el 15 es invención numérica.
    expect(review?.content).toContain('  - verificación: ✗ VIOLATION_C2_NUMBER_ADDED (15) · VIOLATION_C2_ENTITY_ADDED (AWS, Terraform, aws, terraform) · VIOLATION_C2_FACT_OMITTED (php, symfony, kubernetes)');
    const input = JSON.parse(h.calls[0]?.messages[1]?.content ?? '{}') as { headline: string; experience: Array<{ company: string }>; yearsOfExperience: number };
    expect(input.headline).toBe('Senior Backend Engineer');
    expect(input.experience[0]?.company).toBe('[EMPRESA-1]');
    expect(h.calls[0]?.messages[1]?.content).not.toMatch(/example\.com|Madrid|Ada/);
    expect(h.cache.size).toBe(1);
    expect(h.fs.file('/work/data/sources/profile.md')?.content).toBe('---\nfullName: Ada\n---\n');

    const again = await harness(undefined);
    for (const [key] of (h.cache as unknown as { entries: Map<string, unknown> }).entries) {
      const entry = await h.cache.get(key);
      if (entry !== undefined) await again.cache.set(key, entry);
    }
    expect(await runCli(['summarize', '-s', 'backend', '--redact-companies'], again.context)).toBe(EXIT_OK);
    expect(again.stdout()).toContain(' · desde caché\n');
    expect(again.calls).toHaveLength(0);
  });

  it('con oferta orienta el resumen y nombra el fichero; --paragraphs/--proposals/--max-length/-l/-o/--no-cache se transmiten', async () => {
    const h = await harness(undefined);
    expect(await runCli(['summarize', '-f', 'offers/acme-backend.txt', '--compact', '--paragraphs', '3', '--proposals', '1', '--max-length', '600', '-l', 'en', '-o', 'rev/resumen.md', '--no-cache'], h.context)).toBe(EXIT_OK);
    const input = JSON.parse(h.calls[0]?.messages[1]?.content ?? '{}') as { paragraphs: number; proposals: number; maxLength: number; locale: string; offerTerms: string[] };
    expect(input).toMatchObject({ paragraphs: 3, proposals: 1, maxLength: 600, locale: 'en' });
    expect(input.offerTerms).toContain('kubernetes');
    expect(h.fs.file('/work/rev/resumen.md')?.content).toContain('- especialidad: ninguna (perfil completo) · oferta: acme-backend');
    expect(h.cache.size).toBe(0);
    const named = await harness(undefined);
    expect(await runCli(['summarize', '-f', 'offers/acme-backend.txt'], { ...named.context, now: undefined })).toBe(EXIT_OK);
    expect(named.stdout()).toMatch(/revision-summarize-\d{4}-\d{2}-\d{2}-acme-backend\.md/);
  });

  it('--show-prompt imprime el prompt; --dry-run con --show-payload muestra el perfil seudonimizado sin enviar', async () => {
    const prompt = await harness(undefined);
    expect(await runCli(['summarize', '--show-prompt'], prompt.context)).toBe(EXIT_OK);
    expect(prompt.stdout()).toContain('NO inventes cifras');
    const dry = await harness(undefined);
    expect(await runCli(['summarize', '-s', 'backend', '--dry-run', '--show-payload'], dry.context)).toBe(EXIT_OK);
    expect(dry.stdout()).toContain('"headline": "Senior Backend Engineer"');
    expect(dry.stdout()).not.toContain('Ada');
    expect(dry.stderr()).toContain('Ejecución en seco: no se ha enviado nada\n');
    expect(dry.calls).toHaveLength(0);
  });

  it('falla con claridad: proveedor mal configurado, no alcanzable, sin modelo, respuesta fallida (revisión sin propuestas), selección vacía, escritura imposible', async () => {
    const config = await harness({ ok: false, message: 'CHAMELEON_LLM_PROVIDER=«x» no es un proveedor conocido' });
    expect(await runCli(['summarize'], config.context)).toBe(EXIT_FAILURE);
    const down = await harness({ ok: true, provider: fakeProvider([], { ok: false, code: 'unreachable', message: 'Ollama no responde' }) });
    expect(await runCli(['summarize'], down.context)).toBe(EXIT_FAILURE);
    expect(down.stderr()).toContain('Ollama no responde\nComprueba el proveedor con «cv llm status»\n');
    const missing = await harness({ ok: true, provider: fakeProvider([], { ok: true, version: undefined, models: ['otro'], modelAvailable: false }) });
    expect(await runCli(['summarize'], missing.context)).toBe(EXIT_FAILURE);
    expect(missing.stderr()).toContain('El modelo «fake» no está disponible en http://127.0.0.1:11434; comprueba «cv llm status»\n');

    const failing = await harness({ ok: true, provider: fakeProvider([], undefined, true) });
    expect(await runCli(['summarize'], failing.context)).toBe(EXIT_FAILURE);
    expect(failing.stderr()).toContain('timeout: tarde\n');
    expect(failing.stdout()).toContain('(sin propuestas)');
    expect(failing.fs.file('/work/output/revision-summarize-2026-08-28.md')?.content).toContain('- ✗ sin propuestas: timeout: tarde');

    const empty = await harness(undefined, { '/work/data/dist/profile.json': { kind: 'file', content: JSON.stringify({ meta: { schemaVersion: 1 }, personal: { fullName: 'Ada' }, specialties: [], experience: [], projects: [], education: [], skills: [], achievements: [], certifications: [], languages: [] }) } });
    expect(await runCli(['summarize'], empty.context)).toBe(EXIT_DATA_ERROR);
    expect(empty.stderr()).toContain('No hay contenido que resumir con esta selección\n');

    const unwritable = await harness(undefined);
    unwritable.fs.failures.add('mkdir');
    expect(await runCli(['summarize'], unwritable.context)).toBe(EXIT_FAILURE);
    expect(unwritable.stderr()).toContain('No se pudo escribir la revisión en «/work/output/revision-summarize-2026-08-28.md»: fallo simulado en mkdir\n');

    const unknown = await harness(undefined);
    expect(await runCli(['summarize', '-s', 'devops'], unknown.context)).toBe(EXIT_DATA_ERROR);
    const noArtifact = await harness(undefined, { '/work/data/dist/profile.json': { kind: 'file', content: '{"personal":{}}' } });
    expect(await runCli(['summarize'], noArtifact.context)).toBe(EXIT_DATA_ERROR);
    const brokenBuild = await harness(undefined, { '/work/data/sources/notas.md': '' });
    expect(await runCli(['summarize', '--build'], brokenBuild.context)).toBe(EXIT_DATA_ERROR);
    // --build con fuentes válidas recompila (el artefacto pasa a ser el perfil mínimo de las fuentes: nada que resumir).
    const rebuilt = await harness(undefined, { '/work/data/sources/skills.csv': 'name\nPHP\n' });
    expect(await runCli(['summarize', '--build'], rebuilt.context)).toBe(EXIT_OK);
    expect(rebuilt.stderr()).not.toContain('Aviso: profile.md es más reciente');
    expect(JSON.parse(rebuilt.fs.file('/work/data/dist/profile.json')?.content ?? '{}')).toMatchObject({ personal: { fullName: 'Ada' } });
    const stale = await harness(undefined);
    stale.fs.touch('/work/data/sources/profile.md', 900);
    expect(await runCli(['summarize', '-s', 'backend'], stale.context)).toBe(EXIT_OK);
    expect(stale.stderr()).toContain('Aviso: profile.md es más reciente que el artefacto');
  });
});
