/**
 * Procedencia de los ítems del co-piloto en las fuentes (T-4.7): al generar una revisión,
 * `improve` y `summarize` anotan en cada ítem el fichero, la línea y la huella del original en
 * `data/sources`, para que `cv improve apply` sepa dónde escribir y pueda negarse si algo cambió.
 */
import type { SchemaPath } from '../../core/schema';
import type { MasterProfile } from '../../core/schema';
import { fingerprint, type ReviewItem, type ReviewSource } from '../../llm';
import { loadDataset, resolveProvenance, type Provenance } from '../../parsers';
import type { CliContext } from '../context';

export interface SourceRef {
  readonly file: string;
  readonly line: number;
  /** Texto tal como está en la fuente (crudo, con su Markdown en línea). */
  readonly text: string;
}

export interface SourceIndex {
  /** Por id de logro (experiencias, proyectos y transversales). */
  readonly achievements: ReadonlyMap<string, SourceRef>;
  /** `profile` y `specialty:<id>`; el texto es el resumen actual (vacío si no hay). */
  readonly summaries: ReadonlyMap<string, SourceRef>;
}

export type SourceIndexResult = { readonly ok: true; readonly index: SourceIndex } | { readonly ok: false; readonly message: string };

/** Índice puro a partir de un perfil cargado y su procedencia. */
export function buildSourceIndex(profile: MasterProfile, provenance: readonly Provenance[]): SourceIndex {
  const ref = (path: SchemaPath, text: string): SourceRef | undefined => {
    const origin = resolveProvenance(path, provenance);
    return origin === undefined ? undefined : { file: origin.file, line: origin.line ?? 1, text };
  };
  const achievements = new Map<string, SourceRef>();
  const add = (id: string, path: SchemaPath, text: string): void => {
    const located = ref(path, text);
    if (located !== undefined) {
      achievements.set(id, located);
    }
  };
  profile.experience.forEach((item, index) => item.achievements.forEach((achievement, position) => add(achievement.id, ['experience', index, 'achievements', position], achievement.text)));
  profile.projects.forEach((item, index) => item.achievements.forEach((achievement, position) => add(achievement.id, ['projects', index, 'achievements', position], achievement.text)));
  profile.achievements.forEach((achievement, index) => add(achievement.id, ['achievements', index], achievement.text));
  const summaries = new Map<string, SourceRef>();
  const profileSummary = ref(['personal', 'summary'], profile.personal.summary ?? '');
  if (profileSummary !== undefined) {
    summaries.set('profile', profileSummary);
  }
  profile.specialties.forEach((specialty, index) => {
    const located = ref(['specialties', index, 'summary'], specialty.summary ?? '');
    if (located !== undefined) {
      summaries.set(`specialty:${specialty.id}`, located);
    }
  });
  return { achievements, summaries };
}

export async function indexSources(context: CliContext, datasetDir: string): Promise<SourceIndexResult> {
  const dataset = await loadDataset(datasetDir, { fileSystem: context.datasetFileSystem, parsers: context.parsers });
  if (!dataset.ok) {
    return { ok: false, message: `${dataset.errors.length === 1 ? '1 problema' : `${dataset.errors.length} problemas`} en ${datasetDir} (compruébalo con «cv validate»)` };
  }
  return { ok: true, index: buildSourceIndex(dataset.profile, dataset.provenance) };
}

/** Anota la fuente de cada logro cuyo texto coincide con el de las fuentes; avisa del resto. */
export function withAchievementSources(items: readonly ReviewItem[], index: SourceIndex, warn: (line: string) => void): ReviewItem[] {
  return items.map((item) => {
    const located = index.achievements.get(item.id);
    if (located === undefined) {
      warn(`Aviso: el logro «${item.id}» no está en las fuentes (¿artefacto obsoleto?): la revisión no registrará su fuente y «cv improve apply» no podrá aplicarlo`);
      return item;
    }
    if (located.text !== item.original) {
      warn(`Aviso: el logro «${item.id}» difiere entre el artefacto y ${located.file}:${located.line} (recompila con «cv build»): la revisión no registrará su fuente`);
      return item;
    }
    return { ...item, source: { file: located.file, line: located.line, hash: fingerprint(located.text) } };
  });
}

/** Destino del resumen: la especialidad (`-s`) o `profile.md`; un resumen orientado solo a una oferta no tiene destino. */
export function summarySource(index: SourceIndex, specialty: string | undefined, offer: string | undefined, warn: (line: string) => void): ReviewSource | undefined {
  if (specialty === undefined && offer !== undefined) {
    warn('Aviso: un resumen orientado a una oferta (sin -s) no tiene destino en las fuentes: la revisión no registrará fuente; cópialo a mano donde proceda');
    return undefined;
  }
  const located = index.summaries.get(specialty === undefined ? 'profile' : `specialty:${specialty}`);
  if (located === undefined) {
    warn(`Aviso: no se encontró en las fuentes el resumen ${specialty === undefined ? 'de profile.md' : `de la especialidad «${specialty}»`}: la revisión no registrará fuente`);
    return undefined;
  }
  return { file: located.file, line: located.line, hash: fingerprint(located.text) };
}
