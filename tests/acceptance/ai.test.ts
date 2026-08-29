import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import type { MasterProfile } from '../../src/core/schema';
import { formatReview, parseReview, type ReviewItem } from '../../src/llm';
import { NodeFileSystem, defaultSourceParsers, loadDataset } from '../../src/parsers';
import { localLlmEnvironment, parseTagLines, piiFindings, reverifyImprove, reverifySummary, reviewStructure, splitPayload } from './ai-runner';

let profile: MasterProfile;

beforeAll(async () => {
  const dataset = await loadDataset(join(__dirname, 'bench', 'workspace', 'data', 'sources'), { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
  if (!dataset.ok) throw new Error('banco');
  profile = dataset.profile;
});

const HEADER = { generatedAt: '2026-08-29T10:00:00.000Z', specialty: 'backend', dataDir: 'data/sources', provider: { id: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'm' }, temperature: 0, seed: 7 } as const;
const OK = { accepted: true, violations: [] } as const;
const KO = { accepted: false, violations: [{ code: 'VIOLATION_C2_NUMBER_ADDED' as const, details: ['150'] }] };

describe('arnés de IA (T-5.5.3): ayudantes puros', () => {
  it('piiFindings detecta nombre, partes del nombre, email, teléfono y enlaces del banco', () => {
    expect(piiFindings('{"text":"Lideré la migración de [NOMBRE] a Kubernetes","context":{"company":"Nexo Pagos"}}', profile)).toEqual([]);
    expect(piiFindings('Lucía Ferrer Montalbán escribió a lucia.ferrer@example.org', profile)).toEqual(expect.arrayContaining(['Lucía Ferrer Montalbán', 'Lucía', 'Ferrer', 'Montalbán', 'lucia.ferrer@example.org']));
    expect(piiFindings('llama al +34600123456', profile)).toEqual(['+34600123456']);
    expect(piiFindings('perfil en github.com/lucia-ferrer-example', profile)).toEqual(['github.com/lucia-ferrer-example']);
  });

  it('parseTagLines y splitPayload separan la carga útil del resto de stdout', () => {
    expect(parseTagLines('exp-a-1: #php #kafka\n#solo\notra línea\n  ✗ aws: VIOLATION\n')).toEqual([
      { id: 'exp-a-1', tags: ['php', 'kafka'] },
      { id: undefined, tags: ['solo'] },
    ]);
    expect(splitPayload('[\n  {\n    "id": "x"\n  }\n]\nexp-a-1: #php\n')).toEqual({ payload: '[\n  {\n    "id": "x"\n  }\n]', rest: 'exp-a-1: #php\n' });
    expect(splitPayload('{\n  "a": 1\n}\nRevisión escrita\n')).toEqual({ payload: '{\n  "a": 1\n}', rest: 'Revisión escrita\n' });
    expect(splitPayload('sin carga\n')).toEqual({ payload: '', rest: 'sin carga\n' });
  });

  it('reviewStructure cuenta propuestas y veredictos y detecta incoherencias', () => {
    const item = (id: string, text: string, ok: boolean): ReviewItem => ({ id, location: 'x', original: 'o', proposals: [{ text, rationale: 'r', verdict: ok ? OK : KO }], fromCache: false, elapsedMs: 1, usage: {} });
    const text = formatReview({ ...HEADER, task: 'improve', promptVersion: 'improve.v1' }, [item('a', 'buena', true), item('b', 'mala', false)]);
    expect(reviewStructure(text)).toEqual({ proposals: 2, verdicts: 2, acceptedWithoutTick: 0, rejectedWithoutCode: 0 });
    expect(reviewStructure(text.replace('✓ aceptada', '? dudosa').replace(/VIOLATION_C2_NUMBER_ADDED \(150\)/, 'sin motivo'))).toEqual({ proposals: 2, verdicts: 2, acceptedWithoutTick: 1, rejectedWithoutCode: 1 });
    expect(reviewStructure('- [ ] Propuesta 1: sin verificación\n')).toEqual({ proposals: 1, verdicts: 0, acceptedWithoutTick: 0, rejectedWithoutCode: 0 });
  });

  it('reverifyImprove y reverifySummary contrastan la revisión con el verificador ejecutado sobre las fuentes del banco', () => {
    const latency = 'Reduje la latencia `p99` de la API de autorización de 480 ms a 210 ms rediseñando la capa de caché y los índices.';
    const consistent = parseReview(
      formatReview({ ...HEADER, task: 'improve', promptVersion: 'improve.v1' }, [
        { id: 'exp-nexo-pagos-2', location: 'x', original: latency, proposals: [{ text: 'Rediseñé la capa de caché y los índices de la API de autorización, bajando la latencia `p99` de 480 ms a 210 ms.', rationale: 'r', verdict: OK }, { text: 'Bajé la latencia p99 a 150 ms con Redis.', rationale: 'r', verdict: KO }], fromCache: false, elapsedMs: 1, usage: {} },
      ]),
    );
    if (!consistent.ok) throw new Error('parse');
    expect(reverifyImprove(consistent.review, profile)).toEqual([]);
    const inconsistent = parseReview(
      formatReview({ ...HEADER, task: 'improve', promptVersion: 'improve.v1' }, [
        { id: 'exp-nexo-pagos-2', location: 'x', original: latency, proposals: [{ text: 'Bajé la latencia p99 a 150 ms con Redis.', rationale: 'r', verdict: OK }], fromCache: false, elapsedMs: 1, usage: {} },
        { id: 'nope', location: 'x', original: 'o', proposals: [], fromCache: false, elapsedMs: 1, usage: {} },
      ]),
    );
    if (!inconsistent.ok) throw new Error('parse');
    const problems = reverifyImprove(inconsistent.review, profile);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^exp-nexo-pagos-2 · propuesta 1: la revisión la acepta y el verificador independiente la rechaza \(.*VIOLATION_C2_/);
    expect(problems[1]).toBe('nope: no existe en las fuentes del banco');

    const summaryOk = 'Senior Backend Engineer con once años construyendo plataformas de pago: PHP, Symfony, Kafka y PostgreSQL sobre Kubernetes.';
    const summary = parseReview(
      formatReview({ ...HEADER, task: 'summarize', promptVersion: 'summarize.v1' }, [
        { id: 'summary', location: 'x', original: 'o', proposals: [{ text: summaryOk, rationale: 'r', verdict: OK }, { text: 'Experta en Rust y Go con 30 años de experiencia.', rationale: 'r', verdict: KO }], fromCache: false, elapsedMs: 1, usage: {} },
      ]),
    );
    if (!summary.ok) throw new Error('parse');
    expect(reverifySummary(summary.review, profile, 'backend', new Date('2026-08-29T10:00:00.000Z'))).toEqual([]);
    expect(reverifySummary(summary.review, profile, 'nope', new Date())).toEqual([expect.stringMatching(/^especialidad «nope»: /)]);
    const flipped = parseReview(formatReview({ ...HEADER, task: 'summarize', promptVersion: 'summarize.v1' }, [{ id: 'summary', location: 'x', original: 'o', proposals: [{ text: 'Experta en Rust y Go con 30 años de experiencia.', rationale: 'r', verdict: OK }], fromCache: false, elapsedMs: 1, usage: {} }]));
    if (!flipped.ok) throw new Error('parse');
    expect(reverifySummary(flipped.review, profile, 'backend', new Date())).toEqual([expect.stringMatching(/^propuesta 1: la revisión la acepta y el verificador independiente la rechaza/)]);
  });

  it('localLlmEnvironment solo deja pasar el proveedor local, nunca claves', () => {
    expect(localLlmEnvironment({ CHAMELEON_LLM_PROVIDER: 'openai-compatible', CHAMELEON_LLM_BASE_URL: 'http://127.0.0.1:8080', CHAMELEON_LLM_MODEL: '', CHAMELEON_OPENAI_API_KEY: 'sk', HOME: '/h' })).toEqual({ CHAMELEON_LLM_PROVIDER: 'openai-compatible', CHAMELEON_LLM_BASE_URL: 'http://127.0.0.1:8080' });
  });
});
