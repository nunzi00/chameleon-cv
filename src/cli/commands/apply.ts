/**
 * `cv improve apply <revisión>` (T-4.7): aplica a las fuentes las propuestas marcadas `[x]` en un
 * fichero de revisión de `improve` o `summarize`. Es la única orden que escribe en `data/sources`
 * (canon C9: acción explícita y deliberada del usuario) y lo hace con cuatro garantías: solo lo
 * marcado; cambio mínimo y localizado (el tramo del texto: hashtags, metadatos y el resto del
 * fichero quedan intactos); copia de seguridad previa (`<fichero>.bak`, nunca sobrescrita); y
 * comprobación por huella: si el original ya no está tal cual en la fuente, no se escribe nada.
 */
import { resolve } from 'node:path';

import { fingerprint, parseReview, type ParsedReviewItem, type ReviewSource, type ReviewTask } from '../../llm';
import { locateAchievementText, locateSummary, replaceRange, replaceSummary } from '../../parsers';
import { describeError } from '../../shared/errors';
import type { CliContext } from '../context';
import { DEFAULT_DATA_DIR } from '../defaults';
import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK, pluralize } from '../output';
import { SOURCE_MODE } from './init';

export interface ApplyOptions {
  readonly review: string;
  /** Directorio de fuentes; por defecto el registrado en la revisión o `data/sources`. */
  readonly data?: string | undefined;
  readonly deleteReview: boolean;
  readonly dryRun: boolean;
}


interface PlannedEdit {
  readonly id: string;
  readonly start: number;
  readonly text: string;
  readonly apply: (content: string) => string;
}

interface PlannedFile {
  readonly path: string;
  readonly content: string;
  readonly edits: PlannedEdit[];
}

type EditPlan = { readonly ok: true; readonly edit: PlannedEdit } | { readonly ok: false; readonly message: string };

/** Ruta relativa y contenida: una revisión manipulada no puede apuntar fuera del directorio de fuentes. */
export function isSafeSourcePath(file: string): boolean {
  return !file.startsWith('/') && !file.includes('\\') && file.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** `x.bak`; si ya existe, `x.bak.1`, `x.bak.2`…: una copia anterior nunca se sobrescribe. */
export async function backupPath(context: CliContext, path: string): Promise<string> {
  const exists = async (candidate: string): Promise<boolean> => {
    try {
      await context.datasetFileSystem.stat(candidate);
      return true;
    } catch {
      return false;
    }
  };
  let candidate = `${path}.bak`;
  for (let attempt = 1; await exists(candidate); attempt += 1) {
    candidate = `${path}.bak.${attempt}`;
  }
  return candidate;
}

function planEdit(task: ReviewTask, item: ParsedReviewItem, source: ReviewSource, text: string, content: string): EditPlan {
  if (task === 'improve') {
    const range = locateAchievementText(content, item.original, source.line);
    if (range === undefined) {
      return { ok: false, message: `el logro original no está tal cual en ${source.file} (¿editado a mano?)` };
    }
    const current = fingerprint(range.text);
    if (current !== source.hash) {
      return { ok: false, message: `el original cambió desde la revisión (huella ${current} ≠ ${source.hash})` };
    }
    return { ok: true, edit: { id: item.id, start: range.start, text, apply: (updated) => replaceRange(updated, range.start, range.end, text) } };
  }
  const location = locateSummary(content);
  const current = fingerprint(location.kind === 'present' ? location.range.text : '');
  if (current !== source.hash) {
    return { ok: false, message: `el resumen de ${source.file} cambió desde la revisión (huella ${current} ≠ ${source.hash})` };
  }
  return { ok: true, edit: { id: item.id, start: location.kind === 'present' ? location.range.start : location.insertAt, text, apply: (updated) => replaceSummary(updated, location, text) } };
}

export async function runApplyCommand(context: CliContext, options: ApplyOptions): Promise<number> {
  const reviewPath = resolve(context.cwd, options.review);
  let reviewText: string;
  try {
    reviewText = await context.datasetFileSystem.readTextFile(reviewPath);
  } catch (error) {
    context.stderr(`No se pudo leer la revisión «${reviewPath}»: ${describeError(error)}\n`);
    return EXIT_DATA_ERROR;
  }
  const parsed = parseReview(reviewText);
  if (!parsed.ok) {
    context.stderr(`${reviewPath}: ${parsed.message}\n`);
    return EXIT_DATA_ERROR;
  }
  const review = parsed.review;
  const root = resolve(context.cwd, options.data ?? review.dataDir ?? DEFAULT_DATA_DIR);

  // 1. Solo lo marcado, y una sola propuesta por ítem.
  const errors: string[] = [];
  const selected: Array<{ readonly item: ParsedReviewItem; readonly text: string }> = [];
  for (const item of review.items) {
    const checked = item.proposals.filter((proposal) => proposal.checked);
    if (checked.length > 1) {
      errors.push(`«${item.id}»: hay ${checked.length} propuestas marcadas con [x]; marca solo una`);
      continue;
    }
    for (const proposal of checked) {
      if (proposal.text.trim() === '') {
        errors.push(`«${item.id}»: la propuesta ${proposal.number} marcada está vacía`);
      } else {
        selected.push({ item, text: proposal.text.trim() });
      }
    }
  }
  if (selected.length === 0 && errors.length === 0) {
    context.stderr(`Nada que aplicar: ninguna propuesta marcada con [x] en ${reviewPath}\n`);
    return EXIT_DATA_ERROR;
  }

  // 2. Localizar cada original en su fuente y comprobar la huella; nada se escribe si algo falla.
  const files = new Map<string, PlannedFile>();
  for (const { item, text } of selected) {
    if (item.source === undefined) {
      errors.push(`«${item.id}»: la revisión no registra su fuente (se generó con fuentes inválidas u obsoletas, o el resumen no tiene destino); cópiala a mano`);
      continue;
    }
    if (!isSafeSourcePath(item.source.file)) {
      errors.push(`«${item.id}»: ruta de fuente no admitida «${item.source.file}»`);
      continue;
    }
    const path = resolve(root, item.source.file);
    let planned = files.get(path);
    if (planned === undefined) {
      try {
        planned = { path, content: await context.datasetFileSystem.readTextFile(path), edits: [] };
      } catch (error) {
        errors.push(`«${item.id}»: no se pudo leer ${path}: ${describeError(error)}`);
        continue;
      }
      files.set(path, planned);
    }
    const plan = planEdit(review.task, item, item.source, text, planned.content);
    if (plan.ok) {
      planned.edits.push(plan.edit);
    } else {
      errors.push(`«${item.id}»: ${plan.message}`);
    }
  }
  if (errors.length > 0) {
    for (const error of errors) {
      context.stderr(`${error}\n`);
    }
    context.stderr('No se ha modificado ningún fichero\n');
    return EXIT_DATA_ERROR;
  }

  if (options.dryRun) {
    for (const planned of files.values()) {
      for (const edit of planned.edits) {
        context.stdout(`${planned.path}: ${edit.id} → ${edit.text.replace(/\n+/g, ' ')}\n`);
      }
    }
    context.stderr('Ejecución en seco: no se ha modificado nada\n');
    return EXIT_OK;
  }

  // 3. Copia de seguridad y escritura, fichero a fichero (los tramos se sustituyen de atrás hacia delante).
  let changes = 0;
  for (const planned of files.values()) {
    const backup = await backupPath(context, planned.path);
    let content = planned.content;
    for (const edit of [...planned.edits].sort((a, b) => b.start - a.start)) {
      content = edit.apply(content);
    }
    try {
      await context.artifactFileSystem.writeFile(backup, planned.content, SOURCE_MODE);
      await context.artifactFileSystem.writeFile(planned.path, content, SOURCE_MODE);
    } catch (error) {
      context.stderr(`No se pudo escribir ${planned.path}: ${describeError(error)}\n`);
      return EXIT_FAILURE;
    }
    changes += planned.edits.length;
    context.stdout(`Aplicado en ${planned.path} (copia de seguridad: ${backup}): ${planned.edits.map((edit) => edit.id).join(', ')}\n`);
  }
  if (options.deleteReview) {
    await context.artifactFileSystem.remove(reviewPath);
    context.stdout(`Revisión eliminada: ${reviewPath}\n`);
  }
  context.stderr(`${pluralize(changes, 'cambio aplicado', 'cambios aplicados')} en ${pluralize(files.size, 'fichero', 'ficheros')} · recompila el artefacto con «cv build»\n`);
  return EXIT_OK;
}
