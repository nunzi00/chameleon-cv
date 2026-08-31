/**
 * Frescura del artefacto (`docs/arquitectura.md` §2.4): `generate-cv` avisa si alguna fuente es más
 * reciente que `profile.json`. Nunca reconstruye por su cuenta: escribir el artefacto es responsabilidad
 * explícita de `cv build` (o de `--build`).
 */
import { planDataset, type FileSystem } from '../parsers';
import { describeError } from '../shared/errors';

export type Freshness =
  | { readonly status: 'fresh' }
  | { readonly status: 'stale'; readonly newestSource: string }
  | { readonly status: 'unknown'; readonly reason: string };

/** Avisos que un caso de uso acumula sin interrumpirse; cada cliente los formatea. */
export type AppWarning =
  | { readonly kind: 'stale-artifact'; readonly newestSource: string }
  | { readonly kind: 'freshness-unknown'; readonly reason: string }
  /** El co-piloto procesa solo los `kept` primeros de `total` logros (presupuesto `--max-items`). */
  | { readonly kind: 'items-truncated'; readonly total: number; readonly kept: number }
  /** `--skills`/`--projects`: nombres o ids que no existen en el perfil (se ignoran). */
  | { readonly kind: 'unknown-selection'; readonly section: 'skills' | 'projects'; readonly names: readonly string[] }
  /** El historial de ofertas (`output/historial-ofertas.json`) no se pudo escribir; la orden se completó igualmente. */
  | { readonly kind: 'history-unwritable'; readonly message: string }
  /**
   * La oferta trae texto de sobra pero apenas requisitos reconocibles. Suele significar que sus requisitos están
   * en OTRA página —«check our careers repository: <url>»— y entonces una adecuación del 100 % sobre un solo
   * requisito engaña más que informa. Medido con una oferta real el 1-sep-2026.
   */
  | { readonly kind: 'offer-without-requirements'; readonly words: number; readonly recognized: number; readonly link?: string | undefined };

export async function checkArtifactFreshness(fs: FileSystem, artifactPath: string, sourcesRoot: string): Promise<Freshness> {
  let artifactMtime: number;
  try {
    artifactMtime = (await fs.stat(artifactPath)).mtimeMs;
  } catch (error) {
    return { status: 'unknown', reason: `no se pudo leer la fecha del artefacto: ${describeError(error)}` };
  }
  const plan = await planDataset(sourcesRoot, fs);
  if (!plan.ok) {
    return {
      status: 'unknown',
      reason: `las fuentes en ${sourcesRoot} tienen ${plan.errors.length} problema(s); ejecuta «cv validate»`,
    };
  }
  const sources = await Promise.all(
    plan.files.map(async (file) => ({ path: file.path, mtimeMs: (await fs.stat(file.absolutePath)).mtimeMs })),
  );
  const newest = sources.reduce((best, current) => (current.mtimeMs > best.mtimeMs ? current : best), {
    path: '',
    mtimeMs: Number.NEGATIVE_INFINITY,
  });
  return newest.mtimeMs > artifactMtime ? { status: 'stale', newestSource: newest.path } : { status: 'fresh' };
}

/** El aviso que corresponde a una frescura (ninguno si el artefacto está al día). */
export function freshnessWarning(freshness: Freshness): AppWarning | undefined {
  if (freshness.status === 'stale') {
    return { kind: 'stale-artifact', newestSource: freshness.newestSource };
  }
  return freshness.status === 'unknown' ? { kind: 'freshness-unknown', reason: freshness.reason } : undefined;
}
