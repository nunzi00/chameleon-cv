/**
 * Frescura del artefacto (`docs/arquitectura.md` §2.4): `generate-cv` avisa si alguna fuente es
 * más reciente que `profile.json`. Nunca reconstruye por su cuenta: escribir el artefacto es
 * responsabilidad explícita de `cv build` (o de `--build`).
 */
import { planDataset, type FileSystem } from '../parsers';
import { describeError } from '../shared/errors';

export type Freshness =
  | { readonly status: 'fresh' }
  | { readonly status: 'stale'; readonly newestSource: string }
  | { readonly status: 'unknown'; readonly reason: string };

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

/** Aviso estándar de `generate-cv` y `analyze-offer` cuando el artefacto puede estar obsoleto. */
export async function warnIfStale(context: { readonly stderr: (text: string) => void; readonly datasetFileSystem: FileSystem }, artifactPath: string, sourcesRoot: string): Promise<void> {
  const freshness = await checkArtifactFreshness(context.datasetFileSystem, artifactPath, sourcesRoot);
  if (freshness.status === 'stale') {
    context.stderr(`Aviso: ${freshness.newestSource} es más reciente que el artefacto; ejecuta «cv build» para regenerarlo\n`);
  } else if (freshness.status === 'unknown') {
    context.stderr(`Aviso: no se pudo comprobar si el artefacto está al día (${freshness.reason})\n`);
  }
}
