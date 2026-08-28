/**
 * Fichero de revisión (T-4.3, canon C1 y C9): la única salida del co-piloto. Markdown legible y
 * a la vez parseable: una sección por logro, propuestas aceptadas como casillas `- [ ]` (que
 * T-4.7 podrá aplicar ítem a ítem) y rechazadas tachadas con su motivo. Registra procedencia
 * (proveedor, modelo, prompt) para que cada sugerencia sea trazable.
 */
import { createHash } from 'node:crypto';

import { describeVerdict, type Verdict } from '../core/llm/verify';
import type { LlmUsage } from './provider';

/** Dónde vive el original en las fuentes y su huella (T-4.7): `cv improve apply` solo escribe si sigue intacto. */
export interface ReviewSource {
  /** Ruta relativa al directorio de fuentes (`experience/acme.md`). */
  readonly file: string;
  readonly line: number;
  /** `fingerprint` del texto original tal como está en la fuente. */
  readonly hash: string;
}

/** SHA-256 truncado (64 bits): suficiente para detectar cambios, corto para leerse en la revisión. */
export function fingerprint(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

export interface ReviewProposal {
  readonly text: string;
  readonly rationale: string;
  readonly verdict: Verdict;
}

export interface ReviewItem {
  readonly id: string;
  /** Dónde vive el logro: «Senior Backend Engineer · ACME Corp», «Proyecto Chameleon CLI» o «Logros transversales». */
  readonly location: string;
  readonly original: string;
  readonly impact?: string | undefined;
  readonly source?: ReviewSource | undefined;
  readonly proposals: readonly ReviewProposal[];
  /** Fallo al obtener propuestas para este ítem (el lote continúa). */
  readonly error?: string | undefined;
  readonly fromCache: boolean;
  readonly elapsedMs: number;
  readonly usage: LlmUsage;
}

export type ReviewTask = 'improve' | 'summarize';

export interface ReviewHeader {
  readonly task: ReviewTask;
  readonly generatedAt: string;
  readonly specialty?: string | undefined;
  readonly offer?: string | undefined;
  /** Directorio de fuentes con el que se generó (tal como se pasó: `data/sources`), para `apply`. */
  readonly dataDir?: string | undefined;
  readonly provider: { readonly id: string; readonly baseUrl: string; readonly model: string };
  readonly promptVersion: string;
  readonly temperature: number;
  readonly seed: number;
}

export interface ReviewStats {
  readonly items: number;
  readonly proposals: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly failed: number;
  readonly fromCache: number;
}

export function reviewStats(items: readonly ReviewItem[]): ReviewStats {
  const proposals = items.flatMap((item) => item.proposals);
  return {
    items: items.length,
    proposals: proposals.length,
    accepted: proposals.filter((proposal) => proposal.verdict.accepted).length,
    rejected: proposals.filter((proposal) => !proposal.verdict.accepted).length,
    failed: items.filter((item) => item.error !== undefined).length,
    fromCache: items.filter((item) => item.fromCache).length,
  };
}

const TITLES: Readonly<Record<ReviewTask, string>> = {
  improve: '# Revisión de logros (cv improve)',
  summarize: '# Revisión del resumen profesional (cv summarize)',
};

const ADVICE: Readonly<Record<ReviewTask, string>> = {
  improve:
    'La IA sugiere; tú decides. Nada se ha modificado en `data/sources/`. Marca con `[x]` las propuestas que quieras adoptar y aplícalas con `cv improve apply <este fichero>` (crea una copia de seguridad y aborta si la fuente cambió) o cópialas a mano. Las propuestas tachadas incumplen el canon C2 (integridad semántica): el motivo está al lado.',
  summarize:
    'La IA sugiere; tú decides. Nada se ha modificado en `data/sources/`. Marca con `[x]` la propuesta que prefieras y aplícala con `cv improve apply <este fichero>` (al resumen de la especialidad o de `profile.md`, con copia de seguridad y comprobación previa) o cópiala a mano. Las propuestas tachadas incumplen el canon C2 (inventan cifras o entidades, o no mencionan ningún hecho clave); la cobertura indica qué hechos clave menciona cada una.',
};

export function formatReview(header: ReviewHeader, items: readonly ReviewItem[]): string {
  const stats = reviewStats(items);
  const lines: string[] = [
    TITLES[header.task],
    '',
    `- generado: ${header.generatedAt}`,
    `- especialidad: ${header.specialty ?? 'ninguna (perfil completo)'} · oferta: ${header.offer ?? 'ninguna'}`,
    `- proveedor: ${header.provider.id} (${header.provider.baseUrl}) · modelo: ${header.provider.model} · prompt: ${header.promptVersion} · temperatura ${header.temperature} · semilla ${header.seed}`,
    ...(header.dataDir === undefined ? [] : [`- fuentes: ${header.dataDir}`]),
    `- ${header.task === 'improve' ? 'logros' : 'ítems'}: ${stats.items} · propuestas: ${stats.proposals} · aceptadas: ${stats.accepted} · rechazadas: ${stats.rejected} · fallidos: ${stats.failed} · desde caché: ${stats.fromCache}`,
    '',
    ADVICE[header.task],
    '',
  ];
  for (const item of items) {
    lines.push(`## ${item.id} · ${item.location}`, '');
    lines.push(`Original: ${item.original.replace(/\n+/g, ' ')}`);
    if (item.impact !== undefined) {
      lines.push(`Impacto: ${item.impact}`);
    }
    if (item.source !== undefined) {
      lines.push(`Fuente: ${item.source.file}:${item.source.line} · sha256 ${item.source.hash}`);
    }
    lines.push('');
    if (item.error !== undefined) {
      lines.push(`- ✗ sin propuestas: ${item.error}`, '');
      continue;
    }
    item.proposals.forEach((proposal, index) => {
      const number = index + 1;
      // Un resumen tiene varios párrafos: se indentan bajo la viñeta para que sigan siendo Markdown válido.
      const text = proposal.text.replace(/\n+/g, '\n      ');
      if (proposal.verdict.accepted) {
        lines.push(`- [ ] Propuesta ${number}: ${text}`);
      } else {
        lines.push(`- ~~Propuesta ${number}: ${text}~~`);
      }
      lines.push(`  - motivo: ${proposal.rationale}`);
      lines.push(`  - verificación: ${describeVerdict(proposal.verdict)}`);
      const coverage = proposal.verdict.coverage;
      if (coverage !== undefined && coverage.mentioned.length + coverage.missing.length > 0) {
        lines.push(`  - cobertura: menciona ${coverage.mentioned.length === 0 ? 'ninguno' : coverage.mentioned.join(', ')} · no menciona: ${coverage.missing.length === 0 ? 'ninguno' : coverage.missing.join(', ')}`);
      }
    });
    const origin = item.fromCache ? 'desde caché' : `${item.elapsedMs} ms`;
    const tokens = item.usage.promptTokens === undefined && item.usage.completionTokens === undefined ? '' : ` · tokens ${item.usage.promptTokens ?? '?'} + ${item.usage.completionTokens ?? '?'}`;
    lines.push(`  - procedencia: ${origin}${tokens}`, '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/* ───────────────────────────── lectura (T-4.7, cv improve apply) ───────────────────────────── */

export interface ParsedProposal {
  readonly number: number;
  readonly text: string;
  /** No tachada (superó la verificación C2). */
  readonly accepted: boolean;
  /** Marcada `[x]` por el usuario. */
  readonly checked: boolean;
}

export interface ParsedReviewItem {
  readonly id: string;
  readonly location: string;
  readonly original: string;
  readonly impact?: string | undefined;
  readonly source?: ReviewSource | undefined;
  readonly proposals: readonly ParsedProposal[];
  readonly error?: string | undefined;
}

export interface ParsedReview {
  readonly task: ReviewTask;
  readonly specialty?: string | undefined;
  readonly offer?: string | undefined;
  readonly dataDir?: string | undefined;
  readonly items: readonly ParsedReviewItem[];
}

export type ParseReviewResult = { readonly ok: true; readonly review: ParsedReview } | { readonly ok: false; readonly message: string };

interface MutableProposal {
  number: number;
  text: string;
  accepted: boolean;
  checked: boolean;
}

interface MutableItem {
  id: string;
  location: string;
  original: string;
  impact?: string | undefined;
  source?: ReviewSource | undefined;
  proposals: MutableProposal[];
  error?: string | undefined;
}

const PROPOSAL_LINE = /^- (?:\[([ xX])\] |~~)Propuesta (\d+): (.*)$/;
const CONTINUATION_LINE = /^ {6}(.*)$/;
const SOURCE_LINE = /^Fuente: (.+):(\d+) · sha256 ([0-9a-f]+)$/;
const HEADER_SELECTION = /^- especialidad: (.*) · oferta: (.*)$/;

/** Grupos de captura como cadenas (vacía si el grupo no participó, como la marca de una propuesta tachada). */
function groups(match: RegExpExecArray): string[] {
  return match.slice(1).map((group) => group ?? '');
}

/**
 * Lee un fichero de revisión escrito por `formatReview` (y editado por el usuario: marcas `[x]`,
 * texto de las propuestas). Tolerante con lo que no reconoce; estricto con la cabecera.
 */
export function parseReview(text: string): ParseReviewResult {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const task = (Object.keys(TITLES) as ReviewTask[]).find((candidate) => TITLES[candidate] === lines[0]);
  if (task === undefined) {
    return { ok: false, message: 'no es un fichero de revisión de «cv improve» ni de «cv summarize» (falta su cabecera)' };
  }
  let specialty: string | undefined;
  let offer: string | undefined;
  let dataDir: string | undefined;
  const items: MutableItem[] = [];
  let current: MutableItem | undefined;
  let open: MutableProposal | undefined;
  for (const line of lines.slice(1)) {
    if (line.startsWith('## ')) {
      const heading = line.slice(3);
      const separator = heading.indexOf(' · ');
      current = { id: separator === -1 ? heading : heading.slice(0, separator), location: separator === -1 ? '' : heading.slice(separator + 3), original: '', proposals: [] };
      items.push(current);
      open = undefined;
      continue;
    }
    if (current === undefined) {
      const selection = HEADER_SELECTION.exec(line);
      if (selection !== null) {
        specialty = selection[1] === 'ninguna (perfil completo)' ? undefined : selection[1];
        offer = selection[2] === 'ninguna' ? undefined : selection[2];
      } else if (line.startsWith('- fuentes: ')) {
        dataDir = line.slice('- fuentes: '.length);
      }
      continue;
    }
    const proposal = PROPOSAL_LINE.exec(line);
    if (proposal !== null) {
      const [mark = '', number = '', text = ''] = groups(proposal);
      open = { number: Number(number), text, accepted: mark !== '', checked: mark === 'x' || mark === 'X' };
      current.proposals.push(open);
      continue;
    }
    const continuation = CONTINUATION_LINE.exec(line);
    if (continuation !== null && open !== undefined) {
      open.text += `\n\n${groups(continuation).join('')}`;
      continue;
    }
    open = undefined;
    const source = SOURCE_LINE.exec(line);
    if (source !== null) {
      const [file = '', lineNumber = '', hash = ''] = groups(source);
      current.source = { file, line: Number(lineNumber), hash };
    } else if (line.startsWith('Original: ')) {
      current.original = line.slice('Original: '.length);
    } else if (line.startsWith('Impacto: ')) {
      current.impact = line.slice('Impacto: '.length);
    } else if (line.startsWith('- ✗ sin propuestas: ')) {
      current.error = line.slice('- ✗ sin propuestas: '.length);
    }
  }
  for (const item of items) {
    for (const proposal of item.proposals) {
      if (!proposal.accepted && proposal.text.endsWith('~~')) {
        proposal.text = proposal.text.slice(0, -2);
      }
    }
  }
  return { ok: true, review: { task, specialty, offer, dataDir, items } };
}
