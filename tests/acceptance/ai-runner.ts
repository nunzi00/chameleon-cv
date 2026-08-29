/**
 * Arnés de aceptación de IA (T-5.5.3): ejecuta `cv improve`, `cv summarize` y `cv suggest tags`
 * con el **binario compilado** sobre una copia temporal del banco, contra un modelo **local** real,
 * y valida la integridad estructural y la consistencia semántica del proceso —nunca el texto
 * exacto del modelo—: (a) las órdenes terminan sin error; (b) los ficheros de revisión cumplen el
 * formato; (c) sin invención: las propuestas aceptadas vuelven a superar el verificador semántico
 * ejecutado aquí, de forma independiente, contra las fuentes del banco, y las rechazadas llevan su
 * `VIOLATION_*`; (d) las etiquetas sugeridas pertenecen al diccionario cerrado; (e) lo que sale
 * hacia el modelo no contiene PII del banco; (f) nada se escribe en `data/sources` (C9).
 * Precondición: un proveedor local (Ollama por defecto; `CHAMELEON_LLM_*`) que responda y sirva el
 * modelo; nunca un proveedor remoto. La tasa de aceptación y los tiempos se informan como datos.
 *
 *   npm run test:acceptance:ai            # código 0 si todo pasa, 1 si algo falla, 2 si no se puede ejecutar
 */
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { closedDictionary } from '../../src/core/llm/tags';
import { policyOptions, verifyProposal } from '../../src/core/llm/verify';
import type { MasterProfile } from '../../src/core/schema';
import { selectForSpecialty } from '../../src/core/selection';
import { LLM_ENV, buildImproveFragment, buildSummarizeFragment, formatLlmStatus, llmStatus, parseReview, verificationVocabulary, type ParsedReview } from '../../src/llm';
import { NodeFileSystem, defaultSourceParsers, loadDataset } from '../../src/parsers';
import { BENCH_WORKSPACE, CLI_PATH, checkDist } from './runner';

export interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string | undefined;
}

/** PII del banco que nunca debe salir hacia el modelo (el nombre se sustituye por `[NOMBRE]`). */
export function piiFindings(payload: string, profile: MasterProfile): string[] {
  const personal = profile.personal;
  const needles = new Set<string>([personal.fullName]);
  for (const part of personal.fullName.split(/\s+/)) {
    if (part.length > 2) {
      needles.add(part);
    }
  }
  if (personal.email !== undefined) {
    needles.add(personal.email);
  }
  if (personal.phone !== undefined) {
    needles.add(personal.phone);
    needles.add(personal.phone.replace(/\s+/g, ''));
  }
  for (const link of personal.links) {
    needles.add(link.url);
    needles.add(link.url.replace(/^https?:\/\//, ''));
  }
  return [...needles].filter((needle) => payload.includes(needle));
}

/** Líneas de `cv suggest tags` en stdout: `#a #b` o `<id>: #a #b`. */
export function parseTagLines(stdout: string): Array<{ readonly id: string | undefined; readonly tags: readonly string[] }> {
  const lines: Array<{ id: string | undefined; tags: string[] }> = [];
  for (const line of stdout.split('\n')) {
    const match = /^(?:([a-z0-9][a-z0-9-]*): )?(#\S+(?: #\S+)*)$/.exec(line.trim());
    if (match !== null) {
      lines.push({ id: match[1], tags: (match[2] ?? '').split(' ').map((tag) => tag.slice(1)) });
    }
  }
  return lines;
}

/** La carga útil que `--show-payload` imprime al principio de stdout (JSON con sangría) y el resto. */
export function splitPayload(stdout: string): { readonly payload: string; readonly rest: string } {
  const lines = stdout.split('\n');
  const end = lines.findIndex((line) => line === ']' || line === '}');
  if (end === -1) {
    return { payload: '', rest: stdout };
  }
  return { payload: lines.slice(0, end + 1).join('\n'), rest: lines.slice(end + 1).join('\n') };
}

export interface ReviewStructure {
  readonly proposals: number;
  readonly verdicts: number;
  /** Propuestas aceptadas cuya línea de verificación no dice «✓ aceptada». */
  readonly acceptedWithoutTick: number;
  /** Propuestas tachadas sin un código `VIOLATION_*` en su verificación. */
  readonly rejectedWithoutCode: number;
}

/** Comprobación textual del formato: cada propuesta lleva su línea de verificación, coherente con su estado. */
export function reviewStructure(text: string): ReviewStructure {
  const lines = text.split('\n');
  let proposals = 0;
  let verdicts = 0;
  let acceptedWithoutTick = 0;
  let rejectedWithoutCode = 0;
  lines.forEach((line, index) => {
    const accepted = /^- \[[ xX]\] Propuesta \d+: /.test(line);
    const rejected = /^- ~~Propuesta \d+: /.test(line);
    if (!accepted && !rejected) {
      return;
    }
    proposals += 1;
    const verdict = lines.slice(index + 1, index + 8).find((candidate) => candidate.startsWith('  - verificación: '));
    if (verdict === undefined) {
      return;
    }
    verdicts += 1;
    if (accepted && !verdict.includes('✓ aceptada')) {
      acceptedWithoutTick += 1;
    }
    if (rejected && !verdict.includes('VIOLATION_')) {
      rejectedWithoutCode += 1;
    }
  });
  return { proposals, verdicts, acceptedWithoutTick, rejectedWithoutCode };
}

interface Run {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly seconds: number;
}

function run(workspace: string, env: Readonly<Record<string, string>>, args: readonly string[]): Run {
  const started = Date.now();
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], { cwd: workspace, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr, seconds: (Date.now() - started) / 1000 };
}

function lastLine(text: string): string {
  return text.trimEnd().split('\n').at(-1) ?? '';
}

async function loadProfile(workspace: string): Promise<MasterProfile> {
  const dataset = await loadDataset(join(workspace, 'data', 'sources'), { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
  if (!dataset.ok) {
    throw new Error(`Banco inválido: ${dataset.errors.map((error) => `${error.file}: ${error.message}`).join('; ')}`);
  }
  return dataset.profile;
}

/** (c) Verificación independiente de `improve`: mismas reglas que el producto, ejecutadas aquí contra las fuentes del banco. */
export function reverifyImprove(review: ParsedReview, profile: MasterProfile): string[] {
  const vocabulary = verificationVocabulary(profile);
  const problems: string[] = [];
  for (const item of review.items) {
    const fragment = buildImproveFragment(profile, item.id);
    if (fragment === undefined) {
      problems.push(`${item.id}: no existe en las fuentes del banco`);
      continue;
    }
    const original = fragment.redaction.restore(fragment.input.text);
    const allowed = [fragment.input.impact, fragment.input.context.role, fragment.input.context.company].filter((value): value is string => value !== undefined).map((value) => fragment.redaction.restore(value));
    for (const proposal of item.proposals) {
      const verdict = verifyProposal(original, proposal.text, { allowed, vocabulary, maxLength: fragment.input.maxLength, locale: fragment.input.locale, ...policyOptions('strict') });
      if (verdict.accepted !== proposal.accepted) {
        problems.push(`${item.id} · propuesta ${proposal.number}: la revisión la ${proposal.accepted ? 'acepta' : 'rechaza'} y el verificador independiente la ${verdict.accepted ? 'acepta' : 'rechaza'} (${verdict.violations.map((violation) => violation.code).join(', ') || 'sin violaciones'})`);
      }
    }
  }
  return problems;
}

/** (c) Verificación independiente de `summarize` (política de síntesis, hechos clave de la especialidad). */
export function reverifySummary(review: ParsedReview, profile: MasterProfile, specialty: string, now: Date): string[] {
  const selection = selectForSpecialty(profile, specialty);
  if (!selection.ok) {
    return [`especialidad «${specialty}»: ${selection.error.message}`];
  }
  const fragment = buildSummarizeFragment(selection.selection.profile, { now });
  const vocabulary = verificationVocabulary(profile);
  const problems: string[] = [];
  for (const item of review.items) {
    for (const proposal of item.proposals) {
      const verdict = verifyProposal(fragment.corpus, proposal.text, { vocabulary, maxLength: fragment.input.maxLength, locale: fragment.input.locale, ...policyOptions('synthesis', fragment.keyFacts) });
      if (verdict.accepted !== proposal.accepted) {
        problems.push(`propuesta ${proposal.number}: la revisión la ${proposal.accepted ? 'acepta' : 'rechaza'} y el verificador independiente la ${verdict.accepted ? 'acepta' : 'rechaza'} (${verdict.violations.map((violation) => violation.code).join(', ') || 'sin violaciones'})`);
      }
    }
  }
  return problems;
}

function check(name: string, ok: boolean, detail?: string): Check {
  return { name, ok, ...(detail === undefined ? {} : { detail }) };
}

async function readReview(path: string): Promise<{ readonly text: string; readonly review: ParsedReview } | { readonly error: string }> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return { error: `no existe ${path}` };
  }
  const parsed = parseReview(text);
  return parsed.ok ? { text, review: parsed.review } : { error: parsed.message };
}

/** Solo el proveedor local configurado viaja al binario: nunca claves ni proveedores remotos. */
export function localLlmEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of [LLM_ENV.provider, LLM_ENV.baseUrl, LLM_ENV.model]) {
    const value = source[name];
    if (value !== undefined && value !== '') {
      env[name] = value;
    }
  }
  return env;
}

export async function runAiAcceptance(): Promise<number> {
  const distProblem = await checkDist();
  if (distProblem !== undefined) {
    console.error(distProblem);
    return 2;
  }
  const llmEnv = localLlmEnvironment(process.env);
  const status = await llmStatus({ env: llmEnv });
  console.log('Arnés de aceptación de IA · precondición: proveedor local\n' + formatLlmStatus(status).trimEnd());
  if (!status.usable) {
    console.error(
      [
        '',
        'No se puede ejecutar: hace falta un modelo local que responda.',
        '  - Ollama: arranca «ollama serve» y descarga el modelo con «ollama pull qwen2.5:7b-instruct» (o el que fijes en CHAMELEON_LLM_MODEL).',
        '  - Otro servidor local compatible con OpenAI (llama-server, LM Studio): CHAMELEON_LLM_PROVIDER=openai-compatible y CHAMELEON_LLM_BASE_URL=http://127.0.0.1:8080.',
        '  - Nunca se usa un proveedor remoto en estas pruebas.',
      ].join('\n'),
    );
    return 2;
  }
  const root = await mkdtemp(join(tmpdir(), 'cv-acceptance-ai-'));
  try {
    const workspace = join(root, 'ws');
    const home = join(root, 'home');
    const bin = join(root, 'bin');
    await mkdir(bin, { recursive: true });
    await mkdir(home, { recursive: true });
    await cp(BENCH_WORKSPACE, workspace, { recursive: true });
    const env = { PATH: bin, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), TZ: 'UTC', LANG: 'C.UTF-8', ...llmEnv };
    const profile = await loadProfile(workspace);
    const checks: Check[] = [];
    const data: string[] = [];
    const build = run(workspace, env, ['build']);
    checks.push(check('build termina sin error', build.status === 0, build.stderr));

    // improve
    const improve = run(workspace, env, ['improve', '-s', 'backend', '--top-n', '1', '--max-items', '3', '--no-cache', '--show-payload', '-o', 'output/revision-improve-ai.md']);
    checks.push(check('(a) improve termina sin error', improve.status === 0, `código ${improve.status}\n${improve.stderr}`));
    const improvePayload = splitPayload(improve.stdout);
    const improvePii = piiFindings(improvePayload.payload, profile);
    checks.push(check('(e) improve: la carga útil no contiene PII del banco', improvePayload.payload !== '' && improvePii.length === 0, improvePayload.payload === '' ? 'sin carga útil en stdout' : `encontrado: ${improvePii.join(', ')}`));
    const improveReview = await readReview(join(workspace, 'output', 'revision-improve-ai.md'));
    if ('error' in improveReview) {
      checks.push(check('(b) improve: la revisión existe y cumple el formato', false, improveReview.error));
    } else {
      const structure = reviewStructure(improveReview.text);
      const payloadItems = improvePayload.payload === '' ? 0 : (JSON.parse(improvePayload.payload) as unknown[]).length;
      const failedItems = improveReview.review.items.filter((item) => item.error !== undefined);
      checks.push(
        check(
          '(b) improve: la revisión cumple el formato (cabecera, un ítem por logro con Fuente:, veredicto por propuesta)',
          improveReview.review.task === 'improve' && improveReview.review.dataDir === 'data/sources' && improveReview.review.items.length === payloadItems && improveReview.review.items.every((item) => item.source !== undefined) && structure.proposals === structure.verdicts && structure.acceptedWithoutTick === 0 && structure.rejectedWithoutCode === 0,
          `ítems ${improveReview.review.items.length}/${payloadItems}, con fuente ${improveReview.review.items.filter((item) => item.source !== undefined).length}, propuestas ${structure.proposals}, veredictos ${structure.verdicts}, aceptadas sin ✓ ${structure.acceptedWithoutTick}, rechazadas sin código ${structure.rejectedWithoutCode}`,
        ),
      );
      checks.push(check('(a) improve: ningún logro falló (JSON válido del modelo en todos)', failedItems.length === 0, failedItems.map((item) => `${item.id}: ${item.error ?? ''}`).join('; ')));
      const problems = reverifyImprove(improveReview.review, profile);
      checks.push(check('(c) improve: las propuestas aceptadas superan el verificador independiente y las rechazadas no', problems.length === 0, problems.join('\n')));
      data.push(`improve (${improve.seconds.toFixed(0)} s): ${lastLine(improve.stdout).replace(/^Revisión escrita en \S+: /, '')}`);
    }

    // summarize
    const summarize = run(workspace, env, ['summarize', '-s', 'backend', '--no-cache', '--show-payload', '-o', 'output/revision-summarize-ai.md']);
    checks.push(check('(a) summarize termina sin error', summarize.status === 0, `código ${summarize.status}\n${summarize.stderr}`));
    const summarizePayload = splitPayload(summarize.stdout);
    const summarizePii = piiFindings(summarizePayload.payload, profile);
    checks.push(check('(e) summarize: la carga útil no contiene PII del banco', summarizePayload.payload !== '' && summarizePii.length === 0, summarizePayload.payload === '' ? 'sin carga útil en stdout' : `encontrado: ${summarizePii.join(', ')}`));
    const summarizeReview = await readReview(join(workspace, 'output', 'revision-summarize-ai.md'));
    if ('error' in summarizeReview) {
      checks.push(check('(b) summarize: la revisión existe y cumple el formato', false, summarizeReview.error));
    } else {
      const structure = reviewStructure(summarizeReview.text);
      const item = summarizeReview.review.items[0];
      checks.push(
        check(
          '(b) summarize: la revisión cumple el formato (un ítem summary con Fuente: y veredicto por propuesta)',
          summarizeReview.review.task === 'summarize' && summarizeReview.review.items.length === 1 && item?.id === 'summary' && item.source !== undefined && item.error === undefined && structure.proposals > 0 && structure.proposals === structure.verdicts && structure.acceptedWithoutTick === 0 && structure.rejectedWithoutCode === 0,
          `ítems ${summarizeReview.review.items.length}, propuestas ${structure.proposals}, veredictos ${structure.verdicts}, error ${item?.error ?? 'ninguno'}`,
        ),
      );
      const problems = reverifySummary(summarizeReview.review, profile, 'backend', new Date());
      checks.push(check('(c) summarize: las propuestas aceptadas superan el verificador independiente y las rechazadas no', problems.length === 0, problems.join('\n')));
      data.push(`summarize (${summarize.seconds.toFixed(0)} s): ${lastLine(summarize.stdout).replace(/^Revisión escrita en \S+: /, '')}`);
    }

    // suggest tags: logros del perfil (diccionario completo) y texto suelto (diccionario de una especialidad)
    const dictionary = closedDictionary(profile);
    const allTags = dictionary.ok ? dictionary.dictionary.tags : [];
    const suggest = run(workspace, env, ['suggest', 'tags', '--only', 'exp-nexo-pagos-2,exp-orbita-cloud-1,ach-2', '--no-cache', '--show-payload', '--explain']);
    checks.push(check('(a) suggest tags termina sin error', suggest.status === 0, `código ${suggest.status}\n${suggest.stderr}`));
    const suggestPayload = splitPayload(suggest.stdout);
    const suggestPii = piiFindings(suggestPayload.payload, profile);
    checks.push(check('(e) suggest tags: la carga útil no contiene PII del banco', suggestPayload.payload !== '' && suggestPii.length === 0, `encontrado: ${suggestPii.join(', ')}`));
    const tagLines = parseTagLines(suggestPayload.rest);
    const outside = tagLines.flatMap((line) => line.tags.filter((tag) => !allTags.includes(tag) || tag === 'pin').map((tag) => `${line.id ?? 'texto'}: ${tag}`));
    checks.push(check('(d) suggest tags: todas las etiquetas pertenecen al diccionario cerrado (grafía exacta, sin pin)', outside.length === 0, outside.join(', ')));
    const emDictionary = closedDictionary(profile, 'engineering-manager');
    const emTags = emDictionary.ok ? emDictionary.dictionary.tags : [];
    const suggestText = run(workspace, env, ['suggest', 'tags', 'Coordiné a un equipo de seis personas con sprints quincenales y retrospectivas', '-s', 'engineering-manager', '--no-cache']);
    checks.push(check('(a) suggest tags (texto, -s) termina sin error', suggestText.status === 0, `código ${suggestText.status}\n${suggestText.stderr}`));
    const textOutside = parseTagLines(suggestText.stdout).flatMap((line) => line.tags.filter((tag) => !emTags.includes(tag) || tag === 'pin'));
    checks.push(check('(d) suggest tags (texto, -s): las etiquetas pertenecen al diccionario de la especialidad', textOutside.length === 0, textOutside.join(', ')));
    data.push(`suggest tags (${(suggest.seconds + suggestText.seconds).toFixed(0)} s): ${lastLine(suggest.stderr)} · texto: ${suggestText.stdout.trim() || 'ninguna etiqueta'}`);

    // (f) C9: las fuentes de la copia siguen siendo las del banco
    const sourcesCompare = spawnSync('diff', ['-r', join(BENCH_WORKSPACE, 'data', 'sources'), join(workspace, 'data', 'sources')], { encoding: 'utf8' });
    checks.push(check('(f) nada se ha escrito en data/sources (canon C9)', sourcesCompare.status === 0, sourcesCompare.stdout.slice(0, 400)));

    console.log('');
    for (const item of checks) {
      console.log(`${item.ok ? '✓' : '✗'} ${item.name}${item.ok || item.detail === undefined || item.detail === '' ? '' : `\n    ${item.detail.split('\n').join('\n    ')}`}`);
    }
    console.log('');
    console.log(`Datos (no criterio): proveedor ${status.config?.provider ?? '?'} · modelo ${status.config?.model ?? '?'}`);
    for (const line of data) {
      console.log(`  ${line}`);
    }
    const failed = checks.filter((item) => !item.ok).length;
    console.log(`${checks.length} comprobaciones · ${failed} fallidas`);
    return failed === 0 ? 0 : 1;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (require.main === module) {
  runAiAcceptance()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
