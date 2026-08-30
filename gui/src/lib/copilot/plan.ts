/**
 * Co-piloto (T-8.6 S3): las tres tareas como opciones, el panel «Qué sale y a dónde» calculado del formulario
 * antes de lanzar nada, y los recuentos y el progreso de la lista de trabajos.
 */
import type { JobKind } from '../api/client';
import { parseOnly, type CopilotForm } from './form';
import type { JobSnapshot } from './jobs';
import type { RemoteOption } from './providers';

export interface TaskOption {
  readonly kind: JobKind;
  readonly label: string;
  readonly description: string;
  readonly command: string;
}

export const TASK_OPTIONS: readonly TaskOption[] = [
  { kind: 'improve', label: 'Mejorar logros', description: 'Propone redacciones más claras y cuantificadas de cada logro; nada se escribe hasta que apliques la revisión.', command: 'cv improve' },
  { kind: 'summarize', label: 'Resumen profesional', description: 'Redacta propuestas de resumen para la especialidad a partir del perfil recortado.', command: 'cv summarize' },
  { kind: 'suggest-tags', label: 'Sugerir etiquetas', description: 'Propone etiquetas del vocabulario del perfil para logros sin etiquetar o un texto suelto; se muestran aquí, no se escriben.', command: 'cv suggest-tags' },
];

export interface PlanContext {
  /** Proveedor y modelo locales efectivos («ollama · qwen2.5:7b»), si se conocen. */
  readonly local: string | undefined;
  readonly remote: RemoteOption | undefined;
}

export interface SendingPlan {
  readonly destination: string;
  readonly sends: string;
  readonly writes: string;
}

/** Qué sale y a dónde, calculado del formulario (la API lo confirma al lanzar con el `sending` del 202). */
export function describePlan(form: CopilotForm, context: PlanContext): SendingPlan {
  const remoteId = context.remote === undefined ? form.provider : context.remote.id;
  const destination = form.provider === '' ? `${context.local ?? 'proveedor local'} · tu máquina` : `${remoteId} (remoto) · exige consentimiento`;
  const specialty = form.specialty === '' ? '' : ` y la especialidad «${form.specialty}»`;
  const privacy = `; ni nombre ni contacto${form.redactCompanies ? ' ni empresas' : ''}`;
  let sends: string;
  if (form.kind === 'improve') {
    const ids = parseOnly(form.only);
    sends = `${ids === undefined ? 'los logros de la selección' : `${ids.length} ${ids.length === 1 ? 'logro indicado' : 'logros indicados'}`}${specialty}${privacy}`;
  } else if (form.kind === 'summarize') {
    sends = `el perfil recortado${specialty}${form.offerMode === 'none' ? '' : ' y la oferta'}${privacy}`;
  } else {
    sends = `${form.text.trim() !== '' ? 'el texto suelto' : form.untagged ? 'los logros sin etiquetas' : 'los logros del perfil'} y el vocabulario de etiquetas${privacy}`;
  }
  const writes = form.kind === 'suggest-tags' ? 'nada: las etiquetas se muestran aquí' : `output/${form.output.trim() === '' ? `revision-${form.kind}-<fecha>.md` : form.output.trim()} · las fuentes no se tocan`;
  return { destination, sends, writes };
}

export interface JobProgress {
  readonly current: number;
  readonly total: number;
  readonly percent: number;
  /** El resto de la última línea de progreso («exp-acme-1»). */
  readonly label: string;
}

/** Progreso a partir de la última línea con la forma `[i/n] …`. */
export function jobProgress(lines: readonly string[]): JobProgress | undefined {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = /\[(\d+)\/(\d+)\]\s*(.*)$/.exec(lines[index] as string);
    if (match !== null) {
      const current = Number(match[1]);
      const total = Math.max(Number(match[2]), 1);
      return { current, total, percent: Math.min(100, Math.round((current / total) * 100)), label: (match[3] as string).trim() };
    }
  }
  return undefined;
}

export interface JobCounts {
  readonly running: number;
  readonly today: number;
}

export function jobCounts(jobs: readonly JobSnapshot[], now: Date): JobCounts {
  const day = now.toISOString().slice(0, 10);
  return {
    running: jobs.filter((job) => job.status === 'queued' || job.status === 'running').length,
    today: jobs.filter((job) => job.createdAt.startsWith(day)).length,
  };
}
